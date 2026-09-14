import {
  buildProjectPayload,
  normalizeProject,
} from './projectDomain.js'

const DRAFT_VERSION = 1
const DRAFT_KEY_PREFIX = 'shengwang-erp:form-draft:v1'

function accountIdForKey(accountId) {
  return typeof accountId === 'string' ? accountId.trim() : ''
}

function draftKey(accountId) {
  const value = accountIdForKey(accountId)
  return value ? `${DRAFT_KEY_PREFIX}:${encodeURIComponent(value)}:project-create` : ''
}

function browserSessionStorage() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

function sanitizeDraft(form) {
  return normalizeProject(buildProjectPayload(normalizeProject(form)))
}

export function createProjectCreateDraftStore(options = {}) {
  const storage = Object.hasOwn(options, 'storage')
    ? options.storage
    : browserSessionStorage()

  const load = (accountId) => {
    const key = draftKey(accountId)
    if (!key || !storage) return null
    try {
      const raw = storage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (parsed?.version !== DRAFT_VERSION || !parsed.form || typeof parsed.form !== 'object') {
        return null
      }
      return sanitizeDraft(parsed.form)
    } catch {
      return null
    }
  }

  const save = (accountId, form) => {
    const key = draftKey(accountId)
    if (!key || !storage) return
    try {
      storage.setItem(key, JSON.stringify({
        version: DRAFT_VERSION,
        form: buildProjectPayload(normalizeProject(form)),
      }))
    } catch {
      // Session storage can be unavailable in private or restricted browser contexts.
    }
  }

  const clear = (accountId) => {
    const key = draftKey(accountId)
    if (!key || !storage) return
    try {
      storage.removeItem(key)
    } catch {
      // Clearing is best effort; authentication and saving do not depend on storage.
    }
  }

  return { load, save, clear }
}
