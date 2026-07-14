import { useEffect, useMemo, useRef, useState } from 'react'

import { isPersonnelAdministrator } from '../../auth/employeeAuthDomain.js'
import {
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  SENSITIVE_PERMISSION_CATALOG,
  templateContainsForbiddenProjectFinancialGrant,
} from '../../auth/permissionCatalog.js'
import {
  applyPermissionTemplateSnapshot,
  canSavePermissionTemplateDraft,
  clearPermissionTemplateSnapshot,
  createPermissionTemplateAsyncGuard,
  createPermissionTemplateEditorData,
  discardPermissionTemplateDraft,
  isPermissionTemplateDraftDirty,
  PERMISSION_TEMPLATE_SUBJECT_CONFIG,
  refreshAuthorizationAfterTemplateSave,
  resolvePermissionTemplateTabKey,
  selectPermissionTemplateSubject,
  togglePermissionTemplateDraft,
} from './permissionTemplateEditorState.js'

const TERMINAL_AUTH_ERROR_CODES = new Set([
  'AUTH_TOKEN_INVALID',
  'AUTH_INVALID',
  'EMPLOYEE_NOT_LINKED',
  'ACCOUNT_DISABLED',
  'EMPLOYEE_INACTIVE',
  'PASSWORD_CHANGE_REQUIRED',
])
const SAFE_ERROR_MESSAGES = Object.freeze({
  CONFIGURATION_ERROR: '权限模板服务未配置',
  PERSONNEL_ADMIN_REQUIRED: '没有权限维护部门或职位模板',
  PERMISSION_TEMPLATE_INPUT_INVALID: '权限模板内容无效，请重新选择',
  PERMISSION_TEMPLATE_RESPONSE_INVALID: '权限模板服务响应无效，请稍后重试',
  PERMISSION_TEMPLATES_FAILED: '权限模板服务暂不可用',
  PERMISSION_TEMPLATES_UNAVAILABLE: '权限模板服务暂不可用',
  AUTH_SERVICE_UNAVAILABLE: '认证服务暂不可用',
})
const SUBJECT_CONFIG = PERMISSION_TEMPLATE_SUBJECT_CONFIG
const SUBJECT_TYPES = Object.freeze(Object.keys(SUBJECT_CONFIG))

function safeErrorMessage(error, fallback) {
  return SAFE_ERROR_MESSAGES[error?.code] ?? fallback
}

async function invalidateAuthorization(onAuthInvalid) {
  try {
    await onAuthInvalid?.()
  } catch {
    // The caller owns session cleanup; the editor remains closed on failure.
  }
}

function notifyMutationState(onMutationStateChange, mutation) {
  if (typeof onMutationStateChange !== 'function') return false
  try {
    return onMutationStateChange(mutation) === true
  } catch {
    return false
  }
}

async function delegateTerminalAuthError(error, onAuthInvalid) {
  if (!TERMINAL_AUTH_ERROR_CODES.has(error?.code)) return false
  await invalidateAuthorization(onAuthInvalid)
  return true
}

function AuthorizedPermissionTemplateEditor({
  permissionTemplateService,
  onAuthInvalid,
  onTemplatesChanged,
  onMutationStateChange,
}) {
  const [editorData, setEditorData] = useState(
    createPermissionTemplateEditorData,
  )
  const [loading, setLoading] = useState(true)
  const [mutation, setMutation] = useState(false)
  const [authorizationClosed, setAuthorizationClosed] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const asyncGuardRef = useRef(null)
  const saveInFlightRef = useRef(null)
  const onAuthInvalidRef = useRef(onAuthInvalid)
  const onTemplatesChangedRef = useRef(onTemplatesChanged)
  const onMutationStateChangeRef = useRef(onMutationStateChange)
  const subjectTabRefs = useRef(new Map())

  if (asyncGuardRef.current === null) {
    asyncGuardRef.current = createPermissionTemplateAsyncGuard()
  }
  onAuthInvalidRef.current = onAuthInvalid
  onTemplatesChangedRef.current = onTemplatesChanged
  onMutationStateChangeRef.current = onMutationStateChange

  const asyncGuard = asyncGuardRef.current
  const { subjectType, selectedSubject, templates, draft } = editorData
  const draftPermissionKeys = draft.permissionKeys
  const subjectConfig = SUBJECT_CONFIG[subjectType]
  const subjectOptions = subjectConfig.options
  const isDirty = isPermissionTemplateDraftDirty(editorData)
  const canSave = canSavePermissionTemplateDraft(editorData, {
    loading,
    mutation,
  })
  const selectedPermissionCount = draftPermissionKeys.length

  useEffect(() => {
    asyncGuard.mount()
    return () => {
      asyncGuard.unmount()
    }
  }, [asyncGuard])

  useEffect(() => {
    const serviceGeneration = asyncGuard.beginServiceGeneration()
    let active = true

    const loadTemplates = async () => {
      setLoading(true)
      setError('')
      setStatus('')
      setEditorData((current) => clearPermissionTemplateSnapshot(current))

      const pendingSave = saveInFlightRef.current
      if (pendingSave) {
        try {
          await pendingSave
        } catch {
          // Save errors are handled by the save operation before a reload continues.
        }
      }
      if (!active || !asyncGuard.isServiceCurrent(serviceGeneration)) return

      const readToken = asyncGuard.beginRead(serviceGeneration)
      try {
        const snapshot = await permissionTemplateService
          .readPermissionTemplates()
        if (!active || !asyncGuard.isCurrentRead(readToken)) return
        setEditorData((current) =>
          applyPermissionTemplateSnapshot(current, snapshot)
        )
      } catch (loadError) {
        if (!active || !asyncGuard.isCurrentRead(readToken)) return
        if (TERMINAL_AUTH_ERROR_CODES.has(loadError?.code)) {
          setAuthorizationClosed(true)
          await delegateTerminalAuthError(loadError, onAuthInvalidRef.current)
          return
        }
        setError(safeErrorMessage(loadError, '权限模板加载失败，请稍后重试'))
      } finally {
        if (active && asyncGuard.isCurrentRead(readToken)) setLoading(false)
      }
    }

    void loadTemplates()
    return () => {
      active = false
    }
  }, [permissionTemplateService, asyncGuard])

  const modulePermissionRows = useMemo(
    () =>
      PERMISSION_MODULES.map((module) => ({
        ...module,
        permissions: PERMISSION_ACTIONS.map((action) => ({
          ...action,
          permissionKey: `module.${module.code}.${action.code}`,
        })),
      })),
    [],
  )

  const changeSubjectType = (nextSubjectType) => {
    const nextConfig = SUBJECT_CONFIG[nextSubjectType]
    if (
      !nextConfig || mutation || loading || isDirty ||
      nextSubjectType === subjectType
    ) return

    setEditorData((current) =>
      selectPermissionTemplateSubject(
        current,
        nextSubjectType,
        nextConfig.options[0],
      )
    )
    setStatus('')
    setError('')
  }

  const handleSubjectTabKeyDown = (event, currentSubjectType) => {
    if (mutation || loading || isDirty) return
    const currentIndex = SUBJECT_TYPES.indexOf(currentSubjectType)
    const nextIndex = resolvePermissionTemplateTabKey(
      event.key,
      currentIndex,
      SUBJECT_TYPES.length,
    )
    if (nextIndex === null) return

    event.preventDefault()
    const nextSubjectType = SUBJECT_TYPES[nextIndex]
    changeSubjectType(nextSubjectType)
    subjectTabRefs.current.get(nextSubjectType)?.focus()
  }

  const changeSelectedSubject = (nextSubject) => {
    if (
      mutation || loading || isDirty || !subjectOptions.includes(nextSubject)
    ) return
    setEditorData((current) =>
      selectPermissionTemplateSubject(current, subjectType, nextSubject)
    )
    setStatus('')
    setError('')
  }

  const togglePermission = (permissionKey) => {
    if (!templates || mutation || loading) return
    setStatus('')
    setError('')
    setEditorData((current) =>
      togglePermissionTemplateDraft(current, permissionKey)
    )
  }

  const discardDraft = () => {
    if (mutation) return
    setEditorData((current) => discardPermissionTemplateDraft(current))
    setStatus('已放弃未保存的更改')
    setError('')
  }

  const saveTemplate = async (event) => {
    event.preventDefault()
    if (!canSave || authorizationClosed || saveInFlightRef.current) return

    const mutationStateCallback = onMutationStateChangeRef.current
    const request = {
      subjectType,
      subjectCode: selectedSubject,
      permissionKeys: [...draftPermissionKeys],
    }
    if (!notifyMutationState(mutationStateCallback, true)) {
      setError('关键操作保护未就绪，请刷新页面后重试')
      return
    }

    const saveToken = asyncGuard.beginSave()
    setMutation(true)
    setStatus('')
    setError('')

    const operation = (async () => {
      try {
        const snapshot = await permissionTemplateService
          .replacePermissionTemplate(request)
        if (!asyncGuard.isMounted()) return

        if (!asyncGuard.isCurrentSave(saveToken)) {
          setAuthorizationClosed(true)
          await invalidateAuthorization(onAuthInvalidRef.current)
          return
        }

        const refreshed = await refreshAuthorizationAfterTemplateSave({
          snapshot,
          onTemplatesChanged: onTemplatesChangedRef.current,
          onAuthInvalid: onAuthInvalidRef.current,
        })
        if (!asyncGuard.isMounted()) return

        if (!asyncGuard.isCurrentSave(saveToken)) {
          setAuthorizationClosed(true)
          await invalidateAuthorization(onAuthInvalidRef.current)
          return
        }
        if (!refreshed) {
          setAuthorizationClosed(true)
          setError('权限模板已保存，但当前权限无法安全刷新，请重新登录')
          return
        }

        setEditorData((current) => {
          if (
            current.subjectType !== request.subjectType ||
            current.selectedSubject !== request.subjectCode
          ) return current
          return applyPermissionTemplateSnapshot(current, snapshot)
        })
        setStatus(`${request.subjectCode}权限模板已保存`)
      } catch (saveError) {
        if (!asyncGuard.isMounted()) return
        if (!asyncGuard.isCurrentSave(saveToken)) {
          if (TERMINAL_AUTH_ERROR_CODES.has(saveError?.code)) {
            setAuthorizationClosed(true)
            await delegateTerminalAuthError(saveError, onAuthInvalidRef.current)
          }
          return
        }
        if (TERMINAL_AUTH_ERROR_CODES.has(saveError?.code)) {
          setAuthorizationClosed(true)
          await delegateTerminalAuthError(saveError, onAuthInvalidRef.current)
          return
        }
        setError(safeErrorMessage(saveError, '权限模板保存失败，请稍后重试'))
      }
    })()

    saveInFlightRef.current = operation
    try {
      await operation
    } finally {
      if (saveInFlightRef.current === operation) {
        saveInFlightRef.current = null
        notifyMutationState(mutationStateCallback, false)
        if (asyncGuard.isMounted()) setMutation(false)
      }
    }
  }

  if (authorizationClosed) {
    return (
      <section
        className='permission-template-closed'
        role='alert'
        aria-labelledby='permission-template-closed-title'
      >
        <h2 id='permission-template-closed-title'>需要重新登录</h2>
        <p>权限模板状态已改变。为确保当前权限准确，请退出后重新登录。</p>
      </section>
    )
  }

  return (
    <section
      className='permission-template-editor'
      aria-labelledby='permission-template-editor-title'
    >
      <header className='permission-template-heading'>
        <div className='permission-template-heading-copy'>
          <p className='permission-template-eyebrow'>部门与职位模板</p>
          <h2 id='permission-template-editor-title'>系统权限设置</h2>
        </div>
        <p className='permission-template-guidance'>
          员工有效权限为所属部门权限与职位权限的并集。未配置的模板默认没有任何业务权限。
        </p>
      </header>

      <div
        className='permission-template-tabs'
        role='tablist'
        aria-label='权限模板类型'
      >
        {Object.entries(SUBJECT_CONFIG).map(([type, config]) => (
          <button
            ref={(node) => {
              if (node) subjectTabRefs.current.set(type, node)
              else subjectTabRefs.current.delete(type)
            }}
            className='permission-template-tab'
            type='button'
            role='tab'
            aria-selected={subjectType === type}
            aria-controls='permission-template-panel'
            tabIndex={subjectType === type ? 0 : -1}
            disabled={mutation || loading || isDirty}
            key={type}
            onClick={() => changeSubjectType(type)}
            onKeyDown={(event) => handleSubjectTabKeyDown(event, type)}
          >
            {config.label}
          </button>
        ))}
      </div>

      <form
        id='permission-template-panel'
        className='permission-template-panel'
        role='tabpanel'
        onSubmit={saveTemplate}
      >
        <label className='permission-template-subject-field'>
          <span>{subjectConfig.label}对象</span>
          <select
            value={selectedSubject}
            disabled={mutation || loading || isDirty}
            onChange={(event) => changeSelectedSubject(event.target.value)}
          >
            {subjectOptions.map((subject) => (
              <option value={subject} key={subject}>{subject}</option>
            ))}
          </select>
        </label>

        <div className='permission-template-subject-summary' role='status'>
          {loading
            ? '正在读取权限模板…'
            : `${selectedSubject}已选择 ${selectedPermissionCount} 项权限`}
          {isDirty && ' · 有未保存的更改'}
        </div>

        <div className='permission-template-matrix-scroll'>
          <table className='permission-template-matrix'>
            <thead>
              <tr>
                <th scope='col'>业务模块</th>
                {PERMISSION_ACTIONS.map((action) => (
                  <th scope='col' key={action.code}>{action.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modulePermissionRows.map((module) => (
                <tr key={module.code}>
                  <th className='permission-template-module-name' scope='row'>
                    {module.label}
                  </th>
                  {module.permissions.map(({ permissionKey, label }) => (
                    <td key={permissionKey}>
                      <label className='permission-template-checkbox'>
                        <input
                          type='checkbox'
                          checked={draftPermissionKeys.includes(permissionKey)}
                          disabled={!templates || mutation || loading}
                          onChange={() =>
                            togglePermission(permissionKey)}
                        />
                        <span>{label}</span>
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <fieldset
          className='permission-template-sensitive'
          disabled={!templates || mutation || loading}
        >
          <legend>敏感数据权限</legend>
          <div className='permission-template-sensitive-grid'>
            {SENSITIVE_PERMISSION_CATALOG.map(({ key, label }) => {
              const financialPermissionDisabled =
                templateContainsForbiddenProjectFinancialGrant(
                  subjectType,
                  selectedSubject,
                  [key],
                )
              return (
                <label
                  className='permission-template-sensitive-option'
                  key={key}
                >
                  <input
                    type='checkbox'
                    checked={draftPermissionKeys.includes(key)}
                    disabled={financialPermissionDisabled}
                    aria-disabled={financialPermissionDisabled}
                    onChange={() =>
                      togglePermission(key)}
                  />
                  <span>{label}</span>
                </label>
              )
            })}
          </div>
        </fieldset>

        {status && (
          <p className='permission-template-status' role='status'>{status}</p>
        )}
        {error && (
          <p className='permission-template-error' role='alert'>{error}</p>
        )}

        <div className='permission-template-actions'>
          <button
            className='permission-template-discard'
            type='button'
            disabled={mutation || loading || !isDirty}
            onClick={discardDraft}
          >
            放弃更改
          </button>
          <button
            className='permission-template-save'
            type='submit'
            disabled={!canSave}
          >
            {mutation ? '正在保存…' : '保存权限模板'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default function PermissionTemplateEditor({
  currentEmployee,
  permissionTemplateService,
  onAuthInvalid,
  onTemplatesChanged,
  onMutationStateChange,
}) {
  if (!isPersonnelAdministrator(currentEmployee)) return null

  return (
    <AuthorizedPermissionTemplateEditor
      permissionTemplateService={permissionTemplateService}
      onAuthInvalid={onAuthInvalid}
      onTemplatesChanged={onTemplatesChanged}
      onMutationStateChange={onMutationStateChange}
    />
  )
}
