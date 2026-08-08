import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const outputRoot = await mkdtemp(path.join(tmpdir(), 'shengwang-local-demo-production-'))
const forbiddenTokens = ['320086', 'VITE_LOCAL_DEMO_MODE']
const originalNodeEnv = process.env.NODE_ENV

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(entryPath))
    else if (entry.isFile()) files.push(entryPath)
  }
  return files
}

try {
  process.env.NODE_ENV = 'production'
  const { build } = await import('vite')
  await build({
    root: projectRoot,
    envFile: false,
    mode: 'production',
    logLevel: 'silent',
    build: {
      outDir: outputRoot,
      emptyOutDir: true,
    },
  })

  const builtFiles = await collectFiles(outputRoot)
  assert.ok(builtFiles.length > 0, 'production build emitted no files')
  for (const file of builtFiles) {
    const contents = await readFile(file)
    for (const token of forbiddenTokens) {
      assert.equal(
        contents.includes(Buffer.from(token)),
        false,
        `${token} leaked into ${path.relative(outputRoot, file)}`,
      )
    }
  }

  console.log(`local demo production gate: clean (${builtFiles.length} files scanned)`)
} finally {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  await rm(outputRoot, { recursive: true, force: true })
}
