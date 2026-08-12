import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act, createElement } from 'react'
import test, { after } from 'node:test'
import { createServer } from 'vite'

import {
  findWarehouseTestElement,
  installWarehouseReactDom,
  TestEvent,
} from '../warehouse/warehouseReactDomTestUtils.js'

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8').catch(() => '')
}

const [pageSource, dialogSource, appSource, cssSource] = await Promise.all([
  readSource('./PersonnelPage.jsx'),
  readSource('./EmployeeCredentialsDialog.jsx'),
  readSource('../../App.jsx'),
  readSource('../../styles.css'),
])

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(),
  cacheDir: '/private/tmp/personnel-page-contract-vite-cache',
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  esbuild: { jsx: 'automatic' },
  server: { middlewareMode: true },
})
const personnelModule = await server.ssrLoadModule(
  '/src/features/employees/PersonnelPage.jsx',
)
const PersonnelPage = personnelModule.default
after(() => server.close())

function personnelElement(root, predicate) {
  return findWarehouseTestElement(root, predicate)
}

function personnelButton(root, label) {
  return personnelElement(root, (element) =>
    element.nodeName === 'BUTTON' && element.textContent.trim() === label)
}

function personnelField(root, name) {
  return personnelElement(root, (element) =>
    ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.nodeName) &&
    (element.getAttribute('name') === name || element.name === name))
}

async function changePersonnelField(element, value) {
  await act(async () => {
    element.value = value
    element.dispatchEvent(new TestEvent('input'))
    element.dispatchEvent(new TestEvent('change'))
  })
}

test('personnel form uses the fixed domain options with explicit required selections', () => {
  assert.match(
    pageSource,
    /import[\s\S]*DEPARTMENT_OPTIONS[\s\S]*POSITION_OPTIONS[\s\S]*isPersonnelAdministrator[\s\S]*from ['"]\.\.\/\.\.\/auth\/employeeAuthDomain\.js['"]/,
  )
  assert.match(pageSource, /department:\s*''/)
  assert.match(pageSource, /position:\s*''/)
  assert.match(pageSource, /options=\{DEPARTMENT_OPTIONS\}/)
  assert.match(pageSource, /options=\{POSITION_OPTIONS\}/)
  assert.match(pageSource, /name="department"[\s\S]*required/)
  assert.match(pageSource, /name="position"[\s\S]*required/)
  assert.match(pageSource, /员工编号将在保存成功后自动生成/)
  assert.match(pageSource, /value=\{formState\.values\.employeeNumber[\s\S]*readOnly/)
})

test('page has no legacy credential, personal permission, local ID, delete, or persistence path', () => {
  assert.doesNotMatch(
    pageSource,
    /loginAccount|passwordHash|loginEnabled|accessibleModules|canCreateModules|canEditModules|canDeleteModules|sensitivePermissions/,
  )
  assert.doesNotMatch(pageSource, /nextId|setEmployees|saveList|employeeService/)
  assert.doesNotMatch(pageSource, /localStorage|sessionStorage|indexedDB|console\./i)
  assert.doesNotMatch(pageSource, /删除员工|物理删除|handleDelete|onDelete/)
})

test('fixed administrators alone see mutation controls and protected rows are untargetable', () => {
  assert.match(pageSource, /const canAdminister\s*=\s*isPersonnelAdministrator\(currentEmployee\)/)
  assert.match(pageSource, /\{canAdminister\s*&&/)
  assert.match(pageSource, /employee\.employeeNumber\s*!==\s*['"]SW-000['"]/)
  assert.match(pageSource, /!employee\.isHiddenSystemAccount/)
  assert.match(pageSource, /启用账号/)
  assert.match(pageSource, /停用账号/)
  assert.match(pageSource, /生成临时密码/)
  assert.match(pageSource, /employee\.id\s*!==\s*currentEmployee\.id/)
})

test('provision retains one request ID, blocks duplicate submit, and handles replay explicitly', () => {
  assert.equal((pageSource.match(/crypto\.randomUUID\(\)/g) || []).length, 1)
  assert.match(pageSource, /requestId:\s*crypto\.randomUUID\(\)/)
  assert.match(
    pageSource,
    /provisionEmployee\(\{[\s\S]*requestId:\s*formState\.requestId[\s\S]*profile:/,
  )
  assert.match(pageSource, /if \(mutation\) return/)
  assert.match(pageSource, /disabled=\{Boolean\(mutation\)\}/)
  assert.match(
    pageSource,
    /setCredentials\(\{[\s\S]*initialPassword:[\s\S]*\}\)[\s\S]*await onRefreshEmployees\(\)/,
  )
  assert.match(
    pageSource,
    /员工已创建，但一次性初始密码不能再次查看；如未安全交付，请生成新的临时密码。/,
  )
})

test('edit loads detail on demand and sends only authorized dirty loaded fields', () => {
  assert.match(pageSource, /await employeeAdmin\.getEmployeeProfileDetail\(employee\.id\)/)
  assert.match(pageSource, /loadedKeys:\s*new Set\(Object\.keys\(detail\)\)/)
  assert.match(pageSource, /dirtyKeys:\s*new Set\(\)/)
  assert.match(pageSource, /function buildDirtyPatch/)
  assert.match(pageSource, /formState\.dirtyKeys/)
  assert.match(pageSource, /formState\.loadedKeys/)
  assert.match(pageSource, /employeeAdmin\.updateProfile\(\{[\s\S]*patch/)
  assert.doesNotMatch(pageSource, /patch:\s*\{\s*\.\.\.formState\.values/)
})

test('administrator form owns the exact daily-attendance boolean and exposes its current mode', () => {
  assert.match(pageSource, /attendanceRequired:\s*true/u)
  assert.match(pageSource, /name="attendanceRequired"/u)
  assert.match(pageSource, /需要每日打卡/u)
  assert.match(pageSource, /免打卡人员按正常全勤进入月度工资/u)
  assert.match(
    pageSource,
    /checked=\{formState\.values\.attendanceRequired === true\}/u,
  )
  assert.match(
    pageSource,
    /handleFieldChange\('attendanceRequired', event\.target\.checked\)/u,
  )
  assert.match(pageSource, /employee\.attendanceRequired === true[\s\S]*每日打卡[\s\S]*免打卡/u)
  assert.match(
    pageSource,
    /setCredentials\([\s\S]*employeeAdmin\.updateProfile\(\{[\s\S]*patch:\s*\{ attendanceRequired: false \}/u,
  )
})

test('failed post-provision attendance policy remains retryable without provisioning twice', async () => {
  const employeeId = 'd7c66406-028c-44d8-90f4-24a04c448cc1'
  let provisionCalls = 0
  let updateCalls = 0
  let refreshCalls = 0
  const updateInputs = []
  const employeeAdmin = {
    async provisionEmployee() {
      provisionCalls += 1
      return {
        employee: {
          id: employeeId,
          employeeNumber: 'SW-8812',
          name: '免打卡员工',
          department: '总务部',
          position: '总务部长',
          employmentStatus: '在职',
          accountStatus: 'active',
          attendanceRequired: true,
          mustChangePassword: true,
        },
        initialPassword: 'SecureStart2A',
      }
    },
    async updateProfile(input) {
      updateCalls += 1
      updateInputs.push(input)
      if (updateCalls === 1) {
        const error = new Error('打卡政策暂未保存，请重试')
        error.name = 'EmployeeAdminError'
        throw error
      }
      return { employee: { id: employeeId } }
    },
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(PersonnelPage, {
      employees: [],
      currentEmployee: {
        id: '4ec4b517-27d8-4cf6-8ee1-5112d12b43c0',
        employeeNumber: 'SW-000',
        name: '系统管理员',
        department: '总务部',
        position: '社长',
        employmentStatus: '在职',
        accountStatus: 'active',
        mustChangePassword: false,
        effectivePermissionKeys: ['all'],
      },
      employeeAdmin,
      onRefreshEmployees: async () => { refreshCalls += 1 },
      onAuthInvalid() {},
      onCriticalStateChange: () => true,
      permissionTemplateService: {
        readPermissionTemplates: () => new Promise(() => {}),
      },
    })))

    await act(async () => personnelButton(container, '新增员工').click())
    await changePersonnelField(personnelField(container, 'name'), '免打卡员工')
    await changePersonnelField(personnelField(container, 'department'), '总务部')
    await changePersonnelField(personnelField(container, 'position'), '总务部长')
    const attendanceRequired = personnelField(container, 'attendanceRequired')
    await act(async () => {
      attendanceRequired.checked = false
      attendanceRequired.click()
    })

    const createForm = personnelElement(container, (element) =>
      element.nodeName === 'FORM' && element.className === 'personnel-form')
    await act(async () => createForm.dispatchEvent(new TestEvent('submit')))

    assert.equal(provisionCalls, 1)
    assert.equal(updateCalls, 1)
    assert.equal(refreshCalls, 0)
    assert.ok(personnelField(container, 'attendanceRequired'))
    assert.equal(personnelField(container, 'attendanceRequired').checked, false)
    assert.match(container.textContent, /打卡政策暂未保存，请重试/u)

    const retryForm = personnelElement(container, (element) =>
      element.nodeName === 'FORM' && element.className === 'personnel-form')
    await act(async () => retryForm.dispatchEvent(new TestEvent('submit')))

    assert.equal(provisionCalls, 1)
    assert.equal(updateCalls, 2)
    assert.equal(refreshCalls, 1)
    assert.deepEqual(updateInputs, [
      { employeeId, patch: { attendanceRequired: false } },
      { employeeId, patch: { attendanceRequired: false } },
    ])
    assert.equal(personnelElement(container, (element) =>
      element.nodeName === 'FORM' && element.className === 'personnel-form'), null)
  } finally {
    await act(async () => root.unmount())
    dom.cleanup()
  }
})

test('an unchanged edit cannot submit an empty patch', () => {
  assert.match(
    pageSource,
    /Object\.keys\(patch\)\.length === 0[\s\S]*没有需要保存的修改[\s\S]*return/,
  )
  assert.match(
    pageSource,
    /formState\.mode === 'edit'[\s\S]{0,100}formState\.dirtyKeys\.size === 0/,
  )
})

test('sensitive identity and salary controls require effective view and update permissions', () => {
  for (const permission of [
    '查看人员身份资料',
    '修改人员身份资料',
    '查看工资',
    '修改工资',
  ]) {
    assert.match(pageSource, new RegExp(`canViewSensitive\\(currentEmployee, ['"]${permission}['"]\\)`))
  }
  assert.match(pageSource, /showIdentityFields/)
  assert.match(pageSource, /showSalaryFields/)
  assert.match(pageSource, /loadedKeys\.has/)
  assert.match(pageSource, /salaryType/)
  assert.match(pageSource, /baseSalary:\s*null[\s\S]*dailySalary:\s*null[\s\S]*hourlyWage:\s*null/)
  assert.doesNotMatch(pageSource, /salaryType[\s\S]{0,120}patch\s*\[/)
})

test('mutations refresh only after server completion and auth-invalid errors delegate to logout', () => {
  assert.match(
    pageSource,
    /await employeeAdmin\.updateProfile\([\s\S]*?\)[\s\S]*await finishProfileUpdate\(/,
  )
  assert.match(
    pageSource,
    /await employeeAdmin\.setAccountStatus\([\s\S]*?\)[\s\S]*await onRefreshEmployees\(\)/,
  )
  assert.match(
    pageSource,
    /await employeeAdmin\.resetTemporaryPassword\([\s\S]*?\)[\s\S]*setCredentials\([\s\S]*await onRefreshEmployees\(\)/,
  )
  assert.match(pageSource, /error\?\.authInvalid[\s\S]*onAuthInvalid\(\)/)
  assert.doesNotMatch(pageSource, /employees\.(?:push|splice)|setPersonnelEmployees/)
})

test('self revalidation bypasses refresh and refresh warnings preserve prior operation notices', () => {
  assert.match(pageSource, /requiresSelfAuthorizationRevalidation/)
  assert.match(pageSource, /await finishProfileUpdate\(\{[\s\S]*requiresRevalidation/)
  assert.match(pageSource, /onAuthInvalid,[\s\S]*onRefreshEmployees,/)
  assert.match(
    pageSource,
    /onRefreshFailure:\s*\(caught\)\s*=>[\s\S]*handleRefreshFailure\(\s*caught,\s*'资料已更新，但目录刷新失败；请稍后手动刷新。',?\s*\)/,
  )
  assert.match(
    pageSource,
    /setNotice\(\(current\) => appendPersonnelNotice\(current, message\)\)/,
  )
  assert.doesNotMatch(
    pageSource,
    /await onRefreshEmployees\(\)[\s\S]{0,300}if \(requiresRevalidation\) onAuthInvalid\(\)/,
  )
})

test('temporary-password reset is available only for active employed accounts', () => {
  assert.match(
    pageSource,
    /function canResetTemporaryPassword\(employee\)[\s\S]*employee\.accountStatus === 'active'[\s\S]*employee\.employmentStatus === '在职'/,
  )
  assert.match(
    pageSource,
    /if \(!canResetTemporaryPassword\(employee\)\) return/,
  )
  assert.match(
    pageSource,
    /disabled=\{Boolean\(mutation\) \|\| templateCritical \|\| !canResetTemporaryPassword\(employee\)\}/,
  )
  assert.match(pageSource, /仅已启用且在职员工可重置临时密码/)
})

test('partial account-status failures reconcile the canonical directory before settling', () => {
  const statusStart = pageSource.indexOf('const handleAccountStatus = async')
  const statusEnd = pageSource.indexOf('const handleResetPassword = async', statusStart)
  const statusSource = pageSource.slice(statusStart, statusEnd)

  assert.match(statusSource, /reconcileAccountStatusFailure/)
  assert.match(
    statusSource,
    /catch \(caught\) \{[\s\S]*await reconcileAccountStatusFailure\(\{[\s\S]*error:\s*caught,/,
  )
  assert.match(statusSource, /onOperationError:\s*handleOperationError/)
  assert.match(statusSource, /onRefreshEmployees,/)
  assert.match(
    statusSource,
    /账号状态可能已变化，但目录刷新失败；请稍后手动刷新。/,
  )
})

test('credential dialog copies only credentials and cannot close before acknowledgement', () => {
  assert.match(dialogSource, /role="dialog"/)
  assert.match(dialogSource, /aria-modal="true"/)
  assert.match(dialogSource, /aria-labelledby=/)
  assert.match(dialogSource, /navigator\.clipboard\.writeText/)
  assert.match(dialogSource, />复制员工编号</)
  assert.match(dialogSource, />复制初始密码</)
  assert.match(dialogSource, />全部复制</)
  assert.match(dialogSource, /员工编号：\$\{employeeNumber\}\\n初始密码：\$\{initialPassword\}/)
  assert.match(dialogSource, /我已安全保存并交付以上凭据/)
  assert.match(dialogSource, /disabled=\{!acknowledged\}/)
  assert.match(dialogSource, /event\.key === 'Escape'/)
  assert.match(dialogSource, /event\.preventDefault\(\)/)
  assert.match(dialogSource, /onClose\(\)/)
})

test('credential dialog reports generic copy status and has no persistence or logging path', () => {
  assert.match(dialogSource, /初始密码已复制/)
  assert.match(dialogSource, /复制失败，请手动选择并安全保存凭据/)
  assert.match(dialogSource, /操作系统剪贴板/)
  assert.doesNotMatch(dialogSource, /console\.|localStorage|sessionStorage|indexedDB|analytics/i)
  assert.doesNotMatch(dialogSource, /onClose\([^)]*(?:employeeNumber|initialPassword)/)
})

test('App owns a memory-only canonical directory and passes the AuthGate boundary unchanged', () => {
  assert.match(appSource, /import PersonnelPage from ['"]\.\/features\/employees\/PersonnelPage['"]/)
  assert.match(appSource, /import \{ employeeAdminService \} from ['"]\.\/services\/employeeAdminService['"]/)
  assert.match(appSource, /const \[personnelEmployees, setPersonnelEmployees\] = useState\(\[\]\)/)
  assert.match(appSource, /const \[personnelLoadState, setPersonnelLoadState\] = useState/)
  assert.match(appSource, /const refreshPersonnelEmployees = useCallback/)
  assert.match(appSource, /employeeAdminService\.listEmployeeDirectory\(\)/)
  assert.match(appSource, /currentView !== 'employees'/)
  assert.match(appSource, /<PersonnelPage[\s\S]*employees=\{personnelEmployees\}/)
  assert.match(appSource, /currentEmployee=\{currentUser\}/)
  assert.match(appSource, /employeeAdmin=\{employeeAdminService\}/)
  assert.match(appSource, /onAuthInvalid=\{onLogout\}/)
  assert.doesNotMatch(appSource, /function PersonnelPage\s*\(/)
  assert.doesNotMatch(appSource, /<PersonnelPage[\s\S]{0,500}setEmployees=/)
})

test('permission templates refresh the AuthGate profile without forcing re-login', () => {
  assert.match(
    pageSource,
    /import PermissionTemplateEditor from ['"]\.\/PermissionTemplateEditor\.jsx['"]/,
  )
  assert.match(pageSource, /permissionTemplateService/)
  assert.match(pageSource, /onPermissionTemplatesChanged/)
  assert.match(
    pageSource,
    /\{canAdminister && !employeeFlowActive && \([\s\S]*<PermissionTemplateEditor/,
  )
  assert.match(pageSource, /currentEmployee=\{currentEmployee\}/)
  assert.match(pageSource, /permissionTemplateService=\{permissionTemplateService\}/)
  assert.match(pageSource, /onTemplatesChanged=\{onPermissionTemplatesChanged\}/)
  assert.match(pageSource, /onAuthInvalid=\{onAuthInvalid\}/)

  assert.match(
    appSource,
    /import \{ permissionTemplateService \} from ['"]\.\/services\/permissionTemplateService(?:\.js)?['"]/,
  )
  assert.match(appSource, /permissionTemplateService=\{permissionTemplateService\}/)
  assert.match(appSource, /onPermissionTemplatesChanged=\{onRefreshCurrentUser\}/)
  assert.doesNotMatch(appSource, /onPermissionTemplatesChanged=\{onLogout\}/)
  assert.doesNotMatch(appSource, /currentUser\.(?:effectivePermissionKeys|department|position)\s*=/)
})

test('employee and template locks stay independent, aggregate with OR, and block cross-mutations', () => {
  assert.match(pageSource, /const \[templateCritical, setTemplateCritical\] = useState\(false\)/)
  assert.match(pageSource, /const templateCriticalRef = useRef\(false\)/)
  assert.match(pageSource, /const handleTemplateCriticalStateChange = useCallback/)
  assert.match(
    pageSource,
    /onTemplateCriticalStateChange\?\.\(nextActive\) !== true[\s\S]*return false/,
  )
  assert.match(pageSource, /templateCriticalRef\.current = nextActive/)
  assert.match(pageSource, /setTemplateCritical\(nextActive\)/)
  assert.match(pageSource, /onMutationStateChange=\{handleTemplateCriticalStateChange\}/)
  assert.match(
    pageSource,
    /const employeeFlowActive = Boolean\(formState \|\| mutation \|\| credentials\)/,
  )
  assert.match(
    pageSource,
    /const protectedStateActive = employeeProtectedStateActive \|\| templateCritical/,
  )
  assert.match(pageSource, /if \(!canAdminister \|\| mutation \|\| templateCriticalRef\.current\) return/)
  assert.match(
    pageSource,
    /disabled=\{Boolean\(mutation\) \|\| templateCritical\}/,
  )

  assert.match(appSource, /const \[employeeCritical, setEmployeeCritical\] = useState\(false\)/)
  assert.match(appSource, /const employeeCriticalRef = useRef\(false\)/)
  assert.match(appSource, /const \[templateCritical, setTemplateCritical\] = useState\(false\)/)
  assert.match(appSource, /const templateCriticalRef = useRef\(false\)/)
  assert.match(
    appSource,
    /const personnelProtectedState = combinePersonnelProtectionSources\(\{[\s\S]*employeeCritical,[\s\S]*templateCritical,[\s\S]*\}\)/,
  )
  assert.match(appSource, /const handlePersonnelCriticalStateChange = useCallback/)
  assert.match(appSource, /const handleTemplateCriticalStateChange = useCallback/)
  assert.match(
    appSource,
    /personnelProtectedStateRef\.current = combinePersonnelProtectionSources\(\{[\s\S]*employeeCritical:\s*employeeCriticalRef\.current,[\s\S]*templateCritical:\s*templateCriticalRef\.current/,
  )
  assert.match(appSource, /onTemplateCriticalStateChange=\{handleTemplateCriticalStateChange\}/)
})

test('App gives each employee-directory caller single ownership of auth-invalid logout', () => {
  const refreshStart = appSource.indexOf('const refreshPersonnelEmployees = useCallback')
  const refreshEnd = appSource.indexOf('const refreshProjectEmployeeDirectory', refreshStart)
  const effectStart = appSource.indexOf(
    'useEffect(() => {',
    appSource.indexOf('const personnelExitBlocked', refreshEnd),
  )
  const effectEnd = appSource.indexOf('const refreshStoredProjectsFromLocal', effectStart)
  const refreshSource = appSource.slice(refreshStart, refreshEnd)
  const initialLoadEffectSource = appSource.slice(effectStart, effectEnd)

  assert.doesNotMatch(refreshSource, /onLogout/)
  assert.match(
    initialLoadEffectSource,
    /refreshPersonnelEmployees\(\)\.catch\(\(error\) => \{[\s\S]*error\?\.authInvalid[\s\S]*onLogout\(\)/,
  )
})

test('App owns a hard exit lock for employee credentials and permission-template saves', () => {
  assert.match(pageSource, /acquirePersonnelProtection/)
  assert.match(pageSource, /hasProtectedPersonnelState/)
  assert.match(pageSource, /onCriticalStateChange/)
  assert.doesNotMatch(
    pageSource,
    /useEffect\([\s\S]{0,180}onCriticalStateChange\?\.\(protectedStateActive\)/,
  )
  assert.match(pageSource, /onClick=\{onBack\}[\s\S]{0,120}disabled=\{protectedStateActive\}/)

  const createStart = pageSource.indexOf('const handleSubmit = async')
  const createCall = pageSource.indexOf('employeeAdmin.provisionEmployee', createStart)
  const createSource = pageSource.slice(createStart, createCall)
  assert.match(
    createSource,
    /const protectedOperation = formState\.mode === 'create'[\s\S]*!acquirePersonnelProtection\(onCriticalStateChange\)[\s\S]*setError\([\s\S]*return/,
  )

  const resetStart = pageSource.indexOf('const handleResetPassword = async')
  const resetCall = pageSource.indexOf('employeeAdmin.resetTemporaryPassword', resetStart)
  const resetSource = pageSource.slice(resetStart, resetCall)
  assert.match(
    resetSource,
    /if \(!acquirePersonnelProtection\(onCriticalStateChange\)\) \{[\s\S]*return/,
  )
  assert.match(
    pageSource,
    /\{credentials && !mutation && \([\s\S]*<EmployeeCredentialsDialog/,
  )

  assert.match(appSource, /combinePersonnelProtectionSources/)
  assert.match(appSource, /const personnelProtectedStateRef = useRef\(false\)/)
  assert.match(appSource, /const handlePersonnelCriticalStateChange = useCallback/)
  assert.match(
    appSource,
    /employeeCriticalRef\.current\s*=\s*nextActive[\s\S]*setEmployeeCritical\(nextActive\)[\s\S]*return true/,
  )
  assert.match(appSource, /shouldBlockPersonnelExit/)
  assert.match(appSource, /const handlePersonnelAwareNavigate = useCallback/)
  assert.match(
    appSource,
    /handlePersonnelAwareNavigate[\s\S]{0,500}protectedStateActive:\s*personnelProtectedStateRef\.current/,
  )
  assert.match(appSource, /const handlePersonnelAwareLogout = useCallback/)
  assert.match(
    appSource,
    /handlePersonnelAwareLogout[\s\S]{0,400}protectedStateActive:\s*personnelProtectedStateRef\.current/,
  )
  assert.match(appSource, /window\.addEventListener\(['"]beforeunload['"], preventProtectedExit\)/)
  assert.match(
    appSource,
    /preventProtectedExit[\s\S]{0,400}protectedStateActive:\s*personnelProtectedStateRef\.current/,
  )
  assert.match(appSource, /event\.preventDefault\(\)[\s\S]*event\.returnValue = ['"]['"]/)
  assert.match(appSource, /onNavigate=\{handlePersonnelAwareNavigate\}/)
  assert.match(appSource, /onLogout=\{handlePersonnelAwareLogout\}/)
  assert.match(appSource, /onCriticalStateChange=\{handlePersonnelCriticalStateChange\}/)
  assert.match(appSource, /onBack=\{\(\) => handlePersonnelAwareNavigate\(['"]home['"]\)\}/)
  assert.match(appSource, /onAuthInvalid=\{onLogout\}/)
})

test('new personnel and credential styles are prefixed and responsive', () => {
  assert.match(cssSource, /\.personnel-page/)
  assert.match(cssSource, /\.personnel-actions/)
  assert.match(cssSource, /\.credentials-backdrop/)
  assert.match(cssSource, /\.credentials-dialog/)
  assert.match(cssSource, /@media[\s\S]*\.personnel-actions[\s\S]*\.credentials-grid/)
  assert.match(cssSource, /\.permission-template-editor/)
  assert.match(cssSource, /\.permission-template-matrix-scroll/)
  assert.match(cssSource, /\.permission-template-sensitive-grid/)
  assert.match(cssSource, /\.permission-template-save/)
  assert.match(
    cssSource,
    /@media \(max-width: 680px\)[\s\S]*\.permission-template-heading[\s\S]*\.permission-template-actions/,
  )
})
