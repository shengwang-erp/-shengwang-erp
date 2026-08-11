import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACCOUNTING_REPORT_EDITABLE_NOTICE,
  createAccountingReportModel,
  escapeAccountingSpreadsheetText,
  formatAccountingReportDisplayValue,
  formatAccountingReportFileName,
} from './accountingReportModel.js'

function reportInput(overrides = {}) {
  return {
    id: 'salary',
    title: '工资记录表',
    companyName: '生旺株式会社',
    generatedAt: '2026-08-11T03:00:00.000Z',
    preparedBy: '管理员',
    orientation: 'landscape',
    fileName: '工资记录_2026-08',
    filterLines: [{ label: '月份', value: '2026-08' }],
    recordCount: 1,
    summary: [{ label: '实发工资合计', value: 1200, format: 'money' }],
    sections: [{
      id: 'detail', title: '工资明细', sheetName: '工资明细',
      columns: [{ key: 'employeeName', label: '员工', width: 18, align: 'left', format: 'text' }],
      rows: [{ employeeName: '张三' }], emptyText: '当前筛选条件下无记录',
    }],
    notes: [],
    ...overrides,
  }
}

test('report contract is immutable, formula-safe, and keeps a zero-row section', () => {
  const report = createAccountingReportModel({
    id: 'salary', title: '工资记录表', companyName: '生旺株式会社',
    generatedAt: '2026-08-11T03:00:00.000Z', preparedBy: '=管理员',
    orientation: 'landscape', fileName: '工资记录_2026-08',
    filterLines: [{ label: '月份', value: '2026-08' }], recordCount: 0,
    summary: [{ label: '实发工资合计', value: 0, format: 'money' }],
    sections: [{ id: 'detail', title: '工资明细', sheetName: '工资明细', columns: [
      { key: 'employeeName', label: '员工', width: 18, align: 'left', format: 'text' },
    ], rows: [], emptyText: '当前筛选条件下无记录' }], notes: [],
  })
  assert.equal(report.preparedBy, '=管理员')
  assert.equal(escapeAccountingSpreadsheetText(report.preparedBy), "'=管理员")
  assert.equal(report.sections[0].emptyText, '当前筛选条件下无记录')
  assert.ok(Object.isFrozen(report.sections[0].columns))
  assert.equal(formatAccountingReportFileName('工资/记录:2026-08'), '工资_记录_2026-08')
})

test('report model clones and recursively freezes every consumer-visible value', () => {
  const input = reportInput({
    filterLines: [{ label: '部门', value: { name: '工务部' } }],
    summary: [{ label: '工资', value: { amount: 1200 }, format: 'money' }],
    sections: [{
      id: 'detail', title: '工资明细', sheetName: '工资明细',
      columns: [{ key: 'employeeName', label: '员工', width: 18, align: 'left', format: 'text' }],
      rows: [{ employeeName: '张三', metadata: { source: 'payroll' } }],
    }],
    notes: [{ text: '仅供核对' }],
  })

  const report = createAccountingReportModel(input)
  input.filterLines[0].value.name = '已修改'
  input.sections[0].rows[0].metadata.source = 'changed'

  assert.equal(report.filterLines[0].value.name, '工务部')
  assert.equal(report.sections[0].rows[0].metadata.source, 'payroll')
  assert.ok(Object.isFrozen(report))
  assert.ok(Object.isFrozen(report.filterLines[0].value))
  assert.ok(Object.isFrozen(report.sections[0].rows[0].metadata))
  assert.ok(Object.isFrozen(report.notes[0]))
  assert.equal(report.editableNotice, ACCOUNTING_REPORT_EDITABLE_NOTICE)
  assert.equal(report.sections[0].emptyText, '当前筛选条件下无记录')
})

test('report contract rejects unsafe page layout and invalid section structure', () => {
  assert.throws(() => createAccountingReportModel(reportInput({ orientation: 'wide' })), /orientation/u)
  assert.throws(() => createAccountingReportModel(reportInput({ sections: [] })), /section/u)
  assert.throws(() => createAccountingReportModel(reportInput({ sections: [
    reportInput().sections[0], { ...reportInput().sections[0] },
  ] })), /section id/u)
  assert.throws(() => createAccountingReportModel(reportInput({ sections: [{
    ...reportInput().sections[0], sheetName: ' ',
  }] })), /sheetName/u)
  assert.throws(() => createAccountingReportModel(reportInput({ sections: [{
    ...reportInput().sections[0], columns: [],
  }] })), /column/u)
})

test('display and Excel helpers keep display text readable while neutralizing formula cells', () => {
  assert.equal(escapeAccountingSpreadsheetText('  +SUM(A1:A2)'), "'  +SUM(A1:A2)")
  assert.equal(escapeAccountingSpreadsheetText('\tformula'), "'\tformula")
  assert.equal(escapeAccountingSpreadsheetText(42), 42)
  assert.equal(escapeAccountingSpreadsheetText(null), '')
  assert.equal(formatAccountingReportFileName('工资/记录:2026-08'), '工资_记录_2026-08')
  assert.equal(formatAccountingReportFileName(''), '会计报表')
  assert.equal(formatAccountingReportDisplayValue(1234, 'money'), '¥1,234')
  assert.equal(formatAccountingReportDisplayValue(1234.5, 'number'), '1,234.5')
  assert.equal(formatAccountingReportDisplayValue(12.5, 'percent'), '12.5%')
  assert.equal(formatAccountingReportDisplayValue('2026-08-11T03:00:00.000Z', 'date'), '2026-08-11')
  assert.equal(formatAccountingReportDisplayValue('工资', 'text'), '工资')
  assert.equal(formatAccountingReportDisplayValue(null, 'text'), '')
})
