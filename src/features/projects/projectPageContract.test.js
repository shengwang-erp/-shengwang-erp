import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./ProjectPage.jsx', import.meta.url), 'utf8').catch(() => '')
const styles = await readFile(new URL('../../styles.css', import.meta.url), 'utf8')

test('project page has new fields, fixed copy, and no editable amount', () => {
  for (const copy of [
    '设计担当', '现场担当', '开工日期', '工程结束日期',
    '地址定位', '打卡范围', '历史负责人',
  ]) assert.match(source, new RegExp(copy))

  assert.doesNotMatch(source, /label=["']开始日期|>开始日期</)
  assert.doesNotMatch(source, /name=["']projectAmount|label=["']项目金额/)
  assert.doesNotMatch(source, /获取当前位置|navigator\.geolocation/)
})

test('financial cards and contract entry are gated as one block', () => {
  assert.match(source, /canViewProjectFinancials\(currentUser\)/)
  assert.match(source, /adjustedTaxInclusiveAmount/)
  assert.match(source, /未录入/)
  assert.match(source, /合同收入/)
  assert.doesNotMatch(source, /无金额权限/)
})

test('project form, directory errors, financials, and mobile layout are styled', () => {
  for (const selector of [
    '.project-form-heading',
    '.project-location-form-section',
    '.project-directory-error',
    '.project-financial-panel',
    '.project-location-pending',
  ]) assert.match(styles, new RegExp(selector.replace('.', '\\.')))

  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.project-form-grid/)
})

test('switching between edited projects remounts the map at the stored location', () => {
  assert.match(source, /<ProjectLocationPicker[\s\S]*?key=\{editingProjectId \|\| 'create'\}/)
})

test('project page offers three typed create actions and three separate lists', () => {
  for (const copy of [
    '新增主项目', '新增小项目', '新增未来社项目',
    '主项目', '小项目', '未来社项目',
  ]) assert.match(source, new RegExp(copy, 'u'), copy)

  assert.match(source, /PROJECT_TYPES\.STANDARD/)
  assert.match(source, /PROJECT_TYPES\.SMALL/)
  assert.match(source, /PROJECT_TYPES\.MIRAISYA/)
  assert.match(source, /normalizeProject\(project\)\.projectType/)
  assert.match(source, /<LightweightProjectForm/)
})

test('typed project controls use the approved identity-aware permission helpers', () => {
  assert.match(source, /canCreateTypedProject\(currentUser\)/)
  assert.match(source, /canEditTypedProject\(currentUser\)/)
  assert.match(source, /canDeleteTypedProject\(currentUser\)/)
  assert.match(source, /canManageMiraisyaSettlement\(currentUser\)/)
  assert.doesNotMatch(source, /const canCreateProject = canCreate\(/)
})

test('Miraisya rows expose billing and authorized monthly settlement callbacks', () => {
  assert.match(source, /onOpenMiraisyaProject/)
  assert.match(source, /onOpenMiraisyaSettlement/)
  assert.match(source, /收费与成本/)
  assert.match(source, /未来社月度结算/)
})
