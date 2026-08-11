import {
  DEPARTMENT_OPTIONS,
  POSITION_OPTIONS,
} from '../../auth/employeeAuthDomain.js'
import {
  templateContainsForbiddenProjectFinancialGrant,
} from '../../auth/permissionCatalog.js'

const EMPTY_PERMISSION_KEYS = Object.freeze([])

export const PERMISSION_TEMPLATE_SUBJECT_CONFIG = Object.freeze({
  department: Object.freeze({
    label: '部门权限',
    collection: 'departments',
    options: DEPARTMENT_OPTIONS,
  }),
  position: Object.freeze({
    label: '职位权限',
    collection: 'positions',
    options: POSITION_OPTIONS,
  }),
})

export function resolvePermissionTemplateTabKey(key, currentIndex, tabCount) {
  if (
    !Number.isInteger(currentIndex) || !Number.isInteger(tabCount) ||
    tabCount < 1 || currentIndex < 0 || currentIndex >= tabCount
  ) return null

  if (key === 'Home') return 0
  if (key === 'End') return tabCount - 1
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return (currentIndex + 1) % tabCount
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return (currentIndex - 1 + tabCount) % tabCount
  }
  return null
}

function permissionKeysEqual(left, right) {
  return left.length === right.length &&
    left.every((permissionKey, index) => permissionKey === right[index])
}

function isDraftBoundToSelection(editorData) {
  return editorData.draft.subjectType === editorData.subjectType &&
    editorData.draft.subjectCode === editorData.selectedSubject
}

function getPermissionKeys(templates, subjectType, subjectCode) {
  const collection = PERMISSION_TEMPLATE_SUBJECT_CONFIG[subjectType]?.collection
  const permissionKeys = collection
    ? templates?.[collection]?.[subjectCode]
    : null
  return Array.isArray(permissionKeys) ? permissionKeys : EMPTY_PERMISSION_KEYS
}

function createBoundDraft(templates, subjectType, subjectCode) {
  return {
    subjectType,
    subjectCode,
    permissionKeys: [...getPermissionKeys(templates, subjectType, subjectCode)],
  }
}

export function createPermissionTemplateEditorData() {
  const subjectType = 'department'
  const selectedSubject = DEPARTMENT_OPTIONS[0]
  return {
    subjectType,
    selectedSubject,
    templates: null,
    draft: createBoundDraft(null, subjectType, selectedSubject),
  }
}

export function clearPermissionTemplateSnapshot(editorData) {
  return {
    ...editorData,
    templates: null,
    draft: createBoundDraft(
      null,
      editorData.subjectType,
      editorData.selectedSubject,
    ),
  }
}

export function applyPermissionTemplateSnapshot(editorData, snapshot) {
  return {
    ...editorData,
    templates: snapshot,
    draft: createBoundDraft(
      snapshot,
      editorData.subjectType,
      editorData.selectedSubject,
    ),
  }
}

export function selectPermissionTemplateSubject(
  editorData,
  subjectType,
  subjectCode,
) {
  const config = PERMISSION_TEMPLATE_SUBJECT_CONFIG[subjectType]
  if (!config?.options.includes(subjectCode)) return editorData

  return {
    ...editorData,
    subjectType,
    selectedSubject: subjectCode,
    draft: createBoundDraft(editorData.templates, subjectType, subjectCode),
  }
}

export function togglePermissionTemplateDraft(editorData, permissionKey) {
  if (!editorData.templates || !isDraftBoundToSelection(editorData)) {
    return editorData
  }
  if (
    templateContainsForbiddenProjectFinancialGrant(
      editorData.subjectType,
      editorData.selectedSubject,
      [permissionKey],
    )
  ) return editorData

  const current = editorData.draft.permissionKeys
  const permissionKeys = current.includes(permissionKey)
    ? current.filter((candidate) => candidate !== permissionKey)
    : [...current, permissionKey].sort()

  return {
    ...editorData,
    draft: {
      ...editorData.draft,
      permissionKeys,
    },
  }
}

export function discardPermissionTemplateDraft(editorData) {
  if (!editorData.templates) return editorData
  return {
    ...editorData,
    draft: createBoundDraft(
      editorData.templates,
      editorData.subjectType,
      editorData.selectedSubject,
    ),
  }
}

export function isPermissionTemplateDraftDirty(editorData) {
  if (!editorData.templates || !isDraftBoundToSelection(editorData)) {
    return false
  }
  const storedPermissionKeys = getPermissionKeys(
    editorData.templates,
    editorData.subjectType,
    editorData.selectedSubject,
  )
  return !permissionKeysEqual(
    editorData.draft.permissionKeys,
    storedPermissionKeys,
  )
}

export function canSavePermissionTemplateDraft(
  editorData,
  { loading, mutation },
) {
  return !loading && !mutation && isPermissionTemplateDraftDirty(editorData)
}

export async function refreshAuthorizationAfterTemplateSave({
  snapshot,
  onTemplatesChanged,
  onAuthInvalid,
}) {
  if (typeof onTemplatesChanged === 'function') {
    try {
      await onTemplatesChanged(snapshot)
      return true
    } catch {
      // AuthGate owns retryable-versus-terminal session handling.
      return false
    }
  }

  try {
    await onAuthInvalid?.()
  } catch {
    // The editor caller owns session cleanup; the component remains closed.
  }
  return false
}

export function createPermissionTemplateAsyncGuard() {
  let mounted = false
  let serviceGeneration = 0
  let readGeneration = 0
  let saveGeneration = 0

  return {
    mount() {
      mounted = true
    },
    unmount() {
      mounted = false
      serviceGeneration += 1
      readGeneration += 1
      saveGeneration += 1
    },
    isMounted() {
      return mounted
    },
    beginServiceGeneration() {
      serviceGeneration += 1
      readGeneration += 1
      return serviceGeneration
    },
    isServiceCurrent(generation) {
      return mounted && generation === serviceGeneration
    },
    beginRead(generation) {
      readGeneration += 1
      return {
        serviceGeneration: generation,
        readGeneration,
      }
    },
    isCurrentRead(token) {
      return mounted && token.serviceGeneration === serviceGeneration &&
        token.readGeneration === readGeneration
    },
    beginSave() {
      saveGeneration += 1
      return {
        serviceGeneration,
        saveGeneration,
      }
    },
    isCurrentSave(token) {
      return mounted && token.serviceGeneration === serviceGeneration &&
        token.saveGeneration === saveGeneration
    },
  }
}
