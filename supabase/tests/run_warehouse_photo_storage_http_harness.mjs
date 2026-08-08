import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HTTP_SCRIPT = fileURLToPath(new URL('./warehouse_photo_storage_http.mjs', import.meta.url))
const TARGET_KEYS = Object.freeze([
  'WAREHOUSE_TASK3_PROJECT_ID',
  'WAREHOUSE_TASK3_WORKDIR',
  'WAREHOUSE_TASK3_DB_CONTAINER',
  'WAREHOUSE_TASK3_DOCKER_CONTEXT',
  'WAREHOUSE_TASK3_DB_PORT',
  'WAREHOUSE_TASK3_API_PORT',
])
const RUNS = Object.freeze([
  Object.freeze({ name: 'pass-1', failurePoint: '', expectedCode: 0 }),
  Object.freeze({ name: 'pass-2', failurePoint: '', expectedCode: 0 }),
  Object.freeze({ name: 'injected-cleanup', failurePoint: 'after_profiles', expectedCode: 1 }),
  Object.freeze({ name: 'pass-3', failurePoint: '', expectedCode: 0 }),
])

function fail(message) {
  throw new Error(message)
}

function validateEnvironment(environment) {
  if (!environment || typeof environment !== 'object') fail('HTTP harness environment invalid')
  if (Object.hasOwn(environment, 'WAREHOUSE_TASK3_HTTP_FAILURE_POINT')) {
    fail('HTTP harness ambient failure injection forbidden')
  }
  for (const key of TARGET_KEYS) {
    const value = environment[key]
    if (typeof value !== 'string' || !value || value !== value.trim()) {
      fail(`HTTP harness missing explicit ${key}`)
    }
  }
}

async function defaultRun(environment) {
  const child = spawn(process.execPath, [HTTP_SCRIPT], {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  if (result.signal !== null || !Number.isInteger(result.code)) {
    fail('HTTP harness child did not exit normally')
  }
  return { code: result.code, stdout, stderr }
}

function proof(result, expectedCode) {
  if (!result || typeof result !== 'object' || result.code !== expectedCode) {
    fail('HTTP harness child exit contract failed')
  }
  const source = expectedCode === 0 ? result.stdout : result.stderr
  const lines = typeof source === 'string'
    ? source.split('\n').map((line) => line.trim()).filter(Boolean)
    : []
  let parsed
  try { parsed = JSON.parse(lines.at(-1) ?? '') } catch { fail('HTTP harness cleanup proof invalid') }
  if (
    parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) ||
    parsed.ok !== (expectedCode === 0) ||
    typeof parsed.runId !== 'string' || !parsed.runId ||
    parsed.cleanupVerified !== true ||
    parsed.runScopedRemaining !== 0 ||
    parsed.triggersEnabled !== true ||
    parsed.fixedPermissionGrants !== 0 ||
    (expectedCode === 1 && (
      parsed.failurePoint !== 'after_profiles' || parsed.failureInjected !== true
    ))
  ) fail('HTTP harness cleanup proof invalid')
  return Object.freeze({
    runId: parsed.runId,
    cleanupVerified: true,
    runScopedRemaining: 0,
    triggersEnabled: true,
    fixedPermissionGrants: 0,
  })
}

export async function runWarehousePhotoStorageHttpHarness(environment, supplied = {}) {
  validateEnvironment(environment)
  const run = supplied.run ?? defaultRun
  if (typeof run !== 'function') fail('HTTP harness runner invalid')
  const runs = []
  for (const scenario of RUNS) {
    const childEnvironment = { ...environment }
    delete childEnvironment.WAREHOUSE_TASK3_HTTP_FAILURE_POINT
    if (scenario.failurePoint) {
      childEnvironment.WAREHOUSE_TASK3_HTTP_FAILURE_POINT = scenario.failurePoint
    }
    const result = await run(childEnvironment)
    runs.push(Object.freeze({ name: scenario.name, ...proof(result, scenario.expectedCode) }))
  }
  return Object.freeze({ runs: Object.freeze(runs) })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await runWarehousePhotoStorageHttpHarness(process.env)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
