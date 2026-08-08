import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  SENSITIVE_PERMISSION_CATALOG,
  templateContainsForbiddenProjectFinancialGrant,
  WAREHOUSE_PERMISSION_CATALOG,
} from '../../auth/permissionCatalog.js'

const source = await readFile(
  new URL('./PermissionTemplateEditor.jsx', import.meta.url),
  'utf8',
).catch(() => '')
const stateSource = await readFile(
  new URL('./permissionTemplateEditorState.js', import.meta.url),
  'utf8',
).catch(() => '')

test('editor is defense-in-depth hidden from non-administrators and uses only an injected service', () => {
  const employeeAuthImport = source.match(
    /import\s*\{([^}]*)\}\s*from ['"]\.\.\/\.\.\/auth\/employeeAuthDomain\.js['"]/,
  )
  assert.ok(employeeAuthImport)
  assert.match(employeeAuthImport[1], /\bisPersonnelAdministrator\b/)
  const stateEmployeeAuthImport = stateSource.match(
    /import\s*\{([^}]*)\}\s*from ['"]\.\.\/\.\.\/auth\/employeeAuthDomain\.js['"]/,
  )
  assert.ok(stateEmployeeAuthImport)
  for (const name of ['DEPARTMENT_OPTIONS', 'POSITION_OPTIONS']) {
    assert.match(stateEmployeeAuthImport[1], new RegExp(`\\b${name}\\b`))
  }
  assert.match(source, /permissionTemplateService/)
  assert.match(
    source,
    /if \(!isPersonnelAdministrator\(currentEmployee\)\) return null/,
  )
  assert.doesNotMatch(
    source,
    /from ['"]\.\.\/\.\.\/services\/permissionTemplateService\.js['"]/,
  )
})

test('editor freshly reads templates and delegates terminal account errors', () => {
  assert.match(
    source,
    /permissionTemplateService\s*\.\s*readPermissionTemplates\(\)/,
  )
  assert.match(source, /TERMINAL_AUTH_ERROR_CODES/)
  for (
    const code of [
      'AUTH_TOKEN_INVALID',
      'AUTH_INVALID',
      'EMPLOYEE_NOT_LINKED',
      'ACCOUNT_DISABLED',
      'EMPLOYEE_INACTIVE',
      'PASSWORD_CHANGE_REQUIRED',
    ]
  ) {
    assert.match(source, new RegExp(`['"]${code}['"]`))
  }
  assert.match(source, /onAuthInvalid\?\.\(\)/)
  assert.match(
    source,
    /let active = true[\s\S]*return \(\) => \{[\s\S]*active = false/,
  )
})

test('editor uses bound draft state and guards every asynchronous result', () => {
  assert.match(source, /createPermissionTemplateAsyncGuard/)
  assert.match(source, /canSavePermissionTemplateDraft/)
  assert.match(source, /applyPermissionTemplateSnapshot/)
  assert.match(source, /selectPermissionTemplateSubject/)
  assert.match(source, /const saveInFlightRef = useRef\(null\)/)
  assert.match(source, /await pendingSave/)
  assert.match(source, /isCurrentRead/)
  assert.match(source, /isCurrentSave/)
  assert.match(source, /authorizationClosed/)
  assert.match(source, /refreshAuthorizationAfterTemplateSave/)
})

test('editor reports the full save lifecycle to the parent critical-operation lock', () => {
  assert.match(source, /onMutationStateChange/)
  assert.match(
    source,
    /const onMutationStateChangeRef = useRef\(onMutationStateChange\)/,
  )
  assert.match(
    source,
    /const mutationStateCallback = onMutationStateChangeRef\.current/,
  )
  assert.match(
    source,
    /return onMutationStateChange\(mutation\) === true/,
  )
  assert.match(
    source,
    /if \(!notifyMutationState\(mutationStateCallback, true\)\)[\s\S]*return[\s\S]*replacePermissionTemplate/,
  )
  assert.match(
    source,
    /finally \{[\s\S]*notifyMutationState\(mutationStateCallback, false\)/,
  )
})

test('editor exposes department and position tabs with only the fixed subject selectors', () => {
  assert.match(source, /部门权限/)
  assert.match(source, /职位权限/)
  assert.match(source, /role=['"]tablist['"]/)
  assert.match(source, /role=['"]tab['"]/)
  assert.match(source, /aria-selected=/)
  assert.match(source, /role=['"]tabpanel['"]/)
  assert.match(source, /PERMISSION_TEMPLATE_SUBJECT_CONFIG/)
  assert.match(stateSource, /DEPARTMENT_OPTIONS/)
  assert.match(stateSource, /POSITION_OPTIONS/)
  assert.match(source, /subjectOptions\.map/)
  assert.match(source, /<select[\s\S]*value=\{selectedSubject\}/)
  assert.doesNotMatch(
    source,
    /subjectType:\s*['"]employee['"]|employeeId|employees\.map/,
  )
})

test('template tabs implement roving tabindex keyboard navigation and move focus', () => {
  assert.match(source, /resolvePermissionTemplateTabKey/)
  assert.match(source, /const subjectTabRefs = useRef/)
  assert.match(
    source,
    /onKeyDown=\{\(event\) => handleSubjectTabKeyDown\(event, type\)\}/,
  )
  assert.match(source, /event\.preventDefault\(\)/)
  assert.match(
    source,
    /subjectTabRefs\.current\.get\(nextSubjectType\)\?\.focus\(\)/,
  )
  assert.match(source, /tabIndex=\{subjectType === type \? 0 : -1\}/)
})

test('editor renders all module actions and sensitive permissions from the closed catalog', () => {
  const permissionCatalogImport = source.match(
    /import\s*\{([^}]*)\}\s*from ['"]\.\.\/\.\.\/auth\/permissionCatalog\.js['"]/,
  )
  assert.ok(permissionCatalogImport)
  for (
    const name of [
      'PERMISSION_ACTIONS',
      'PERMISSION_MODULES',
      'SENSITIVE_PERMISSION_CATALOG',
      'WAREHOUSE_PERMISSION_CATALOG',
    ]
  ) {
    assert.match(permissionCatalogImport[1], new RegExp(`\\b${name}\\b`))
  }
  assert.match(source, /PERMISSION_ACTIONS\.map/)
  assert.match(source, /PERMISSION_MODULES\.map/)
  assert.match(source, /SENSITIVE_PERMISSION_CATALOG\.map/)
  assert.match(source, /WAREHOUSE_PERMISSION_CATALOG\.map/)
  assert.match(source, /`module\.\$\{module\.code\}\.\$\{action\.code\}`/)
  assert.match(source, /type=['"]checkbox['"]/)
  assert.match(
    source,
    /checked=\{draftPermissionKeys\.includes\(permissionKey\)\}/,
  )
  assert.match(source, /敏感数据权限/)
  assert.match(source, /仓库操作权限/)
  for (const { key, label } of WAREHOUSE_PERMISSION_CATALOG) {
    assert.equal(typeof key, 'string')
    assert.equal(typeof label, 'string')
    assert.ok(key.startsWith('warehouse.'))
    assert.ok(label.length > 0)
  }
})

test('forbidden subjects render both project financial checkboxes disabled without disabling unrelated keys', () => {
  const forbiddenStates = SENSITIVE_PERMISSION_CATALOG.map(({ key }) => ({
    key,
    disabled: templateContainsForbiddenProjectFinancialGrant(
      'department',
      '工程部',
      [key],
    ),
  }))
  assert.deepEqual(
    forbiddenStates.filter(({ disabled }) => disabled).map(({ key }) => key),
    [
      'sensitive.contract_amount_view',
      'sensitive.contract_amount_update',
    ],
  )
  assert.equal(
    templateContainsForbiddenProjectFinancialGrant(
      'position',
      '主任',
      ['sensitive.contract_amount_view'],
    ),
    true,
  )
  assert.equal(
    templateContainsForbiddenProjectFinancialGrant(
      'department',
      '设计部',
      ['sensitive.contract_amount_view'],
    ),
    false,
  )

  const permissionCatalogImport = source.match(
    /import\s*\{([^}]*)\}\s*from ['"]\.\.\/\.\.\/auth\/permissionCatalog\.js['"]/,
  )
  assert.ok(permissionCatalogImport)
  assert.match(
    permissionCatalogImport[1],
    /\btemplateContainsForbiddenProjectFinancialGrant\b/,
  )
  assert.match(
    source,
    /const financialPermissionDisabled =\s*templateContainsForbiddenProjectFinancialGrant\(\s*subjectType,\s*selectedSubject,\s*\[key\],?\s*\)/,
  )
  assert.match(source, /disabled=\{financialPermissionDisabled\}/)
  assert.match(source, /aria-disabled=\{financialPermissionDisabled\}/)
})

test('changes remain a local draft until explicit atomic save or discard', () => {
  assert.match(
    source,
    /const \[editorData, setEditorData\] = useState\(\s*createPermissionTemplateEditorData,?\s*\)/,
  )
  assert.match(
    source,
    /const isDirty = isPermissionTemplateDraftDirty\(editorData\)/,
  )
  assert.match(source, /togglePermissionTemplateDraft/)
  assert.match(source, /discardPermissionTemplateDraft/)
  assert.match(source, /放弃更改/)
  assert.match(source, /保存权限模板/)
  assert.match(source, /disabled=\{[^}]*isDirty[^}]*\}/)
  assert.match(source, /disabled=\{!canSave\}/)
  assert.doesNotMatch(
    source,
    /partial_(?:add|remove)|addPermission|removePermission/,
  )
})

test('save replaces exactly one subject then delegates permission refresh without optimistic user mutation', () => {
  assert.match(
    source,
    /const request = \{[\s\S]*subjectType,[\s\S]*subjectCode:\s*selectedSubject,[\s\S]*permissionKeys:\s*\[\.\.\.draftPermissionKeys\][\s\S]*\}/,
  )
  assert.match(
    source,
    /await permissionTemplateService\s*\.\s*replacePermissionTemplate\(request\)/,
  )
  assert.match(
    source,
    /await refreshAuthorizationAfterTemplateSave\(\{[\s\S]*snapshot,[\s\S]*onTemplatesChanged:\s*onTemplatesChangedRef\.current,[\s\S]*onAuthInvalid:\s*onAuthInvalidRef\.current[\s\S]*\}\)[\s\S]*applyPermissionTemplateSnapshot\(current, snapshot\)/,
  )
  assert.doesNotMatch(
    source,
    /setCurrent(?:User|Employee)|currentEmployee\.(?:effectivePermissionKeys|department|position)\s*=|effectivePermissionKeys\.(?:push|splice)/,
  )
})

test('editor explains union and empty defaults without offering individual overrides', () => {
  assert.match(source, /员工有效权限为所属部门权限与职位权限的并集/)
  assert.match(source, /未配置的模板默认没有任何业务权限/)
  assert.doesNotMatch(source, /员工权限|个人权限|个人例外|按员工|选择员工/)
})

test('editor has safe status handling and no storage, logging, or credential path', () => {
  assert.match(source, /role=['"]status['"]/)
  assert.match(source, /role=['"]alert['"]/)
  assert.match(source, /权限模板加载失败，请稍后重试/)
  assert.match(source, /权限模板保存失败，请稍后重试/)
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|indexedDB|console\.|passwordHash|initialPassword|temporaryPassword|service.?role|SUPABASE_/i,
  )
})

test('all component classes are permission-template prefixed for isolated later styling', () => {
  const classNames = [...source.matchAll(/className=(['"])(.*?)\1/g)]
    .flatMap((match) => match[2].split(/\s+/u))
    .filter(Boolean)

  assert.ok(classNames.length >= 12)
  assert.ok(
    classNames.every((className) =>
      className.startsWith('permission-template-')
    ),
  )
})
