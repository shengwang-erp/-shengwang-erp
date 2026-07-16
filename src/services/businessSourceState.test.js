import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyBusinessSourceError,
  resolveRequiredSources,
  toBusinessSourceState,
} from './businessSourceState.js'

test('only an authorized completed source becomes ready', () => {
  assert.deepEqual(
    toBusinessSourceState(
      { loading: false, error: '', source: 'supabase' },
      { readAllowed: true, data: [] },
    ),
    {
      status: 'ready', data: [], code: '', message: '', source: 'supabase',
      stale: false, updatedAt: null, fatal: false,
    },
  )
  assert.equal(toBusinessSourceState({}, { readAllowed: false, data: [] }).status, 'forbidden')
  assert.equal(toBusinessSourceState({
    loading: false, error: '没有权限执行此数据操作',
    code: 'ACCESS_DENIED', source: 'blocked',
  }, { data: [] }).status, 'forbidden')
})

test('required-source resolution never treats loading, forbidden, or error as zero', () => {
  const result = resolveRequiredSources({
    projects: { status: 'ready', data: [] },
    receipts: { status: 'error', data: [] },
  }, ['projects', 'receipts'])
  assert.equal(result.status, 'error')
  assert.deepEqual(result.blockingSources, ['receipts'])
})

test('a missing required source is loading and a stale source remains ready but disclosed', () => {
  assert.deepEqual(resolveRequiredSources({}, ['projects']), {
    status: 'loading', blockingSources: ['projects'], staleSources: [],
  })
  assert.deepEqual(resolveRequiredSources({
    projects: { status: 'ready', data: [], stale: true },
  }, ['projects']), {
    status: 'ready', blockingSources: [], staleSources: ['projects'],
  })
  assert.equal(resolveRequiredSources({
    projects: { status: 'unknown', data: [] },
  }, ['projects']).status, 'error')
})

test('error classification keeps auth/config fatal and access denial local', () => {
  assert.deepEqual(classifyBusinessSourceError({ code: 'ACCESS_DENIED' }), {
    status: 'forbidden', fatal: false, code: 'ACCESS_DENIED', message: '无权读取该数据',
  })
  assert.equal(classifyBusinessSourceError({ code: 'AUTH_SESSION_INVALID' }).fatal, true)
})
