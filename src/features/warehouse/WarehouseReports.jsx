import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  exportWarehouseXlsx,
  printWarehouseReport,
  WAREHOUSE_REPORTS,
} from './warehouseExport.js'
import './warehouseReportPrint.css'

const EMPTY_FILTERS = Object.freeze({
  dateFrom: '',
  dateTo: '',
  month: '',
  warehouseId: '',
  locationId: '',
  category: '',
  variantId: '',
  projectId: '',
  destinationType: '',
  status: '',
  keyword: '',
})

const REPORT_BY_ID = new Map(WAREHOUSE_REPORTS.map((report) => [report.id, report]))

const visibleFilters = (report, filters, pageSize = 100) => ({
  ...Object.fromEntries(report.filters
    .filter((key) => typeof filters[key] === 'string' && filters[key].trim())
    .map((key) => [key, filters[key].trim()])),
  page: 1,
  pageSize,
})

const reportFilterSummary = (report, filters) => {
  const entries = report.filters
    .filter((key) => filters[key]?.trim())
    .map((key) => `${key}：${filters[key].trim()}`)
  return entries.length ? entries.join('｜') : '全部数据'
}

const displayValue = (value, key) => {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value !== 'number') return String(value)
  const formatted = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 4 }).format(value)
  if (key === 'unitCost' || key === 'totalCost') return `¥${formatted}`
  if (key === 'quantityDelta' && value > 0) return `+${formatted}`
  return formatted
}

function FilterField({ name, value, onChange }) {
  if (name === 'dateFrom' || name === 'dateTo') {
    return (
      <label className="field">
        <span>{name === 'dateFrom' ? '起始日期' : '结束日期'}</span>
        <input type="date" value={value} onChange={(event) => onChange(name, event.target.value)} />
      </label>
    )
  }
  if (name === 'month') {
    return (
      <label className="field">
        <span>盘点月份</span>
        <input type="month" value={value} onChange={(event) => onChange(name, event.target.value)} />
      </label>
    )
  }
  if (name === 'destinationType') {
    return (
      <label className="field">
        <span>去向类型</span>
        <select value={value} onChange={(event) => onChange(name, event.target.value)}>
          <option value="">全部</option>
          <option value="project">正式项目</option>
          <option value="minor_work_order">小工事</option>
          <option value="internal_use">公司内部使用</option>
        </select>
      </label>
    )
  }
  if (name === 'status') {
    return (
      <label className="field">
        <span>状态</span>
        <select value={value} onChange={(event) => onChange(name, event.target.value)}>
          <option value="">全部</option>
          <option value="active">启用</option>
          <option value="inactive">停用</option>
          <option value="pending">待确认</option>
          <option value="confirmed">已确认</option>
          <option value="rejected">已驳回</option>
          <option value="void">已冲销</option>
        </select>
      </label>
    )
  }
  const labels = {
    warehouseId: '仓库编号', locationId: '货架区编号', category: '分类',
    variantId: '型号编号', projectId: '项目编号', keyword: '关键词',
  }
  return (
    <label className="field">
      <span>{labels[name]}</span>
      <input
        type="text"
        value={value}
        placeholder={name === 'keyword' ? '物品、SKU、型号、单号' : ''}
        onChange={(event) => onChange(name, event.target.value)}
      />
    </label>
  )
}

export default function WarehouseReports({
  warehouseService,
  canExport = false,
  companyName = '生旺株式会社',
  initialReport = null,
  exportReport = exportWarehouseXlsx,
  printReport = printWarehouseReport,
}) {
  const initialType = REPORT_BY_ID.has(initialReport?.reportType)
    ? initialReport.reportType
    : 'current_stock'
  const [reportType, setReportType] = useState(initialType)
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS })
  const [appliedFilters, setAppliedFilters] = useState({ ...EMPTY_FILTERS })
  const [result, setResult] = useState(initialReport)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const requestSequence = useRef(0)
  const selected = REPORT_BY_ID.get(reportType) ?? WAREHOUSE_REPORTS[0]

  const load = useCallback(async (type, filterState) => {
    const reportDefinition = REPORT_BY_ID.get(type)
    if (!reportDefinition || typeof warehouseService?.listReport !== 'function') {
      setError('仓库报表暂不可用，请稍后重试')
      return
    }
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    setLoading(true)
    setError('')
    try {
      const response = await warehouseService.listReport(
        type,
        visibleFilters(reportDefinition, filterState),
        { export: false },
      )
      if (requestSequence.current === sequence) {
        setResult(response)
        setAppliedFilters({ ...filterState })
      }
    } catch {
      if (requestSequence.current === sequence) {
        setResult(null)
        setError('仓库报表加载失败，请稍后重试')
      }
    } finally {
      if (requestSequence.current === sequence) setLoading(false)
    }
  }, [warehouseService])

  useEffect(() => {
    load(reportType, EMPTY_FILTERS)
    return () => { requestSequence.current += 1 }
  }, [load, reportType])

  const setFilter = (name, value) => {
    setFilters((current) => ({
      ...current,
      [name]: value,
      ...(name === 'warehouseId' ? { locationId: '' } : {}),
    }))
  }

  const draftFilterSummary = useMemo(
    () => reportFilterSummary(selected, filters),
    [filters, selected],
  )
  const appliedFilterSummary = useMemo(
    () => reportFilterSummary(selected, appliedFilters),
    [appliedFilters, selected],
  )
  const filtersDirty = selected.filters.some((key) =>
    (filters[key] ?? '').trim() !== (appliedFilters[key] ?? '').trim())

  const handleExport = async () => {
    if (!canExport || exporting || typeof warehouseService?.listReport !== 'function') return
    setExporting(true)
    setError('')
    try {
      const exported = await warehouseService.listReport(
        reportType,
        visibleFilters(selected, filters, 20_000),
        { export: true },
      )
      await exportReport(reportType, exported.rows, {
        companyName,
        generatedAt: exported.generatedAt,
        filterSummary: draftFilterSummary,
        fileName: `${selected.title}_${exported.generatedAt.slice(0, 10)}`,
      })
    } catch {
      setError('Excel 导出失败，请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  const rows = result?.reportType === reportType && Array.isArray(result.rows)
    ? result.rows
    : []

  return (
    <section className="warehouse-workflow-section warehouse-reports" aria-labelledby="warehouse-reports-title">
      <div className="warehouse-section-heading">
        <div>
          <p className="eyebrow dark-text">报表中心</p>
          <h2 id="warehouse-reports-title">仓库报表</h2>
        </div>
        <span>{loading ? '加载中…' : `${rows.length} 条当前结果`}</span>
      </div>

      <div className="form-panel warehouse-report-controls">
        <div className="warehouse-report-selector">
          <label className="field">
            <span>报表类型</span>
            <select
              value={reportType}
              onChange={(event) => {
                setFilters({ ...EMPTY_FILTERS })
                setAppliedFilters({ ...EMPTY_FILTERS })
                setResult(null)
                setError('')
                setReportType(event.target.value)
              }}
            >
              {WAREHOUSE_REPORTS.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.title}</option>
              ))}
            </select>
          </label>
          <div className="warehouse-report-actions">
            <button type="button" className="ghost-button" disabled={loading || filtersDirty || !result} onClick={() => {
              if (loading || filtersDirty || !result) return
              setError('')
              try { printReport() } catch { setError('打印失败，请稍后重试') }
            }}>
              打印/PDF
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canExport || exporting}
              title={canExport ? '' : '没有 Excel 导出权限'}
              onClick={handleExport}
            >
              {exporting ? '正在导出…' : '导出 Excel'}
            </button>
          </div>
        </div>

        <div className="form-grid warehouse-report-filter-grid">
          {selected.filters.map((name) => (
            <FilterField key={name} name={name} value={filters[name]} onChange={setFilter} />
          ))}
        </div>
        <div className="warehouse-report-query-actions">
          <button type="button" className="primary-button" disabled={loading} onClick={() => load(reportType, filters)}>
            查询
          </button>
          <button type="button" className="ghost-button" onClick={() => {
            const cleared = { ...EMPTY_FILTERS }
            setFilters(cleared)
            load(reportType, cleared)
          }}>
            清空筛选
          </button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>

      <div className="warehouse-print-sheet">
        <header className="warehouse-print-header">
          <p>{companyName}</p>
          <h3>{selected.title}</h3>
          <p>筛选条件：{appliedFilterSummary}</p>
          <p>生成时间：{result?.generatedAt || '—'}</p>
        </header>
        <div className="warehouse-report-table-wrap">
          <table className="warehouse-report-table">
            <thead>
              <tr>{selected.columns.map((definition) => <th key={definition.key}>{definition.header}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${reportType}-${index}`}>
                  {selected.columns.map((definition) => (
                    <td key={definition.key}>{displayValue(row[definition.key], definition.key)}</td>
                  ))}
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={selected.columns.length}>当前筛选条件下没有记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
