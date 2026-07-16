import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function read(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`)
  return source.slice(startIndex, endIndex)
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
    /\[storedEmployees,[^\]]*employeeRawState\][\s\S]*?usePersistentState\(STORAGE_KEYS\.employees,[\s\S]*?cloudRead:\s*false[\s\S]*?localCompatibility:\s*true[\s\S]*?readOnly:\s*true/,
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

test('usePersistentState blocks forbidden reads before configuration or loaders and returns the exact raw shape', () => {
  const hook = sliceBetween(appSource, 'function usePersistentState', '\nfunction nextId')
  const deniedBranch = sliceBetween(
    hook,
    '      if (!readAllowed)',
    '      if (!cloudRead)',
  )

  assert.match(hook, /const readAllowed = options\.readAllowed !== false/u)
  assert.ok(hook.indexOf('if (!readAllowed)') < hook.indexOf('if (!isCloudDatabaseReady())'))
  assert.ok(hook.indexOf('if (!readAllowed)') < hook.indexOf('await cloudLoader(key)'))
  assert.match(deniedBranch, /setValue\(fallback\)/u)
  assert.match(deniedBranch, /window\.localStorage\.removeItem\(key\)/u)
  assert.match(
    deniedBranch,
    /setCloudState\(\{\s*loading:\s*false,\s*error:\s*'无权读取该数据',\s*code:\s*'ACCESS_DENIED',\s*source:\s*'blocked',\s*updatedAt:\s*null,?\s*\}\)/u,
  )
  assert.match(
    hook,
    /return \[value, updateValue, cloudState\]/u,
  )
  assert.doesNotMatch(hook, /status\s*:/u)
})

test('read access denial is local while fatal reads and every write failure remain globally fail-closed', () => {
  const hook = sliceBetween(appSource, 'function usePersistentState', '\nfunction nextId')
  const authenticatedApp = sliceBetween(appSource, 'function AuthenticatedApp', '\nfunction HomePage')

  assert.match(hook, /classifyBusinessSourceError\(error\)/u)
  assert.match(hook, /classification\.fatal[\s\S]*?options\.onFatalError\?\./u)
  assert.match(hook, /classification\.status === 'forbidden'/u)
  assert.doesNotMatch(
    sliceBetween(hook, "if (classification.status === 'forbidden')", '\n    }'),
    /onFatalError|onWriteError/u,
  )
  assert.match(hook, /options\.onWriteError\?\./u)
  assert.match(hook, /setValue\(fallback\)[\s\S]*?localStorage\.removeItem\(key\)/u)
  assert.match(
    authenticatedApp,
    /const persistenceOptions = \{[\s\S]*?onFatalError:\s*setPersistenceFailure,[\s\S]*?onWriteError:\s*setPersistenceFailure/u,
  )
})

test('financial persistence callers pass explicit access and preserve raw source states', () => {
  const authenticatedApp = sliceBetween(appSource, 'function AuthenticatedApp', '\nfunction HomePage')

  for (const [storageKey, accessPattern, stateName] of [
    ['salaryRecords', 'accountingReadAccess.salary', 'salaryRawState'],
    ['projectCostRecords', 'accountingReadAccess.projectCost', 'projectCostRawState'],
    ['operatingExpenseRecords', 'accountingReadAccess.operatingExpense', 'operatingExpenseRawState'],
    ['purchaseRecords', 'purchaseReadAccess.records', 'purchaseRawState'],
    ['purchasePaymentRecords', 'purchaseReadAccess.payments', 'purchasePaymentRawState'],
  ]) {
    assert.match(
      authenticatedApp,
      new RegExp(
        `\\[[^\\]]*${stateName}\\][\\s\\S]*?usePersistentState\\(\\s*STORAGE_KEYS\\.${storageKey},[\\s\\S]*?readAllowed:\\s*${accessPattern}`,
        'u',
      ),
    )
  }
  assert.match(authenticatedApp, /const dashboardSourceStates = \{/u)
  assert.match(authenticatedApp, /salary:\s*projectPersistentSource\(salaryRawState/u)
  assert.match(authenticatedApp, /projects:\s*projectPromiseSource\(projectRawState/u)
  assert.match(authenticatedApp, /labor:\s*projectLaborSource\(laborBridgeState/u)
  assert.match(authenticatedApp, /sourceStates=\{dashboardSourceStates\}/u)
})

test('purchase accrual persistence is isolated behind purchaseService secure RPCs', () => {
  const authenticatedApp = sliceBetween(appSource, 'function AuthenticatedApp', '\nfunction HomePage')
  assert.match(appSource, /import \{ purchaseService \} from '\.\/services\/purchaseService\.js'/u)
  assert.match(
    authenticatedApp,
    /cloudLoader:\s*purchaseService\.getList/u,
  )
  assert.match(authenticatedApp, /purchaseService\.create\(/u)
  assert.match(authenticatedApp, /purchaseService\.update\(/u)
  assert.match(authenticatedApp, /purchaseService\.softDelete\(/u)
  assert.doesNotMatch(
    authenticatedApp,
    /(?:getList|saveList|upsertRecord|softDelete)\(STORAGE_KEYS\.purchaseRecords/u,
  )
})
