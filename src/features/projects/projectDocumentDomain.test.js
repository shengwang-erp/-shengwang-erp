import test from 'node:test'
import assert from 'node:assert/strict'
import { PROJECT_DOCUMENT_KINDS, MAX_PROJECT_DOCUMENT_BYTES, TUS_THRESHOLD_BYTES, sanitizeDisplayFileName, sanitizeVoidReason, validateProjectDocumentFile, buildProjectDocumentGroups, SIGNED_ACCESS_TTL_SECONDS } from './projectDocumentDomain.js'

test('categories and byte boundaries are exact', () => {
  assert.deepEqual(PROJECT_DOCUMENT_KINDS, ['project_contract','rendering','contract_change_document'])
  assert.equal(MAX_PROJECT_DOCUMENT_BYTES, 50 * 1024 * 1024)
  assert.equal(TUS_THRESHOLD_BYTES, 6 * 1024 * 1024)
  assert.equal(SIGNED_ACCESS_TTL_SECONDS, 300)
  assert.equal(validateProjectDocumentFile({documentKind:'rendering', file:{name:'效果.heic',type:'',size:1024}}).canonicalContentType,'image/heic')
  assert.throws(() => validateProjectDocumentFile({documentKind:'rendering',file:{name:'x.png',type:'',size:1}}))
  assert.throws(() => validateProjectDocumentFile({documentKind:'rendering',file:{name:'x.png',type:'image/jpeg',size:1}}))
  assert.throws(() => validateProjectDocumentFile({documentKind:'rendering',file:{name:'x.exe',type:'image/png',size:1}}))
  assert.throws(() => validateProjectDocumentFile({documentKind:'rendering',file:{name:'x.png',type:'image/png',size:MAX_PROJECT_DOCUMENT_BYTES+1}}))
})

test('filename and void reason normalization are bounded', () => {
  const name = sanitizeDisplayFileName('../a\r\nb\0\u202e\u0001' + 'é'.repeat(300) + '.pdf')
  assert.ok(Buffer.byteLength(name)<=255); assert.ok(!/[\r\n\0\u202e\u0001]/u.test(name))
  assert.throws(() => sanitizeVoidReason('x'.repeat(501))); assert.equal(sanitizeVoidReason(' ok '), 'ok')
})

test('groups choose highest active version and never reuse voided version', () => {
  const groups = buildProjectDocumentGroups([
    {document_kind:'project_contract',version:1,status:'voided',void_reason:'bad'},
    {document_kind:'project_contract',version:2,status:'active'},
    {document_kind:'project_contract',version:3,status:'voided',void_reason:'oops'},
    {document_kind:'rendering',version:1,status:'active'},
  ])
  assert.equal(groups.project_contract.active.version, 2); assert.equal(groups.project_contract.nextVersion, 4)
})
