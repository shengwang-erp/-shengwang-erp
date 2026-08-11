import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('./LightweightProjectForm.jsx', import.meta.url),
  'utf8',
).catch(() => '')

test('lightweight form exposes the approved short-project fields', () => {
  for (const label of [
    '项目名称', '客户名称', '项目地址', '施工日期', '工期',
    '负责人', '施工人员', '预计金额', '项目状态', '结算状态',
    '备注', '现场照片与附件',
  ]) assert.match(source, new RegExp(label, 'u'), label)

  assert.match(source, /half_day/)
  assert.match(source, /full_day/)
  assert.match(source, /半天/)
  assert.match(source, /全天/)
  assert.match(source, /workerAssignments/)
  assert.match(source, /ProjectLocationPicker/)
})

test('Miraisya customer is read-only and its manual expected amount is absent', () => {
  assert.match(source, /projectType\s*===\s*PROJECT_TYPES\.MIRAISYA/)
  assert.match(source, /MIRAISYA_CUSTOMER_NAME/)
  assert.match(source, /readOnly=\{isMiraisya\}/)
  assert.match(source, /projectType\s*===\s*PROJECT_TYPES\.SMALL[\s\S]*预计金额/)
  assert.doesNotMatch(source, /isMiraisya[\s\S]{0,120}label=["']预计金额/)
})

test('lightweight form delegates save and cancel without owning persistence', () => {
  assert.match(source, /onSubmit=\{onSubmit\}/)
  assert.match(source, /onClick=\{onCancel\}/)
  assert.doesNotMatch(source, /projectService|supabase|localStorage/)
})
