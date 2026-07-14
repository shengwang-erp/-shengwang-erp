import { createClient } from '@supabase/supabase-js'

const viteEnvironment = import.meta.env ?? {}
const supabaseUrl = viteEnvironment.VITE_SUPABASE_URL?.trim() ?? ''
const supabasePublishableKey =
  viteEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  viteEnvironment.VITE_SUPABASE_ANON_KEY?.trim() ||
  ''

export const SUPABASE_AUTH_STORAGE_KEY = 'sw-erp-auth-session-v1'

function browserLocalStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export const supabaseAuthStorage = Object.freeze({
  getItem(key) {
    return browserLocalStorage()?.getItem(key) ?? null
  },
  setItem(key, value) {
    browserLocalStorage()?.setItem(key, value)
  },
  removeItem(key) {
    browserLocalStorage()?.removeItem(key)
  },
})

export async function clearPersistedSupabaseSession(storage = supabaseAuthStorage) {
  for (const key of [
    SUPABASE_AUTH_STORAGE_KEY,
    `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`,
    `${SUPABASE_AUTH_STORAGE_KEY}-user`,
  ]) {
    await storage.removeItem(key)
  }
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

function isLegacyAnonKey(value) {
  const parts = value.split('.')
  if (parts.length !== 3 || parts.some((part) => !part)) return false
  try {
    const encodedPayload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padding = '='.repeat((4 - (encodedPayload.length % 4)) % 4)
    const payload = JSON.parse(globalThis.atob(`${encodedPayload}${padding}`))
    return payload?.role === 'anon'
  } catch {
    return false
  }
}

export function isValidSupabaseConfiguration(url, key) {
  if (!isValidHttpUrl(url) || typeof key !== 'string') return false
  return /^sb_publishable_[A-Za-z0-9_-]{20,}$/u.test(key) || isLegacyAnonKey(key)
}

let configuredClient = null
if (isValidSupabaseConfiguration(supabaseUrl, supabasePublishableKey)) {
  try {
    configuredClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: supabaseAuthStorage,
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
      },
    })
  } catch {
    configuredClient = null
  }
}

export const supabase = configuredClient
export const isSupabaseConfigured = Boolean(configuredClient)
