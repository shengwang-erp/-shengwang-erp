import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function read(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

const [appSource, baseSource, migrationSource, readme] = await Promise.all([
  read('../App.jsx'),
  read('./baseRecordService.js'),
  read('./employeeMigrationService.js'),
  read('../../README.md'),
])

test('App quarantines cloud failures instead of rendering stale local business data', () => {
  assert.doesNotMatch(appSource, /shouldKeepLocalCache|source:\s*'local-cache'/)
  assert.doesNotMatch(appSource, /已暂时使用本机缓存|当前仍使用本机缓存/)
  assert.match(
    appSource,
    /const failClosed[\s\S]*?setValue\(fallback\)[\s\S]*?localStorage\.removeItem\(key\)/,
  )
  assert.match(appSource, /catch \(error\)[\s\S]*?failClosed\(error,/)
  assert.match(appSource, /persistenceFailure/)
  assert.match(appSource, /云端数据访问已停止/)
  assert.match(appSource, /onLogout/)
})

test('legacy employees are local read-only compatibility data with no App write path', () => {
  assert.match(
    appSource,
    /\[storedEmployees\][\s\S]*?usePersistentState\(STORAGE_KEYS\.employees,[\s\S]*?cloudRead:\s*false[\s\S]*?localCompatibility:\s*true[\s\S]*?readOnly:\s*true/,
  )
  assert.match(appSource, /旧员工兼容档案（不可信，只读）/)
  assert.doesNotMatch(appSource, /setEmployees/)
  assert.doesNotMatch(appSource, /saveList\([^\n]*employees|upsertRecord\([^\n]*employees/)
  assert.doesNotMatch(appSource, />\s*新增员工\s*<|保存员工|删除这个员工档案/)
})

test('App migration and reset controls cannot upload or delete legacy employees', () => {
  assert.match(
    appSource,
    /MIGRATABLE_STORAGE_KEYS[\s\S]*?filter\([\s\S]*?STORAGE_KEYS\.employees/,
  )
  assert.match(
    appSource,
    /window\.confirm\([\s\S]*?migrateLocalStorageToSupabase\(storageKeys\)/,
  )
  assert.doesNotMatch(appSource, /handleClearTestData|onClearTestData|测试数据清理/)
})

test('base persistence has no browser identity reader, implicit deletion, or row retry', () => {
  assert.doesNotMatch(baseSource, /readCurrentUser|currentUser|localStorage\.getItem\(['"]currentUser/)
  assert.doesNotMatch(baseSource, /missingKeys|upsertRowsWithFallback/)
  assert.match(baseSource, /LEGACY_EMPLOYEE_WRITE_DENIED/)
  assert.match(baseSource, /requireAuthenticatedSession/)
  assert.match(baseSource, /LEGACY_MIGRATION_ALLOWED_STORAGE_KEYS/)
})

test('legacy employee migration remains report-only with no cloud or Auth mutation dependency', () => {
  assert.match(migrationSource, /writePolicy:\s*'report-only'/)
  assert.match(migrationSource, /requiresExplicitServerAdminWrite:\s*true/)
  assert.doesNotMatch(
    migrationSource,
    /supabase|functions\.invoke|auth\.admin|createUser|updateUser|fetch\(/i,
  )
})

test('README documents the secure deployment order and browser/server separation', () => {
  assert.match(readme, /数据库迁移/)
  assert.match(readme, /Edge Functions/)
  assert.match(readme, /SW-000/)
  assert.match(readme, /移除[^\n]*(?:引导|bootstrap)[^\n]*(?:密钥|密码)/i)
  assert.match(readme, /部署新版前端/)
  assert.match(readme, /VITE_SUPABASE_PUBLISHABLE_KEY/)
  assert.match(readme, /SUPABASE_SECRET_KEY/)
  assert.match(readme, /AUTH_ID_DERIVATION_SECRET/)
  assert.match(readme, /失败关闭|fail-closed/i)
  assert.match(readme, /不提供自助注册/)
  assert.match(readme, /手工映射/)
  assert.doesNotMatch(readme, /真实姓名\s*\+\s*6\s*位数字密码|当前版本已经加入测试阶段登录\/注册/)
})
