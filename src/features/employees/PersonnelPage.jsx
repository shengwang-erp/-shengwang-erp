import { useCallback, useMemo, useRef, useState } from 'react'

import {
  DEPARTMENT_OPTIONS,
  POSITION_OPTIONS,
  isPersonnelAdministrator,
} from '../../auth/employeeAuthDomain.js'
import { canViewSensitive } from '../../utils/permissions.js'
import EmployeeCredentialsDialog from './EmployeeCredentialsDialog.jsx'
import PermissionTemplateEditor from './PermissionTemplateEditor.jsx'
import {
  acquirePersonnelProtection,
  hasProtectedPersonnelState,
} from './personnelCriticalState.js'
import {
  appendPersonnelNotice,
  finishProfileUpdate,
  reconcileAccountStatusFailure,
  requiresSelfAuthorizationRevalidation,
} from './personnelMutationPolicy.js'

const EMPLOYMENT_STATUS_OPTIONS = Object.freeze(['在职', '离职', '休假', '停工'])
const GENDER_OPTIONS = Object.freeze(['男', '女', '其他'])
const LEVEL_OPTIONS = Object.freeze(['1星', '2星', '3星', '4星', '5星'])
const SALARY_TYPE_OPTIONS = Object.freeze(['月薪', '日薪', '时薪', '未设置'])

const CORE_EDITABLE_FIELDS = Object.freeze([
  'name',
  'department',
  'position',
  'employmentStatus',
  'attendanceRequired',
  'hireDate',
  'resignDate',
  'level',
  'phone',
  'remark',
])
const IDENTITY_FIELDS = Object.freeze([
  'gender',
  'birthDate',
  'nationality',
  'emergencyContactName',
  'emergencyContactPhone',
  'currentAddress',
  'visaAgency',
  'visaType',
  'visaExpireDate',
  'passportNumber',
  'residenceCardNumber',
])
const SALARY_FIELDS = Object.freeze([
  'baseSalary',
  'dailySalary',
  'hourlyWage',
  'salaryRemark',
])
const EDITABLE_FIELDS = new Set([
  ...CORE_EDITABLE_FIELDS,
  ...IDENTITY_FIELDS,
  ...SALARY_FIELDS,
])
const CREATE_VALUES = Object.freeze({
  employeeNumber: '',
  name: '',
  department: '',
  position: '',
  employmentStatus: '在职',
  attendanceRequired: true,
  hireDate: '',
  resignDate: '',
  level: '',
  phone: '',
  remark: '',
  gender: '',
  birthDate: '',
  nationality: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  currentAddress: '',
  visaAgency: '',
  visaType: '',
  visaExpireDate: '',
  passportNumber: '',
  residenceCardNumber: '',
  salaryType: '未设置',
  baseSalary: null,
  dailySalary: null,
  hourlyWage: null,
  salaryRemark: '',
})

function displayValue(value) {
  return value === null || value === undefined ? '' : value
}

function deriveSalaryType(detail) {
  if (detail.baseSalary !== null && detail.baseSalary !== undefined) return '月薪'
  if (detail.dailySalary !== null && detail.dailySalary !== undefined) return '日薪'
  if (detail.hourlyWage !== null && detail.hourlyWage !== undefined) return '时薪'
  return '未设置'
}

function createEditValues(detail) {
  const values = {
    employeeNumber: detail.employeeNumber,
    salaryType: deriveSalaryType(detail),
  }
  for (const key of EDITABLE_FIELDS) {
    if (Object.hasOwn(detail, key)) values[key] = displayValue(detail[key])
  }
  return values
}

function buildCreateProfile(formState, { identityAllowed, salaryAllowed }) {
  const profile = {
    name: formState.values.name,
    department: formState.values.department,
    position: formState.values.position,
    employmentStatus: formState.values.employmentStatus,
  }
  for (const key of CORE_EDITABLE_FIELDS) {
    if (
      ['name', 'department', 'position', 'employmentStatus', 'attendanceRequired']
        .includes(key)
    ) continue
    const value = formState.values[key]
    if (formState.dirtyKeys.has(key) || (value !== '' && value !== null)) {
      Object.assign(profile, { [key]: value })
    }
  }
  if (identityAllowed) {
    for (const key of IDENTITY_FIELDS) {
      const value = formState.values[key]
      if (formState.dirtyKeys.has(key) || (value !== '' && value !== null)) {
        Object.assign(profile, { [key]: value })
      }
    }
  }
  if (salaryAllowed) {
    for (const key of SALARY_FIELDS) {
      const value = formState.values[key]
      if (formState.dirtyKeys.has(key) || (value !== '' && value !== null)) {
        Object.assign(profile, { [key]: value })
      }
    }
  }
  return profile
}

function buildDirtyPatch(formState, { identityAllowed, salaryAllowed }) {
  const patch = {}
  for (const key of formState.dirtyKeys) {
    if (key === 'salaryType' || !EDITABLE_FIELDS.has(key)) continue
    if (!formState.loadedKeys.has(key)) continue
    if (IDENTITY_FIELDS.includes(key) && !identityAllowed) continue
    if (SALARY_FIELDS.includes(key) && !salaryAllowed) continue
    Object.assign(patch, { [key]: formState.values[key] })
  }
  return patch
}

function PersonnelField({
  label,
  name,
  value,
  onChange,
  type = 'text',
  required = false,
  readOnly = false,
  min,
}) {
  return (
    <label className="personnel-field">
      <span>{label}{required ? ' *' : ''}</span>
      <input
        name={name}
        type={type}
        value={displayValue(value)}
        onChange={(event) => onChange?.(name, event.target.value)}
        required={required}
        readOnly={readOnly}
        min={min}
      />
    </label>
  )
}

function PersonnelSelect({
  label,
  name,
  value,
  onChange,
  options,
  required = false,
  emptyLabel = '请选择',
}) {
  return (
    <label className="personnel-field">
      <span>{label}{required ? ' *' : ''}</span>
      <select
        name={name}
        value={displayValue(value)}
        onChange={(event) => onChange(name, event.target.value)}
        required={required}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function PersonnelTextarea({ label, name, value, onChange }) {
  return (
    <label className="personnel-field personnel-field-wide">
      <span>{label}</span>
      <textarea
        name={name}
        value={displayValue(value)}
        rows="3"
        onChange={(event) => onChange(name, event.target.value)}
      />
    </label>
  )
}

function safeOperationMessage(error) {
  return error?.name === 'EmployeeAdminError'
    ? error.message
    : '人员管理操作失败，请稍后重试'
}

function canResetTemporaryPassword(employee) {
  return (
    employee.accountStatus === 'active' &&
    employee.employmentStatus === '在职'
  )
}

export default function PersonnelPage({
  employees = [],
  currentEmployee,
  employeeAdmin,
  loadState = { loading: false, error: '' },
  onRefreshEmployees,
  onAuthInvalid,
  onCriticalStateChange,
  permissionTemplateService,
  onPermissionTemplatesChanged,
  onTemplateCriticalStateChange,
  onBack,
}) {
  const [nameFilter, setNameFilter] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [formState, setFormState] = useState(null)
  const [mutation, setMutation] = useState(null)
  const [credentials, setCredentials] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [templateCritical, setTemplateCritical] = useState(false)
  const templateCriticalRef = useRef(false)

  const canAdminister = isPersonnelAdministrator(currentEmployee)
  const identityAllowed =
    canViewSensitive(currentEmployee, '查看人员身份资料') &&
    canViewSensitive(currentEmployee, '修改人员身份资料')
  const salaryAllowed =
    canViewSensitive(currentEmployee, '查看工资') &&
    canViewSensitive(currentEmployee, '修改工资')

  const visibleEmployees = useMemo(
    () =>
      employees.filter(
        (employee) =>
          employee.employeeNumber !== 'SW-000' &&
          !employee.isHiddenSystemAccount,
      ),
    [employees],
  )
  const filteredEmployees = useMemo(
    () =>
      visibleEmployees.filter((employee) => {
        const matchesName = nameFilter
          ? employee.name.includes(nameFilter.trim()) ||
            employee.employeeNumber.includes(nameFilter.trim().toUpperCase())
          : true
        const matchesDepartment = departmentFilter
          ? employee.department === departmentFilter
          : true
        const matchesAccount = accountFilter
          ? employee.accountStatus === accountFilter
          : true
        return matchesName && matchesDepartment && matchesAccount
      }),
    [visibleEmployees, nameFilter, departmentFilter, accountFilter],
  )

  const showIdentityFields = Boolean(
    formState &&
      identityAllowed &&
      (formState.mode === 'create' ||
        IDENTITY_FIELDS.every((key) => formState.loadedKeys.has(key))),
  )
  const showSalaryFields = Boolean(
    formState &&
      salaryAllowed &&
      (formState.mode === 'create' ||
        SALARY_FIELDS.every((key) => formState.loadedKeys.has(key))),
  )
  const unchangedEdit = Boolean(
    formState &&
      formState.mode === 'edit' &&
      formState.dirtyKeys.size === 0,
  )
  const employeeProtectedStateActive = hasProtectedPersonnelState({
    mutation,
    credentials,
  })
  const employeeFlowActive = Boolean(formState || mutation || credentials)
  const protectedStateActive = employeeProtectedStateActive || templateCritical

  const handleTemplateCriticalStateChange = useCallback((active) => {
    const nextActive = active === true
    try {
      if (onTemplateCriticalStateChange?.(nextActive) !== true) return false
    } catch {
      return false
    }
    templateCriticalRef.current = nextActive
    setTemplateCritical(nextActive)
    return true
  }, [onTemplateCriticalStateChange])

  const resetMessages = () => {
    setError('')
    setNotice('')
  }

  const handleOperationError = (error) => {
    if (error?.authInvalid) {
      onAuthInvalid()
      return
    }
    setError(safeOperationMessage(error))
  }

  const handleRefreshFailure = (caught, message) => {
    if (caught?.authInvalid) {
      onAuthInvalid()
      return
    }
    setNotice((current) => appendPersonnelNotice(current, message))
  }

  const openCreateForm = () => {
    if (!canAdminister || mutation || templateCriticalRef.current) return
    resetMessages()
    if (!globalThis.crypto?.randomUUID) {
      setError('当前浏览器无法安全创建请求编号，请更换浏览器后重试')
      return
    }
    setFormState({
      mode: 'create',
      targetId: null,
      requestId: crypto.randomUUID(),
      values: { ...CREATE_VALUES },
      loadedKeys: new Set([
        ...CORE_EDITABLE_FIELDS,
        ...(identityAllowed ? IDENTITY_FIELDS : []),
        ...(salaryAllowed ? SALARY_FIELDS : []),
      ]),
      dirtyKeys: new Set(),
    })
  }

  const openEditForm = async (employee) => {
    if (!canAdminister || mutation || templateCriticalRef.current) return
    resetMessages()
    setMutation({ operation: 'detail', targetId: employee.id })
    try {
      const detail = await employeeAdmin.getEmployeeProfileDetail(employee.id)
      if (!detail) {
        setError('员工资料不存在或当前不可查看')
        return
      }
      setFormState({
        mode: 'edit',
        targetId: employee.id,
        requestId: null,
        values: createEditValues(detail),
        loadedKeys: new Set(Object.keys(detail)),
        dirtyKeys: new Set(),
      })
    } catch (caught) {
      handleOperationError(caught)
    } finally {
      setMutation(null)
    }
  }

  const handleFieldChange = (name, value) => {
    setFormState((current) => {
      if (!current) return current
      const dirtyKeys = new Set(current.dirtyKeys)
      const values = { ...current.values }
      if (name === 'salaryType') {
        values.salaryType = value
        values.baseSalary = null
        values.dailySalary = null
        values.hourlyWage = null
        dirtyKeys.add('salaryType')
        dirtyKeys.add('baseSalary')
        dirtyKeys.add('dailySalary')
        dirtyKeys.add('hourlyWage')
      } else {
        values[name] = value
        dirtyKeys.add(name)
      }
      return { ...current, values, dirtyKeys }
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (mutation || templateCriticalRef.current) return
    resetMessages()
    if (!formState) return

    const protectedOperation = formState.mode === 'create'
    if (
      protectedOperation &&
      !acquirePersonnelProtection(onCriticalStateChange)
    ) {
      setError('无法安全锁定一次性凭据操作，请重试')
      return
    }
    let retainPersonnelProtection = false
    setMutation({ operation: formState.mode, targetId: formState.targetId })
    try {
      if (formState.mode === 'create') {
        const result = await employeeAdmin.provisionEmployee({
          requestId: formState.requestId,
          profile: buildCreateProfile(formState, {
            identityAllowed,
            salaryAllowed,
          }),
        })
        if (result.initialPassword) {
          setCredentials({
            employeeNumber: result.employee.employeeNumber,
            initialPassword: result.initialPassword,
          })
          retainPersonnelProtection = true
        } else {
          setNotice('员工已创建，但一次性初始密码不能再次查看；如未安全交付，请生成新的临时密码。')
        }
        setFormState(null)
        if (formState.values.attendanceRequired === false) {
          await employeeAdmin.updateProfile({
            employeeId: result.employee.id,
            patch: { attendanceRequired: false },
          })
        }
        try {
          await onRefreshEmployees()
        } catch (caught) {
          handleRefreshFailure(caught, '员工已创建，但目录刷新失败；请稍后手动刷新。')
        }
      } else {
        const patch = buildDirtyPatch(formState, {
          identityAllowed,
          salaryAllowed,
        })
        if (Object.keys(patch).length === 0) {
          setNotice('没有需要保存的修改。')
          return
        }
        const requiresRevalidation = requiresSelfAuthorizationRevalidation({
          targetId: formState.targetId,
          currentEmployeeId: currentEmployee.id,
          dirtyKeys: formState.dirtyKeys,
        })
        await employeeAdmin.updateProfile({
          employeeId: formState.targetId,
          patch,
        })
        setFormState(null)
        setNotice('员工资料已更新。')
        await finishProfileUpdate({
          requiresRevalidation,
          onAuthInvalid,
          onRefreshEmployees,
          onRefreshFailure: (caught) =>
            handleRefreshFailure(
              caught,
              '资料已更新，但目录刷新失败；请稍后手动刷新。',
            ),
        })
      }
    } catch (caught) {
      handleOperationError(caught)
    } finally {
      setMutation(null)
      if (protectedOperation && !retainPersonnelProtection) {
        onCriticalStateChange?.(false)
      }
    }
  }

  const handleAccountStatus = async (employee) => {
    if (
      !canAdminister || mutation || templateCriticalRef.current ||
      employee.id === currentEmployee.id
    ) return
    const nextStatus = employee.accountStatus === 'active' ? 'disabled' : 'active'
    const action = nextStatus === 'disabled' ? '停用' : '启用'
    if (!window.confirm(`确认${action} ${employee.employeeNumber} 的登录账号？`)) return

    resetMessages()
    setMutation({ operation: 'status', targetId: employee.id })
    try {
      await employeeAdmin.setAccountStatus({
        employeeId: employee.id,
        accountStatus: nextStatus,
      })
      setNotice(`账号已${action}。`)
      try {
        await onRefreshEmployees()
      } catch (caught) {
        handleRefreshFailure(caught, `账号已${action}，但目录刷新失败；请稍后手动刷新。`)
      }
    } catch (caught) {
      await reconcileAccountStatusFailure({
        error: caught,
        onOperationError: handleOperationError,
        onRefreshEmployees,
        onRefreshFailure: (refreshError) =>
          handleRefreshFailure(
            refreshError,
            '账号状态可能已变化，但目录刷新失败；请稍后手动刷新。',
          ),
      })
    } finally {
      setMutation(null)
    }
  }

  const handleResetPassword = async (employee) => {
    if (
      !canAdminister || mutation || templateCriticalRef.current ||
      employee.id === currentEmployee.id
    ) return
    if (!canResetTemporaryPassword(employee)) return
    const confirmed = window.confirm(
      `确认为 ${employee.employeeNumber} 生成新的临时密码？旧密码将立即失效，员工下次登录必须修改新密码。`,
    )
    if (!confirmed) return

    resetMessages()
    if (!acquirePersonnelProtection(onCriticalStateChange)) {
      setError('无法安全锁定一次性凭据操作，请重试')
      return
    }
    let retainPersonnelProtection = false
    setMutation({ operation: 'reset', targetId: employee.id })
    try {
      const result = await employeeAdmin.resetTemporaryPassword({
        employeeId: employee.id,
      })
      setCredentials({
        employeeNumber: result.employee.employeeNumber,
        initialPassword: result.initialPassword,
      })
      retainPersonnelProtection = true
      try {
        await onRefreshEmployees()
      } catch (caught) {
        handleRefreshFailure(caught, '临时密码已生成，但目录刷新失败；请先安全交付凭据。')
      }
    } catch (caught) {
      handleOperationError(caught)
    } finally {
      setMutation(null)
      if (!retainPersonnelProtection) onCriticalStateChange?.(false)
    }
  }

  const cancelForm = () => {
    if (mutation) return
    setFormState(null)
    resetMessages()
  }

  const closeCredentials = () => {
    onCriticalStateChange?.(false)
    setCredentials(null)
  }

  return (
    <main className="personnel-page page-shell">
      <header className="personnel-header">
        <button
          className="back-button"
          type="button"
          onClick={onBack}
          disabled={protectedStateActive}
        >返回</button>
        <div>
          <p>规范员工目录 · 服务端权限校验</p>
          <h1>人员管理</h1>
        </div>
        {canAdminister && (
          <button
            className="primary-button"
            type="button"
            onClick={openCreateForm}
            disabled={Boolean(mutation) || templateCritical}
          >新增员工</button>
        )}
      </header>

      <section className="personnel-summary" aria-label="人员目录摘要">
        <div><strong>{visibleEmployees.length}</strong><span>可见员工</span></div>
        <div><strong>{visibleEmployees.filter((item) => item.accountStatus === 'active').length}</strong><span>已启用账号</span></div>
        <div><strong>{visibleEmployees.filter((item) => item.employmentStatus === '在职').length}</strong><span>在职员工</span></div>
      </section>

      {loadState.loading && <p className="personnel-message" role="status">正在读取规范员工目录…</p>}
      {protectedStateActive && (!credentials || mutation) && (
        <p className="personnel-message" role="status">
          正在完成受保护的人员或权限操作，完成前已锁定导航和退出。
        </p>
      )}
      {loadState.error && <p className="personnel-error" role="alert">{loadState.error}</p>}
      {error && <p className="personnel-error" role="alert">{error}</p>}
      {notice && <p className="personnel-message" role="status">{notice}</p>}

      {canAdminister && !employeeFlowActive && (
        <PermissionTemplateEditor
          currentEmployee={currentEmployee}
          permissionTemplateService={permissionTemplateService}
          onTemplatesChanged={onPermissionTemplatesChanged}
          onAuthInvalid={onAuthInvalid}
          onMutationStateChange={handleTemplateCriticalStateChange}
        />
      )}

      {formState && (
        <form className="personnel-form" onSubmit={handleSubmit}>
          <div className="personnel-section-heading">
            <div>
              <h2>{formState.mode === 'create' ? '新增员工' : '编辑员工资料'}</h2>
              <span>账号权限和编号均由服务端管理</span>
            </div>
          </div>

          <fieldset className="personnel-fieldset">
            <legend>基本资料</legend>
            <div className="personnel-form-grid">
              {formState.mode === 'create' ? (
                <div className="personnel-generated-number">
                  <span>员工编号</span>
                  <strong>员工编号将在保存成功后自动生成</strong>
                </div>
              ) : (
                <PersonnelField
                  label="员工编号"
                  name="employeeNumber"
                  value={formState.values.employeeNumber || ''}
                  readOnly
                />
              )}
              <PersonnelField
                label="姓名"
                name="name"
                value={formState.values.name || ''}
                onChange={handleFieldChange}
                required
              />
              <PersonnelSelect
                label="部门"
                name="department"
                value={formState.values.department || ''}
                onChange={handleFieldChange}
                options={DEPARTMENT_OPTIONS}
                required
              />
              <PersonnelSelect
                label="职位"
                name="position"
                value={formState.values.position || ''}
                onChange={handleFieldChange}
                options={POSITION_OPTIONS}
                required
              />
              <PersonnelSelect
                label="在职状态"
                name="employmentStatus"
                value={formState.values.employmentStatus || ''}
                onChange={handleFieldChange}
                options={EMPLOYMENT_STATUS_OPTIONS}
                required
              />
              <label className="personnel-checkbox-field">
                <input
                  name="attendanceRequired"
                  type="checkbox"
                  checked={formState.values.attendanceRequired === true}
                  onChange={(event) =>
                    handleFieldChange('attendanceRequired', event.target.checked)
                  }
                />
                <span>
                  <strong>需要每日打卡</strong>
                  <small>关闭后不产生缺卡异常，免打卡人员按正常全勤进入月度工资。</small>
                </span>
              </label>
              <PersonnelField label="入职日期" name="hireDate" type="date" value={formState.values.hireDate} onChange={handleFieldChange} />
              <PersonnelField label="离职日期" name="resignDate" type="date" value={formState.values.resignDate} onChange={handleFieldChange} />
              <PersonnelSelect label="等级" name="level" value={formState.values.level || ''} onChange={handleFieldChange} options={LEVEL_OPTIONS} />
              <PersonnelField label="联系电话" name="phone" value={formState.values.phone} onChange={handleFieldChange} />
              <PersonnelTextarea label="备注" name="remark" value={formState.values.remark} onChange={handleFieldChange} />
            </div>
          </fieldset>

          {showIdentityFields && (
            <fieldset className="personnel-fieldset personnel-sensitive-section">
              <legend>身份资料 · 受限</legend>
              <div className="personnel-form-grid">
                <PersonnelSelect label="性别" name="gender" value={formState.values.gender || ''} onChange={handleFieldChange} options={GENDER_OPTIONS} />
                <PersonnelField label="出生日期" name="birthDate" type="date" value={formState.values.birthDate} onChange={handleFieldChange} />
                <PersonnelField label="国籍" name="nationality" value={formState.values.nationality} onChange={handleFieldChange} />
                <PersonnelField label="紧急联系人" name="emergencyContactName" value={formState.values.emergencyContactName} onChange={handleFieldChange} />
                <PersonnelField label="紧急联系电话" name="emergencyContactPhone" value={formState.values.emergencyContactPhone} onChange={handleFieldChange} />
                <PersonnelField label="现住址" name="currentAddress" value={formState.values.currentAddress} onChange={handleFieldChange} />
                <PersonnelField label="签证办理机构" name="visaAgency" value={formState.values.visaAgency} onChange={handleFieldChange} />
                <PersonnelField label="签证类型" name="visaType" value={formState.values.visaType} onChange={handleFieldChange} />
                <PersonnelField label="签证到期日" name="visaExpireDate" type="date" value={formState.values.visaExpireDate} onChange={handleFieldChange} />
                <PersonnelField label="护照号码" name="passportNumber" value={formState.values.passportNumber} onChange={handleFieldChange} />
                <PersonnelField label="在留卡号码" name="residenceCardNumber" value={formState.values.residenceCardNumber} onChange={handleFieldChange} />
              </div>
            </fieldset>
          )}

          {showSalaryFields && (
            <fieldset className="personnel-fieldset personnel-sensitive-section">
              <legend>工资资料 · 受限</legend>
              <div className="personnel-form-grid">
                <PersonnelSelect label="主要工资类型" name="salaryType" value={formState.values.salaryType} onChange={handleFieldChange} options={SALARY_TYPE_OPTIONS} emptyLabel="请选择工资类型" />
                {formState.values.salaryType === '月薪' && (
                  <PersonnelField label="月薪" name="baseSalary" type="number" min="0" value={formState.values.baseSalary} onChange={handleFieldChange} />
                )}
                {formState.values.salaryType === '日薪' && (
                  <PersonnelField label="日薪" name="dailySalary" type="number" min="0" value={formState.values.dailySalary} onChange={handleFieldChange} />
                )}
                {formState.values.salaryType === '时薪' && (
                  <PersonnelField label="时薪" name="hourlyWage" type="number" min="0" value={formState.values.hourlyWage} onChange={handleFieldChange} />
                )}
                {formState.values.salaryType === '未设置' && (
                  <p className="personnel-inline-note">保存后将清空月薪、日薪和时薪。</p>
                )}
                <PersonnelTextarea label="工资备注" name="salaryRemark" value={formState.values.salaryRemark} onChange={handleFieldChange} />
              </div>
            </fieldset>
          )}

          <div className="personnel-actions">
            <button className="primary-button" type="submit" disabled={Boolean(mutation) || unchangedEdit}>
              {mutation ? '处理中…' : formState.mode === 'create' ? '创建员工' : '保存修改'}
            </button>
            <button className="ghost-button" type="button" onClick={cancelForm} disabled={Boolean(mutation)}>取消</button>
          </div>
        </form>
      )}

      <section className="personnel-filters" aria-label="员工筛选">
        <PersonnelField label="姓名或员工编号" name="personnelSearch" value={nameFilter} onChange={(_, value) => setNameFilter(value)} />
        <PersonnelSelect label="部门" name="departmentFilter" value={departmentFilter} onChange={(_, value) => setDepartmentFilter(value)} options={DEPARTMENT_OPTIONS} emptyLabel="全部部门" />
        <PersonnelSelect label="账号状态" name="accountFilter" value={accountFilter} onChange={(_, value) => setAccountFilter(value)} options={['active', 'disabled']} emptyLabel="全部账号状态" />
      </section>

      <section className="personnel-list" aria-label="规范员工目录">
        {!loadState.loading && filteredEmployees.length === 0 ? (
          <p className="personnel-empty">暂无符合条件的员工</p>
        ) : (
          filteredEmployees.map((employee) => (
            <article className="personnel-card" key={employee.id}>
              <div className="personnel-card-heading">
                <div>
                  <strong>{employee.name}</strong>
                  <span>{employee.employeeNumber}</span>
                </div>
                <div className="personnel-badges">
                  <span className={`personnel-badge ${employee.accountStatus}`}>
                    {employee.accountStatus === 'active' ? '已启用' : '已停用'}
                  </span>
                  <span className="personnel-badge employment">{employee.employmentStatus}</span>
                </div>
              </div>
              <dl className="personnel-details">
                <div><dt>部门</dt><dd>{employee.department}</dd></div>
                <div><dt>职位</dt><dd>{employee.position}</dd></div>
                <div>
                  <dt>打卡模式</dt>
                  <dd>{employee.attendanceRequired === true ? '每日打卡' : '免打卡'}</dd>
                </div>
              </dl>
              {canAdminister && (
                <div className="personnel-actions">
                  <button className="ghost-button" type="button" onClick={() => openEditForm(employee)} disabled={Boolean(mutation) || templateCritical}>编辑资料</button>
                  {employee.id !== currentEmployee.id && (
                    <>
                      <button className={employee.accountStatus === 'active' ? 'danger-button' : 'ghost-button'} type="button" onClick={() => handleAccountStatus(employee)} disabled={Boolean(mutation) || templateCritical}>
                        {employee.accountStatus === 'active' ? '停用账号' : '启用账号'}
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => handleResetPassword(employee)}
                        disabled={Boolean(mutation) || templateCritical || !canResetTemporaryPassword(employee)}
                        title={canResetTemporaryPassword(employee) ? '' : '仅已启用且在职员工可重置临时密码'}
                      >生成临时密码</button>
                      {!canResetTemporaryPassword(employee) && (
                        <span className="personnel-action-note">仅已启用且在职员工可重置临时密码</span>
                      )}
                    </>
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </section>

      {credentials && !mutation && (
        <EmployeeCredentialsDialog
          employeeNumber={credentials.employeeNumber}
          initialPassword={credentials.initialPassword}
          onClose={closeCredentials}
        />
      )}
    </main>
  )
}
