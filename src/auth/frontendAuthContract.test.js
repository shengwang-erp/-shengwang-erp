import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8').catch(() => '')
}

const [
  appSource,
  authGateSource,
  loginSource,
  passwordPageSource,
  clientSource,
  cssSource,
] = await Promise.all([
  readSource('../App.jsx'),
  readSource('./AuthGate.jsx'),
  readSource('./LoginPage.jsx'),
  readSource('./ChangeTemporaryPasswordPage.jsx'),
  readSource('../lib/supabaseClient.js'),
  readSource('../styles.css'),
])

test('login UI accepts only employee number and password without self-registration identities', () => {
  assert.match(loginSource, /员工编号/)
  assert.match(loginSource, /密码/)
  assert.match(loginSource, /autoComplete="username"/)
  assert.match(loginSource, /autoComplete="current-password"/)
  assert.match(loginSource, /employeeNumber/)
  assert.doesNotMatch(loginSource, /注册|register|电子邮箱|邮箱|手机号|真实姓名|confirmPassword|onRegister/i)
})

test('AuthGate validates startup and every auth transition before mounting business UI', () => {
  assert.match(authGateSource, /getSession\(\)/)
  assert.match(authGateSource, /onAuthStateChange/)
  assert.match(authGateSource, /getCurrentEmployee\(\)/)
  assert.match(authGateSource, /mustChangePassword/)
  assert.match(authGateSource, /ChangeTemporaryPasswordPage/)
  assert.match(authGateSource, /configuration-error/)
  assert.match(authGateSource, /await authService\.logout\(\)/)
  assert.match(authGateSource, /status !== 'authenticated'/)
  assert.match(authGateSource, /children\(\{[\s\S]*currentUser:[\s\S]*onLogout:/)
})

test('AuthGate blocks zero-permission employees outside every business hook', () => {
  assert.match(authGateSource, /effectivePermissionKeys/)
  assert.match(authGateSource, /status:\s*'no-permissions'/)
  assert.match(authGateSource, /gate\.status === 'no-permissions'[\s\S]*?<NoPermissionsPage/)
  assert.match(
    authGateSource,
    /gate\.status === 'no-permissions'[\s\S]*?gate\.status !== 'authenticated'[\s\S]*?children\(/,
  )
  assert.match(authGateSource, /尚未配置权限/)
  assert.match(authGateSource, /修改密码/)
  assert.match(authGateSource, /退出登录/)
})

test('forced-password terminal account errors clear the session instead of keeping stale UI', () => {
  assert.match(authGateSource, /TERMINAL_AUTH_ERROR_CODES/)
  assert.match(
    authGateSource,
    /catch \(error\)[\s\S]*?TERMINAL_AUTH_ERROR_CODES\.has\(error\?\.code\)[\s\S]*?await moveToLogin\(\)/,
  )
})

test('forced password page explains one-time password and offers only change and logout', () => {
  assert.match(passwordPageSource, /初始密码|临时密码/)
  assert.match(passwordPageSource, /至少 12 位/)
  assert.match(passwordPageSource, /autoComplete="new-password"/)
  assert.match(passwordPageSource, /退出登录/)
  assert.doesNotMatch(passwordPageSource, />\s*(?:跳过|稍后|进入 ERP)\s*</)
})

test('App receives currentUser only from AuthGate and contains no legacy browser auth path', () => {
  assert.match(appSource, /import AuthGate from '\.\/auth\/AuthGate'/)
  assert.match(appSource, /function AuthenticatedApp\(\{ currentUser, onLogout \}\)/)
  assert.match(appSource, /<AuthGate>[\s\S]*<AuthenticatedApp/)
  assert.doesNotMatch(appSource, /STORAGE_KEYS\.currentUser|setCurrentUser|handleLogin|handleRegister|createDefaultAdmin|ensureSuperAdminEmployee|isSixDigitPassword/)
  assert.doesNotMatch(appSource, /passwordHash|loginEnabled|employee\.username|SUPER_ADMIN/)
  assert.doesNotMatch(appSource, /localStorage\.(?:getItem|setItem|removeItem)\(['"]currentUser['"]/)
  assert.doesNotMatch(appSource, /['"]\d{6}['"]/)
})

test('authenticated business actions do not regain access from legacy positions or personal arrays', () => {
  assert.match(
    appSource,
    /function canForceLaborRepeat\(currentUser\)\s*\{[\s\S]*?isSuperAdmin\(currentUser\)[\s\S]*?canEdit\(currentUser, '人工记录'\)/,
  )
  assert.doesNotMatch(
    appSource,
    /\['老板',\s*'操作员',\s*'超级管理员'\]\.includes\(currentUser\?\.position\)/,
  )
  assert.doesNotMatch(appSource, /currentUser\.(?:canCreateModules|canEditModules|canDeleteModules|sensitivePermissions)/)
})

test('browser client uses only publishable configuration with anon migration fallback', () => {
  assert.match(clientSource, /VITE_SUPABASE_PUBLISHABLE_KEY/)
  assert.match(clientSource, /VITE_SUPABASE_ANON_KEY/)
  assert.match(clientSource, /persistSession:\s*true/)
  assert.match(clientSource, /autoRefreshToken:\s*true/)
  assert.match(clientSource, /detectSessionInUrl:\s*false/)
  assert.doesNotMatch(clientSource, /VITE_SUPABASE_(?:SERVICE|SECRET|ADMIN)/)
})

test('black-gold branded auth states use the company logo and accessible status regions', () => {
  assert.match(loginSource, /\/sw-erp-logo\.jpg/)
  assert.match(authGateSource, /\/sw-erp-logo\.jpg/)
  assert.match(cssSource, /\.auth-shell[\s\S]*#0b0b09/)
  assert.match(cssSource, /\.auth-brand-mark/)
  assert.match(cssSource, /\.auth-form-error/)
  assert.match(loginSource, /role="alert"/)
  assert.match(authGateSource, /role="status"/)
})
