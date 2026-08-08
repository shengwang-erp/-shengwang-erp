const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const OBJECT_PATH = new RegExp(`^${UUID_SEGMENT}/${UUID_SEGMENT}\\.jpg$`, 'u')
const TARGET_BUCKET = 'warehouse-item-photos'

function fail(message) {
  throw new Error(message)
}

function exactPair(value) {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !Object.hasOwn(value, 'bucket') || !Object.hasOwn(value, 'path') ||
    Object.keys(value).sort().join(',') !== 'bucket,path' ||
    value.bucket !== TARGET_BUCKET ||
    typeof value.path !== 'string' || !OBJECT_PATH.test(value.path)
  ) fail('invalid warehouse photo Storage pair')
  return { bucket: value.bucket, path: value.path }
}

function key(pair) {
  return `${pair.bucket}\u0000${pair.path}`
}

function exactPairs(value, name) {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
    fail(`invalid ${name}`)
  }
  const pairs = value.map(exactPair)
  if (new Set(pairs.map(key)).size !== pairs.length) fail(`duplicate ${name}`)
  return pairs
}

export function exactAttemptedStoragePaths(scope) {
  if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) {
    fail('invalid attempted Storage path scope')
  }
  const allowed = exactPairs(scope.allowedStoragePaths, 'run Storage allowlist')
  const allowedKeys = new Set(allowed.map(key))
  const attempted = exactPairs(scope.attemptedStoragePaths, 'attempted Storage paths')
  if (attempted.some((pair) => !allowedKeys.has(key(pair)))) {
    fail('attempted Storage path is not in the run allowlist')
  }
  return attempted.map((pair) => Object.freeze(pair))
}

export function registerAttemptedStoragePath(scope, bucket, path) {
  const candidate = exactPair({ bucket, path })
  const allowed = exactPairs(scope?.allowedStoragePaths, 'run Storage allowlist')
  if (!allowed.some((pair) => key(pair) === key(candidate))) {
    fail('attempted Storage path is not in the run allowlist')
  }
  const attempted = exactAttemptedStoragePaths(scope)
  if (!attempted.some((pair) => key(pair) === key(candidate))) {
    scope.attemptedStoragePaths.push(Object.freeze(candidate))
  }
  return Object.freeze(candidate)
}
