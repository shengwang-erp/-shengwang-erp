import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearPersistedSupabaseSession,
  isValidSupabaseConfiguration,
  SUPABASE_AUTH_STORAGE_KEY,
} from './supabaseClient.js'

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function legacyJwt(role) {
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({ role })}.signature`
}

test('browser configuration accepts modern publishable keys and legacy anon JWTs', () => {
  assert.equal(
    isValidSupabaseConfiguration(
      'https://example.supabase.co',
      `sb_publishable_${'A'.repeat(24)}`,
    ),
    true,
  )
  assert.equal(
    isValidSupabaseConfiguration('http://127.0.0.1:54321', legacyJwt('anon')),
    true,
  )
})

test('browser configuration rejects invalid URLs, unknown keys, and privileged JWT roles', () => {
  assert.equal(isValidSupabaseConfiguration('not-a-url', `sb_publishable_${'A'.repeat(24)}`), false)
  assert.equal(isValidSupabaseConfiguration('https://example.supabase.co', 'not-a-key'), false)
  assert.equal(
    isValidSupabaseConfiguration(
      'https://example.supabase.co',
      legacyJwt(['service', 'role'].join('_')),
    ),
    false,
  )
})

test('persisted-session fallback clears every Supabase Auth storage artifact', async () => {
  const removedKeys = []
  const storage = {
    removeItem(key) {
      removedKeys.push(key)
    },
  }

  await clearPersistedSupabaseSession(storage)

  assert.deepEqual(removedKeys, [
    SUPABASE_AUTH_STORAGE_KEY,
    `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`,
    `${SUPABASE_AUTH_STORAGE_KEY}-user`,
  ])
})
