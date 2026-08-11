import React from 'react'
import { createPortal } from 'react-dom'

import './accountingReportPrint.css'
import { formatAccountingReportDisplayValue } from './accountingReportModel.js'

const PRINT_EMPTY_SECTION_TEXT = '当前筛选条件下无记录'

export default function AccountingReportPrintSheet({ report }) {
  if (!report) return null

  const sheet = (
    <article className={`accounting-report-sheet ${report.orientation}`} aria-label={report.title}>
      <header>
        <strong>{report.companyName}</strong>
        <h1>{report.title}</h1>
        <dl>{report.filterLines.map(({ label, value, format }) => <div key={label}>
          <dt>{label}</dt>
          <dd>{formatAccountingReportDisplayValue(value, format)}</dd>
        </div>)}</dl>
        <p>生成时间：{report.generatedAt}　制表人：{report.preparedBy}　记录数：{report.recordCount}</p>
      </header>

      <section className="accounting-report-summary">
        <h2>汇总</h2>
        <table><tbody>{report.summary.map(({ label, value, format }) => <tr key={label}>
          <th>{label}</th>
          <td className={format === 'money' ? 'align-right' : undefined}>
            {formatAccountingReportDisplayValue(value, format)}
          </td>
        </tr>)}</tbody></table>
      </section>

      {report.sections.map((section) => <section key={section.id}>
        <h2>{section.title}</h2>
        <table>
          <thead><tr>{section.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>{section.rows.length === 0
            ? <tr><td colSpan={section.columns.length}>{PRINT_EMPTY_SECTION_TEXT}</td></tr>
            : section.rows.map((row, index) => <tr key={`${section.id}:${index}`}>
              {section.columns.map((column) => <td className={`align-${column.align ?? 'left'}`} key={column.key}>
                {formatAccountingReportDisplayValue(row[column.key], column.format)}
              </td>)}
            </tr>)}</tbody>
        </table>
      </section>)}

      <aside>{report.notes.map((note) => <p key={note}>{note}</p>)}</aside>
      <footer>
        <span>制表人：{report.preparedBy}</span>
        <span>复核人：</span>
        <span>审批人：</span>
        <span className="accounting-report-page-number" />
      </footer>
    </article>
  )
  const root = <div className="accounting-report-print-root">{sheet}</div>
  const portalTarget = globalThis.document?.body
  return portalTarget?.nodeType === 1 ? createPortal(root, portalTarget) : root
}
