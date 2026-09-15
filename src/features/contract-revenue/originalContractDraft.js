const VERSION = 1
const PREFIX = 'shengwang-erp:form-draft:v1'
const FIELDS = Object.freeze([
  'taxInclusiveAmount',
  'taxRate',
  'taxExclusiveAmount',
  'taxAmount',
])

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function storageKey(accountId, projectId) {
  const account = clean(accountId)
  const project = clean(projectId)
  return account && project
    ? `${PREFIX}:${encodeURIComponent(account)}:project:${encodeURIComponent(project)}:original-contract`
    : ''
}

function browserStorage() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

function copyForm(form) {
  const source = form && typeof form === 'object' ? form : {}
  return Object.fromEntries(
    FIELDS.map((field) => [
      field,
      typeof source[field] === 'string' || typeof source[field] === 'number'
        ? String(source[field])
        : '',
    ]),
  )
}

export function createOriginalContractDraftStore(options = {}) {
  const storage = Object.hasOwn(options, 'storage')
    ? options.storage
    : browserStorage()

  return {
    load(accountId, projectId) {
      const key = storageKey(accountId, projectId)
      if (!key || !storage) return null
      try {
        const parsed = JSON.parse(storage.getItem(key) || 'null')
        return parsed?.version === VERSION && parsed.form && typeof parsed.form === 'object'
          ? copyForm(parsed.form)
          : null
      } catch {
        return null
      }
    },
    save(accountId, projectId, form) {
      const key = storageKey(accountId, projectId)
      if (!key || !storage) return
      try {
        storage.setItem(key, JSON.stringify({ version: VERSION, form: copyForm(form) }))
      } catch {
        // Browser session storage is best effort; database validation remains authoritative.
      }
    },
    clear(accountId, projectId) {
      const key = storageKey(accountId, projectId)
      if (!key || !storage) return
      try {
        storage.removeItem(key)
      } catch {
        // Clearing is best effort and never changes persisted contract state.
      }
    },
  }
}
