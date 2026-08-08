import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

const execFileAsync = promisify(execFile)
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const authGatePath = fileURLToPath(new URL('./AuthGate.jsx', import.meta.url))
const runtimeSourceRoot = fileURLToPath(new URL('../', import.meta.url))
const productionGatePath = fileURLToPath(
  new URL('../../scripts/verify-local-demo-production-build.mjs', import.meta.url),
)

async function renderAuthGateWithDemoFlag(flag) {
  const originalFlag = process.env.VITE_LOCAL_DEMO_MODE
  if (flag === undefined) delete process.env.VITE_LOCAL_DEMO_MODE
  else process.env.VITE_LOCAL_DEMO_MODE = flag

  const server = await createServer({
    root: projectRoot,
    envFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })

  try {
    const { default: AuthGate } = await server.ssrLoadModule('/src/auth/AuthGate.jsx')
    return renderToStaticMarkup(
      createElement(
        AuthGate,
        { configured: false },
        ({ currentUser }) =>
          createElement('span', { 'data-employee': currentUser.employeeNumber }, currentUser.employeeNumber),
      ),
    )
  } finally {
    await server.close()
    if (originalFlag === undefined) delete process.env.VITE_LOCAL_DEMO_MODE
    else process.env.VITE_LOCAL_DEMO_MODE = originalFlag
  }
}

test('local demo defaults off and accepts only the exact true opt-in during development', async () => {
  for (const flag of [undefined, 'false', '1', 'TRUE']) {
    const markup = await renderAuthGateWithDemoFlag(flag)
    assert.match(markup, /系统配置未完成/, `flag ${String(flag)} must remain fail-closed`)
    assert.doesNotMatch(markup, /data-employee="SW-000"/)
  }

  const enabledMarkup = await renderAuthGateWithDemoFlag('true')
  assert.match(enabledMarkup, /data-employee="SW-000"/)
})

test('local demo authorization stays scoped to the explicit DEV and exact flag conjunction', async () => {
  const source = await readFile(authGatePath, 'utf8')
  assert.match(
    source,
    /const localDemoMode = import\.meta\.env\.DEV && import\.meta\.env\.VITE_LOCAL_DEMO_MODE === 'true'/,
  )
})

test('local demo runtime markers do not spread beyond approved files', async () => {
  const entries = await readdir(runtimeSourceRoot, { recursive: true, withFileTypes: true })
  const runtimeFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !/\.test\.[cm]?[jt]sx?$/.test(file))

  const credentialFiles = []
  const flagFiles = []
  for (const file of runtimeFiles) {
    const source = await readFile(file, 'utf8')
    const relative = path.relative(runtimeSourceRoot, file)
    if (source.includes('320086')) credentialFiles.push(relative)
    if (source.includes('VITE_LOCAL_DEMO_MODE')) flagFiles.push(relative)
  }

  assert.deepEqual(credentialFiles.sort(), ['auth/AuthGate.jsx'])
  assert.deepEqual(flagFiles.sort(), ['App.jsx', 'auth/AuthGate.jsx'])
})

test('production security gate strips the local demo flag and credential from built assets', async () => {
  const { stdout } = await execFileAsync(process.execPath, [productionGatePath], {
    cwd: projectRoot,
    env: { ...process.env, VITE_LOCAL_DEMO_MODE: 'true' },
  })
  assert.match(stdout, /local demo production gate: clean/)
})
