import React, { useEffect, useRef, useState } from 'react'

import './accountingReportActions.css'
import AccountingReportPrintSheet from './AccountingReportPrintSheet.jsx'
import { createAccountingReportOutputSnapshot } from './accountingReportModel.js'
import {
  exportAccountingReportXlsx,
  printAccountingReport,
} from './accountingReportExport.js'

const ERROR_MESSAGE = '报表生成失败，当前页面和筛选已保留'

export default function AccountingReportActions({
  report,
  disabled = false,
  contextIdentity,
  onError,
  exportExcel = exportAccountingReportXlsx,
  printReport = printAccountingReport,
  now = () => new Date(),
}) {
  const [operation, setOperation] = useState(null)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const contextRef = useRef(contextIdentity)
  const onErrorRef = useRef(onError)
  const printReportRef = useRef(printReport)
  contextRef.current = contextIdentity
  onErrorRef.current = onError
  printReportRef.current = printReport

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
    }
  }, [])

  useEffect(() => {
    generationRef.current += 1
    setOperation(null)
  }, [contextIdentity])

  const isCurrent = (generation, identity) => mountedRef.current
    && generationRef.current === generation
    && contextRef.current === identity

  const beginExcel = async () => {
    if (disabled || !report || operation) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    const identity = contextRef.current
    const outputGuard = () => isCurrent(generation, identity)
    setOperation({ type: 'excel', generation, identity })
    try {
      const outputReport = createAccountingReportOutputSnapshot(report, now())
      await exportExcel(outputReport, { outputGuard })
    } catch {
      if (outputGuard()) onErrorRef.current?.(ERROR_MESSAGE)
    } finally {
      if (outputGuard()) setOperation(null)
    }
  }

  const beginPrint = (type) => {
    if (disabled || !report || operation) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    try {
      const outputReport = createAccountingReportOutputSnapshot(report, now())
      setOperation({
        type,
        generation,
        identity: contextRef.current,
        report: outputReport,
      })
    } catch {
      if (isCurrent(generation, contextRef.current)) onErrorRef.current?.(ERROR_MESSAGE)
    }
  }

  useEffect(() => {
    if (!operation || operation.type === 'excel') return undefined
    let active = true
    const outputGuard = () => active && isCurrent(operation.generation, operation.identity)
    Promise.resolve().then(() => {
      if (!outputGuard()) return false
      return printReportRef.current()
    }).catch(() => {
      if (outputGuard()) onErrorRef.current?.(ERROR_MESSAGE)
    }).finally(() => {
      if (outputGuard()) setOperation(null)
    })
    return () => { active = false }
  }, [operation])

  const blocked = disabled || !report || Boolean(operation)
  return <>
    <div className="accounting-report-actions" aria-label="会计报表输出操作">
      <button type="button" disabled={blocked} onClick={() => { void beginExcel() }}>导出 Excel</button>
      <span className="accounting-report-pdf-action">
        <button type="button" disabled={blocked} onClick={() => beginPrint('pdf')}>导出 PDF</button>
        <small>在打印窗口选择“另存为 PDF”</small>
      </span>
      <button type="button" disabled={blocked} onClick={() => beginPrint('print')}>打印</button>
    </div>
    {operation && operation.type !== 'excel' && (
      <AccountingReportPrintSheet report={operation.report} />
    )}
  </>
}
