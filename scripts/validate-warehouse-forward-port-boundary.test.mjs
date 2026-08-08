import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const validatorPath = fileURLToPath(
  new URL('./validate-warehouse-forward-port-boundary.mjs', import.meta.url),
)
const fixturesRoot = fileURLToPath(
  new URL('./fixtures/warehouse-forward-port-boundary/', import.meta.url),
)
const projectRoot = fileURLToPath(new URL('../', import.meta.url))

function runFixtureRoot(fixtureRoot, mode, manifestPath = path.join(fixtureRoot, 'manifest.json')) {
  const rootFlag = mode === 'source' ? '--source-root' : '--destination-root'
  const rootDirectory = path.join(fixtureRoot, mode)
  const result = spawnSync(process.execPath, [
    validatorPath,
    `--audit-${mode}`,
    '--manifest',
    manifestPath,
    rootFlag,
    rootDirectory,
    ...(mode === 'destination' ? ['--destination-stage', 'fixture'] : []),
  ], {
    encoding: 'utf8',
  })

  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

function runFixture(name, mode) {
  return runFixtureRoot(path.join(fixturesRoot, name), mode)
}

function runLexicalLocalStorageFixture(name) {
  const groupRoot = path.join(fixturesRoot, 'lexical-local-storage')
  return runFixtureRoot(
    path.join(groupRoot, 'cases', name),
    'destination',
    path.join(groupRoot, 'manifest.json'),
  )
}

function symlinkIsUnsupported(error) {
  return ['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'UNKNOWN'].includes(error?.code)
}

async function runFixtureWithSymlink(t, name, mode, link) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'warehouse-boundary-'))
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }))
  const fixtureRoot = path.join(temporaryRoot, name)
  await cp(path.join(fixturesRoot, name), fixtureRoot, { recursive: true })
  const linkPath = path.join(fixtureRoot, link.path)
  await mkdir(path.dirname(linkPath), { recursive: true })
  try {
    await symlink(link.target, linkPath, 'file')
  } catch (error) {
    if (symlinkIsUnsupported(error)) {
      t.skip(`runtime symlink is unsupported on this platform: ${error.code}`)
      return null
    }
    throw error
  }
  return runFixtureRoot(fixtureRoot, mode)
}

test('runtime symlink skip recognizes every unsupported-platform error code', () => {
  for (const code of ['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'UNKNOWN']) {
    assert.equal(symlinkIsUnsupported({ code }), true, code)
  }
  assert.equal(symlinkIsUnsupported({ code: 'EEXIST' }), false)
  assert.equal(symlinkIsUnsupported(null), false)
})

test('npm resolves the validator parser as an exact direct development dependency', () => {
  const declared = spawnSync('npm', [
    'pkg',
    'get',
    'devDependencies.@babel/parser',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  const installed = spawnSync('npm', [
    'ls',
    '@babel/parser',
    '--depth=0',
    '--json',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
  })

  assert.equal(declared.status, 0, declared.stderr)
  assert.equal(JSON.parse(declared.stdout), '7.29.7')
  assert.equal(installed.status, 0, installed.stderr)
  assert.equal(JSON.parse(installed.stdout).dependencies?.['@babel/parser']?.version, '7.29.7')
})

test('source audit validates classified source modules without requiring destinations', () => {
  const result = runFixture('source-valid', 'source')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(
    result.stdout,
    'Source audit passed: 2 source modules; rewrite edges: src/features/warehouse/pure.js -> src/features/warehouse/warehouseConstants.js',
  )
})

test('source audit never accepts an external reference as a copyable source', () => {
  const result = runFixture('reference-as-source', 'source')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Source path must stay under src/features/warehouse/: src/services/warehouseConfirmationService.js',
  )
})

test('source audit rejects a source symlink before reading outside its real root', async (t) => {
  const result = await runFixtureWithSymlink(t, 'source-symlink-escape', 'source', {
    path: 'source/src/features/warehouse/main.js',
    target: '../../../../outside.js',
  })
  if (!result) return

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Source path escapes source root: src/features/warehouse/main.js',
  )
})

test('source audit rejects a reference symlink before reading outside its real root', async (t) => {
  const result = await runFixtureWithSymlink(t, 'reference-symlink-escape', 'source', {
    path: 'source/src/services/warehouseConfirmationService.js',
    target: '../../../outside.js',
  })
  if (!result) return

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Reference path escapes source root: src/services/warehouseConfirmationService.js',
  )
})

test('source audit rejects a pure module import of source-only confirmation provenance', () => {
  const result = runFixture('source-forbidden-reference', 'source')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden dependency: src/features/warehouse/main.js -> src/services/warehouseConfirmationService.js',
  )
})

test('source audit resolves extensionless files and index modules before classification', () => {
  const result = runFixture('source-extension-index', 'source')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Source audit passed: 3 source modules; rewrite edges: none')
})

test('destination audit traverses a complete declared warehouse graph', () => {
  const result = runFixture('destination-valid', 'destination')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Destination audit passed: 2 modules for stage fixture')
})

test('destination audit permits declared adapters whose same paths are source-only forbidden', () => {
  const result = runFixture('scoped-adapter', 'destination')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Destination audit passed: 2 modules for stage fixture')
})

test('destination audit rejects an undeclared local dependency with its exact edge and file', () => {
  const result = runFixture('undeclared-dependency', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Undeclared dependency: src/features/warehouse/main.js -> src/features/warehouse/helper.js',
  )
})

test('destination audit reports the exact selected destination that is absent before traversal', () => {
  const result = runFixture('missing-destination', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(result.stderr, 'Missing destination: src/features/warehouse/missing.js')
})

test('destination audit rejects a selected destination symlink before reading outside its real root', async (t) => {
  const result = await runFixtureWithSymlink(t, 'destination-symlink-escape', 'destination', {
    path: 'destination/src/features/warehouse/main.js',
    target: '../../../../outside.js',
  })
  if (!result) return

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Destination path escapes destination root: src/features/warehouse/main.js',
  )
})

test('destination audit rejects a dependency symlink before reading outside its real root', async (t) => {
  const result = await runFixtureWithSymlink(t, 'dependency-symlink-escape', 'destination', {
    path: 'destination/src/features/warehouse/helper.js',
    target: '../../../../outside.js',
  })
  if (!result) return

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Dependency path escapes destination root: src/features/warehouse/main.js -> src/features/warehouse/helper.js',
  )
})

test('destination audit rejects a warehouse-kind symlink into repository services', async (t) => {
  const result = await runFixtureWithSymlink(t, 'warehouse-kind-repo-symlink', 'destination', {
    path: 'destination/src/features/warehouse/main.js',
    target: '../../services/baseRecordService.js',
  })
  if (!result) return

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Warehouse destination realpath must stay under src/features/warehouse/: src/features/warehouse/main.js',
  )
})

test('destination audit rejects an adapter symlink that misses its exact declared path', async (t) => {
  const result = await runFixtureWithSymlink(t, 'adapter-kind-repo-symlink', 'destination', {
    path: 'destination/src/services/warehouseConfirmationService.js',
    target: 'otherService.js',
  })
  if (!result) return

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Adapter destination realpath must match declared path: src/services/warehouseConfirmationService.js',
  )
})

test('destination audit rejects a direct forbidden import with its exact edge and file', () => {
  const result = runFixture('direct-forbidden', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden dependency: src/features/warehouse/main.js -> src/services/baseRecordService.js',
  )
})

test('destination audit rejects a transitive forbidden import with its exact edge and file', () => {
  const result = runFixture('indirect-forbidden', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden dependency: src/features/warehouse/helper.js -> src/services/sessionOperationFence.js',
  )
})

test('destination audit rejects a dynamic forbidden import with its exact edge and file', () => {
  const result = runFixture('dynamic-forbidden', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden dependency: src/features/warehouse/main.js -> src/services/baseRecordService.js',
  )
})

test('destination audit fails closed on a template-literal dynamic import', () => {
  const result = runFixture('dynamic-template', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Unresolved dynamic dependency: src/features/warehouse/main.js -> import(<template>)',
  )
})

test('destination audit fails closed on a variable dynamic import', () => {
  const result = runFixture('dynamic-variable', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Unresolved dynamic dependency: src/features/warehouse/main.js -> import(<non-literal>)',
  )
})

test('destination audit fails closed on a variable require call', () => {
  const result = runFixture('require-variable', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Unresolved dynamic dependency: src/features/warehouse/main.js -> require(<non-literal>)',
  )
})

test('destination audit resolves root-relative src imports inside the repository graph', () => {
  const result = runFixture('root-relative', 'destination')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Destination audit passed: 2 modules for stage fixture')
})

test('destination audit rejects an import path that escapes the destination root', () => {
  const result = runFixture('path-escape', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Path escape: src/features/warehouse/main.js -> ../../../../outside.js',
  )
})

test('destination audit rejects runtime localStorage use with its exact file', () => {
  const result = runFixture('local-storage', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden runtime dependency: src/features/warehouse/main.js -> localStorage',
  )
})

for (const [fixture, browserGlobal] of [
  ['local-storage-destructure-global', 'globalThis'],
  ['local-storage-destructure-window', 'window'],
  ['local-storage-destructure-self', 'self'],
]) {
  test(`destination audit rejects localStorage destructuring from ${browserGlobal}`, () => {
    const result = runFixture(fixture, 'destination')

    assert.notEqual(result.status, 0)
    assert.equal(
      result.stderr,
      'Forbidden runtime dependency: src/features/warehouse/main.js -> localStorage',
    )
  })
}

for (const [fixture, behavior] of [
  ['inner-window-alias-does-not-leak', 'an inner window alias never contaminates an outer ordinary object'],
  ['ordinary-member', 'an ordinary object may expose a localStorage-named property'],
  ['function-parameter-shadow', 'a function parameter shadows an outer browser-global alias'],
  ['block-shadow', 'a block binding shadows an outer browser-global alias'],
  ['local-storage-const', 'a const binding named localStorage shadows the true global'],
  ['local-storage-let', 'a let binding named localStorage shadows the true global'],
  ['local-storage-var', 'a var binding named localStorage shadows the true global'],
  ['local-storage-parameter', 'a localStorage function parameter shadows the true global'],
  ['catch-shadow', 'a catch parameter named localStorage shadows the true global'],
  ['parameter-no-default-global-name', 'a browser-global-named parameter without a default'],
  ['let-safe-overwrite', 'an unconditional ordinary-object overwrite of a let browser alias'],
  ['var-safe-overwrite', 'an unconditional ordinary-object overwrite of a var browser alias'],
  ['block-let-safe-overwrite', 'an unconditional block-local overwrite of a let browser alias'],
  ['var-block-safe-overwrite', 'an unconditional overwrite of a block-declared function-scoped var alias'],
  ['var-use-before-block-initializer', 'a hoisted var before its block initializer becomes a browser alias'],
]) {
  test(`destination audit permits ${behavior}`, () => {
    const result = runLexicalLocalStorageFixture(fixture)

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'Destination audit passed: 1 modules for stage fixture')
  })
}

for (const [fixture, behavior] of [
  ['outer-key-survives-inner-shadow', 'an outer browser-global access after an inner same-name key'],
  ['function-browser-alias', 'a function-local browser-global alias'],
  ['block-browser-alias', 'a block-local browser-global alias'],
  ['bare-global', 'an unbound bare localStorage identifier'],
  ['local-storage-from-browser', 'a localStorage binding initialized from a browser global'],
  ['catch-browser-access', 'a browser-global access inside a catch scope'],
  ['parameter-default-global', 'a parameter whose default is globalThis'],
  ['parameter-shadowed-default', 'a globalThis-named parameter whose default is the true window'],
  ['let-browser-alias', 'a function-local let browser-global alias'],
  ['var-browser-alias', 'a function-local var browser-global alias'],
  ['block-let-browser-alias', 'a block-local let browser-global alias'],
  ['let-use-before-safe-overwrite', 'a let browser alias used before its safe overwrite'],
  ['let-assigned-browser', 'a let binding assigned a browser global before use'],
  ['var-block-browser-alias', 'a block-declared var alias hoisted to its function scope'],
]) {
  test(`destination audit rejects ${behavior}`, () => {
    const result = runLexicalLocalStorageFixture(fixture)

    assert.notEqual(result.status, 0)
    assert.equal(
      result.stderr,
      'Forbidden runtime dependency: src/features/warehouse/main.js -> localStorage',
    )
  })
}

for (const [fixture, alias] of [
  ['let-conditional-safe-overwrite', 'browser'],
  ['let-unknown-overwrite', 'browser'],
  ['browser-alias-cycle', 'a'],
]) {
  test(`destination audit fails closed with an exact unresolved alias for ${fixture}`, () => {
    const result = runLexicalLocalStorageFixture(fixture)

    assert.notEqual(result.status, 0)
    assert.equal(
      result.stderr,
      `Unresolved browser-global alias: src/features/warehouse/main.js -> ${alias}`,
    )
  })
}

test('destination audit resolves a forward-declared localStorage key before scanning a function body', () => {
  const result = runFixture('local-storage-forward-key', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden runtime dependency: src/features/warehouse/main.js -> localStorage',
  )
})

test('destination audit folds a constant string expression used on a browser global', () => {
  const result = runFixture('local-storage-constant-expression', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden runtime dependency: src/features/warehouse/main.js -> localStorage',
  )
})

for (const [fixture, browserGlobal] of [
  ['local-storage-global-alias', 'globalThis'],
  ['local-storage-window-alias', 'window'],
  ['local-storage-self-alias', 'self'],
]) {
  test(`destination audit follows a const alias of ${browserGlobal} to localStorage`, () => {
    const result = runFixture(fixture, 'destination')

    assert.notEqual(result.status, 0)
    assert.equal(
      result.stderr,
      'Forbidden runtime dependency: src/features/warehouse/main.js -> localStorage',
    )
  })
}

test('destination audit fails closed on an unresolved computed browser-global property', () => {
  const result = runFixture('local-storage-unresolved-browser-property', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden runtime dependency: src/features/warehouse/main.js -> localStorage',
  )
})

test('destination audit permits unresolved computed access on an ordinary object', () => {
  const result = runFixture('ordinary-object-computed-property', 'destination')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Destination audit passed: 1 modules for stage fixture')
})

for (const [fixture, browserGlobal] of [
  ['local-storage-alias-global', 'globalThis'],
  ['local-storage-alias-window', 'window'],
  ['local-storage-alias-self', 'self'],
]) {
  test(`destination audit rejects a constant localStorage computed alias on ${browserGlobal}`, () => {
    const result = runFixture(fixture, 'destination')

    assert.notEqual(result.status, 0)
    assert.equal(
      result.stderr,
      'Forbidden runtime dependency: src/features/warehouse/main.js -> localStorage',
    )
  })
}
