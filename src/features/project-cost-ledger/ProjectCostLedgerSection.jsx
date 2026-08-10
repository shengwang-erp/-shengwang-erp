import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import ProjectCostAdjustmentDialog from './ProjectCostAdjustmentDialog.jsx'
import ProjectCostAllocationDialog from './ProjectCostAllocationDialog.jsx'
import ProjectCostManualEntryDialog from './ProjectCostManualEntryDialog.jsx'

const DEFAULT_FILTERS = Object.freeze({
  projectId: '', dateFrom: '', dateTo: '', category: '', sourceModule: '',
  adjusted: 'all', keyword: '',
})

const SOURCE_LABELS = Object.freeze({
  purchase: '采购', warehouse: '仓库', labor: '人工', vehicle: '车辆', tool: '工具',
  operating: '经营费用', manual: '手工费用',
})

const SOURCE_OPTIONS = Object.freeze([
  ['', '全部来源'], ['purchase', '采购'], ['warehouse', '仓库'], ['labor', '人工'],
  ['vehicle', '车辆'], ['tool', '工具'], ['operating', '经营费用'], ['manual', '手工费用'],
])

const CATEGORY_OPTIONS = Object.freeze([
  '人工费', '材料费', '车辆费', '工具费', '外包费', '运输费', '经营费用', '其他费用',
])

function formatYen(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency', currency: 'JPY', minimumFractionDigits: 0, maximumFractionDigits: 4,
  }).format(number)
}

function formatInstant(value) {
  if (!value) return '—'
  const instant = new Date(value)
  if (!Number.isFinite(instant.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(instant)
}

function requestFilters(filters, page, pageSize) {
  const result = { page, pageSize }
  for (const key of ['projectId', 'dateFrom', 'dateTo', 'category', 'sourceModule', 'keyword']) {
    if (filters[key]) result[key] = filters[key]
  }
  if (filters.adjusted !== 'all') result.adjusted = filters.adjusted
  return result
}

function auditRequestFilters(filters) {
  const result = {}
  for (const key of ['projectId', 'dateFrom', 'dateTo']) {
    if (filters[key]) result[key] = filters[key]
  }
  return result
}

function filterIdentity(filters) {
  return JSON.stringify(Object.keys(DEFAULT_FILTERS).map((key) => filters[key]))
}

function sameFilters(left, right) {
  return Object.keys(DEFAULT_FILTERS).every((key) => left[key] === right[key])
}

function isDefaultFilters(filters) {
  return sameFilters(filters, DEFAULT_FILTERS)
}

function appliedFilterLabel(filters, projects) {
  const labels = []
  if (filters.projectId) {
    labels.push(projects.find(({ projectId }) => projectId === filters.projectId)?.projectName || filters.projectId)
  } else labels.push('全部项目')
  if (filters.dateFrom || filters.dateTo) labels.push(`${filters.dateFrom || '不限'} 至 ${filters.dateTo || '不限'}`)
  if (filters.category) labels.push(filters.category)
  if (filters.sourceModule) labels.push(SOURCE_LABELS[filters.sourceModule] || filters.sourceModule)
  if (filters.adjusted === 'adjusted') labels.push('仅已调整')
  if (filters.adjusted === 'unadjusted') labels.push('仅未调整')
  if (filters.keyword) labels.push(`关键词：${filters.keyword}`)
  return labels.join(' · ')
}

function projectName(projects, projectId) {
  return projects.find((project) => project.projectId === projectId)?.projectName || projectId
}

function auditDescription(event) {
  if (event.eventType === 'allocation') return '项目拆分调整'
  return `${formatYen(event.amountBefore)} → ${formatYen(event.amountAfter)}`
}

function reconcileVisibleAudit(snapshot, auditSnapshot) {
  const eventsBySource = new Map()
  const latestAllocationBySource = new Map()
  if (!snapshot || !auditSnapshot) {
    return { status: 'inconsistent', eventsBySource, latestAllocationBySource }
  }

  const expectedVersionBySource = new Map()
  for (const row of snapshot.rows) {
    if (!Number.isSafeInteger(row.version) || row.version < 1) {
      return { status: 'inconsistent', eventsBySource: new Map(), latestAllocationBySource: new Map() }
    }
    const previousVersion = expectedVersionBySource.get(row.sourceKey)
    if (previousVersion !== undefined && previousVersion !== row.version) {
      return { status: 'inconsistent', eventsBySource: new Map(), latestAllocationBySource: new Map() }
    }
    expectedVersionBySource.set(row.sourceKey, row.version)
  }

  for (const event of auditSnapshot.events) {
    if (!expectedVersionBySource.has(event.sourceKey)) continue
    if (!Number.isSafeInteger(event.sequenceNo) || event.sequenceNo < 1) {
      return { status: 'inconsistent', eventsBySource: new Map(), latestAllocationBySource: new Map() }
    }
    const events = eventsBySource.get(event.sourceKey)
    if (events) events.push(event)
    else eventsBySource.set(event.sourceKey, [event])
  }

  for (const [sourceKey, version] of expectedVersionBySource) {
    const expectedMaximum = version - 1
    const events = eventsBySource.get(sourceKey) ?? []
    if (events.length !== expectedMaximum) {
      return { status: 'inconsistent', eventsBySource: new Map(), latestAllocationBySource: new Map() }
    }
    const sequences = new Set(events.map(({ sequenceNo }) => sequenceNo))
    if (sequences.size !== expectedMaximum) {
      return { status: 'inconsistent', eventsBySource: new Map(), latestAllocationBySource: new Map() }
    }
    for (let sequence = 1; sequence <= expectedMaximum; sequence += 1) {
      if (!sequences.has(sequence)) {
        return { status: 'inconsistent', eventsBySource: new Map(), latestAllocationBySource: new Map() }
      }
    }
    const orderedEvents = [...events].sort((left, right) =>
      left.sequenceNo - right.sequenceNo || left.createdAt.localeCompare(right.createdAt) ||
      left.eventType.localeCompare(right.eventType))
    eventsBySource.set(sourceKey, orderedEvents)
    for (const event of orderedEvents) {
      if (event.eventType === 'allocation' && Array.isArray(event.allocationsAfter)) {
        latestAllocationBySource.set(sourceKey, event)
      }
    }
  }

  return { status: 'ready', eventsBySource, latestAllocationBySource }
}

export default function ProjectCostLedgerSection({
  service,
  access,
  projects = [],
  initialSnapshot = null,
  initialAuditSnapshot = null,
  actorFingerprint = '',
  onAuthInvalid,
  onCreateManual,
  onAdjust,
  onAllocate,
  onExportExcel,
  onExportPdf,
  onPrint,
}) {
  const readAllowed = access?.readLedger ?? access?.view ?? false
  const [draftFilters, setDraftFilters] = useState(() => ({ ...DEFAULT_FILTERS }))
  const [appliedFilters, setAppliedFilters] = useState(() => ({ ...DEFAULT_FILTERS }))
  const [expandedRows, setExpandedRows] = useState(() => new Set())
  const [dialogState, setDialogState] = useState(null)
  const [actionHint, setActionHint] = useState('')
  const [projectTotal, setProjectTotal] = useState(() => initialSnapshot?.totalAmount ?? 0)
  const requestSequenceRef = useRef(0)
  const activeFingerprintRef = useRef(actorFingerprint)
  activeFingerprintRef.current = actorFingerprint
  const [ledgerState, setLedgerState] = useState(() => ({
    identity: actorFingerprint,
    status: !readAllowed ? 'forbidden' : initialSnapshot ? 'ready' : 'idle',
    data: readAllowed ? initialSnapshot : null,
    error: '',
  }))
  const [auditState, setAuditState] = useState(() => ({
    identity: actorFingerprint,
    filterIdentity: filterIdentity(DEFAULT_FILTERS),
    status: !readAllowed ? 'forbidden' : initialAuditSnapshot ? 'ready' : initialSnapshot ? 'error' : 'idle',
    data: readAllowed ? initialAuditSnapshot : null,
    error: initialSnapshot && !initialAuditSnapshot ? '项目成本审计记录暂时不可用' : '',
  }))

  const load = useCallback(async (filters, page, pageSize, { replaceApplied = false } = {}) => {
    if (!readAllowed || !service || typeof service.list !== 'function') return false
    const sequence = requestSequenceRef.current + 1
    requestSequenceRef.current = sequence
    const fingerprint = actorFingerprint
    const requestedFilterIdentity = filterIdentity(filters)
    setLedgerState((current) => ({
      identity: fingerprint, status: 'loading',
      data: current.identity === fingerprint ? current.data : null, error: '',
    }))
    setAuditState({
      identity: fingerprint, filterIdentity: requestedFilterIdentity,
      status: typeof service.listAudit === 'function' ? 'loading' : 'error', data: null,
      error: typeof service.listAudit === 'function' ? '' : '项目成本审计记录暂时不可用',
    })

    let listSucceeded = false
    let auditSucceeded = false
    let loadedSnapshot = null
    let loadedAuditSnapshot = null
    const listPromise = Promise.resolve().then(() => service.list(requestFilters(filters, page, pageSize))).then((snapshot) => {
      if (requestSequenceRef.current !== sequence || activeFingerprintRef.current !== fingerprint) return false
      setLedgerState({ identity: fingerprint, status: 'ready', data: snapshot, error: '' })
      if (replaceApplied) setAppliedFilters({ ...filters })
      if (isDefaultFilters(filters)) setProjectTotal(snapshot.totalAmount)
      loadedSnapshot = snapshot
      listSucceeded = true
      return true
    }).catch((error) => {
      if (requestSequenceRef.current !== sequence || activeFingerprintRef.current !== fingerprint) return false
      if (error?.authInvalid) onAuthInvalid?.()
      setLedgerState((current) => ({
        identity: fingerprint, status: 'error', data: current.identity === fingerprint ? current.data : null,
        error: '项目成本服务暂时不可用，请稍后重试',
      }))
      return false
    })

    const auditPromise = typeof service.listAudit === 'function'
      ? Promise.resolve().then(() => service.listAudit(auditRequestFilters(filters))).then((snapshot) => {
          if (requestSequenceRef.current !== sequence || activeFingerprintRef.current !== fingerprint) return false
          setAuditState({
            identity: fingerprint, filterIdentity: requestedFilterIdentity,
            status: 'ready', data: snapshot, error: '',
          })
          loadedAuditSnapshot = snapshot
          auditSucceeded = true
          return true
        }).catch((error) => {
          if (requestSequenceRef.current !== sequence || activeFingerprintRef.current !== fingerprint) return false
          if (error?.authInvalid) onAuthInvalid?.()
          setAuditState({
            identity: fingerprint, filterIdentity: requestedFilterIdentity,
            status: 'error', data: null, error: '项目成本审计记录暂时不可用，请稍后重试',
          })
          return false
        })
      : Promise.resolve(false)

    await Promise.all([listPromise, auditPromise])
    return listSucceeded && auditSucceeded &&
      reconcileVisibleAudit(loadedSnapshot, loadedAuditSnapshot).status === 'ready'
  }, [actorFingerprint, onAuthInvalid, readAllowed, service])

  useEffect(() => {
    const fingerprint = actorFingerprint
    setDraftFilters({ ...DEFAULT_FILTERS })
    setAppliedFilters({ ...DEFAULT_FILTERS })
    setExpandedRows(new Set())
    setDialogState(null)
    setActionHint('')

    if (!readAllowed) {
      requestSequenceRef.current += 1
      setLedgerState({ identity: fingerprint, status: 'forbidden', data: null, error: '' })
      setAuditState({
        identity: fingerprint, filterIdentity: filterIdentity(DEFAULT_FILTERS),
        status: 'forbidden', data: null, error: '',
      })
      return () => {
        requestSequenceRef.current += 1
      }
    }
    if (initialSnapshot) {
      requestSequenceRef.current += 1
      setProjectTotal(initialSnapshot.totalAmount)
      setLedgerState({ identity: fingerprint, status: 'ready', data: initialSnapshot, error: '' })
      setAuditState({
        identity: fingerprint, filterIdentity: filterIdentity(DEFAULT_FILTERS),
        status: initialAuditSnapshot ? 'ready' : 'error', data: initialAuditSnapshot,
        error: initialAuditSnapshot ? '' : '项目成本审计记录暂时不可用',
      })
      return () => {
        requestSequenceRef.current += 1
      }
    }
    if (!service || typeof service.list !== 'function') {
      requestSequenceRef.current += 1
      setLedgerState({
        identity: fingerprint, status: 'error', data: null,
        error: '项目成本服务暂时不可用，请稍后重试',
      })
      setAuditState({
        identity: fingerprint, filterIdentity: filterIdentity(DEFAULT_FILTERS),
        status: 'error', data: null, error: '项目成本审计记录暂时不可用',
      })
      return () => {
        requestSequenceRef.current += 1
      }
    }

    void load(DEFAULT_FILTERS, 1, 20, { replaceApplied: true })
    return () => {
      requestSequenceRef.current += 1
    }
  }, [actorFingerprint, initialAuditSnapshot, initialSnapshot, load, readAllowed, service])

  const visibleState = !readAllowed
    ? { status: 'forbidden', data: null, error: '' }
    : ledgerState.identity === actorFingerprint
      ? ledgerState
      : { status: 'idle', data: null, error: '' }
  const snapshot = visibleState.data
  const appliedFilterIdentity = filterIdentity(appliedFilters)
  const visibleAuditState = !readAllowed
    ? { status: 'forbidden', data: null, error: '' }
    : auditState.identity === actorFingerprint && auditState.filterIdentity === appliedFilterIdentity
      ? auditState
      : auditState.identity === actorFingerprint && visibleState.status === 'loading'
        ? { status: 'loading', data: null, error: '' }
        : { status: 'idle', data: null, error: '' }
  const auditIndex = useMemo(
    () => visibleAuditState.status === 'ready'
      ? reconcileVisibleAudit(snapshot, visibleAuditState.data)
      : { status: visibleAuditState.status, eventsBySource: new Map(), latestAllocationBySource: new Map() },
    [snapshot, visibleAuditState.data, visibleAuditState.status],
  )
  const auditStatus = auditIndex.status
  const filtersDirty = !sameFilters(draftFilters, appliedFilters)
  const reportBlocked = filtersDirty || !snapshot || visibleState.status === 'loading' ||
    snapshot.incompleteSources.length > 0 || auditStatus !== 'ready'
  const pageCount = snapshot ? Math.max(1, Math.ceil(snapshot.totalRows / snapshot.pageSize)) : 1
  const appliedLabel = useMemo(
    () => appliedFilterLabel(appliedFilters, projects),
    [appliedFilters, projects],
  )

  const runReportAction = (callback) => {
    if (reportBlocked || typeof callback !== 'function') return
    callback({ snapshot, auditSnapshot: visibleAuditState.data, filters: { ...appliedFilters } })
  }

  const updateDraft = (field, value) => {
    setDraftFilters((current) => ({ ...current, [field]: value }))
  }

  const handleApply = async () => {
    await load(draftFilters, 1, snapshot?.pageSize ?? 20, { replaceApplied: true })
  }

  const handleClear = async () => {
    const cleared = { ...DEFAULT_FILTERS }
    setDraftFilters(cleared)
    await load(cleared, 1, snapshot?.pageSize ?? 20, { replaceApplied: true })
  }

  const handlePageSize = async (value) => {
    await load(appliedFilters, 1, Number(value), { replaceApplied: false })
  }

  const handlePage = async (page) => {
    if (!snapshot || page < 1 || page > pageCount) return
    await load(appliedFilters, page, snapshot.pageSize, { replaceApplied: false })
  }

  const toggleExpanded = (rowKey) => {
    setExpandedRows((current) => {
      const next = new Set(current)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })
  }

  const openManualDialog = () => {
    if (!access?.createManual || typeof service?.createManual !== 'function') return
    setActionHint('')
    setDialogState({ type: 'manual' })
    onCreateManual?.()
  }

  const openAdjustmentDialog = (row) => {
    if (!access?.adjust || typeof service?.adjust !== 'function') return
    setActionHint('')
    setDialogState({ type: 'adjustment', sourceKey: row.sourceKey, projectId: row.projectId, row })
    onAdjust?.(row)
  }

  const openAllocationDialog = (row, allocations) => {
    if (!access?.allocate || typeof service?.replaceAllocations !== 'function' || auditStatus !== 'ready') return
    setActionHint('')
    setDialogState({ type: 'allocation', sourceKey: row.sourceKey, projectId: row.projectId, row, allocations })
    onAllocate?.(row)
  }

  const reloadMutationSnapshot = useCallback(async (target, { close = false } = {}) => {
    const loaded = await load(appliedFilters, snapshot?.page ?? 1, snapshot?.pageSize ?? 20)
    if (!loaded) return false
    if (target?.sourceKey) {
      setExpandedRows(new Set([`${target.sourceKey}:${target.projectId || ''}`]))
    }
    if (close) setDialogState(null)
    return true
  }, [appliedFilters, load, snapshot?.page, snapshot?.pageSize])

  const activeDialogRow = dialogState?.sourceKey
    ? snapshot?.rows.find((row) => row.sourceKey === dialogState.sourceKey && row.projectId === dialogState.projectId) ||
      snapshot?.rows.find((row) => row.sourceKey === dialogState.sourceKey) || dialogState.row
    : null
  const activeAllocationEvent = activeDialogRow
    ? auditIndex.latestAllocationBySource.get(activeDialogRow.sourceKey)
    : null

  return (
    <section className="project-cost-ledger" data-project-count={projects.length}>
      <div className="project-cost-ledger-actions" aria-label="项目成本操作">
        <div>
          <strong>统一项目成本明细账</strong>
          <span>原始业务记录保持不变，会计调整自动留痕</span>
        </div>
        <div className="project-cost-ledger-action-buttons">
          <button className="project-cost-ledger-primary" type="button" disabled={!access?.createManual || typeof service?.createManual !== 'function'} onClick={openManualDialog}>新增调整费用</button>
          <button type="button" disabled={!access?.allocate || typeof service?.replaceAllocations !== 'function' || !snapshot?.rows.length || auditStatus !== 'ready'} onClick={() => setActionHint('请在明细表的“操作”列选择要拆分的费用')}>拆分项目</button>
          <button type="button" disabled={reportBlocked || typeof onExportExcel !== 'function'} onClick={() => runReportAction(onExportExcel)}>导出 Excel</button>
          <button type="button" disabled={reportBlocked || typeof onExportPdf !== 'function'} onClick={() => runReportAction(onExportPdf)}>导出 PDF</button>
          <button type="button" disabled={reportBlocked || typeof onPrint !== 'function'} onClick={() => runReportAction(onPrint)}>打印</button>
        </div>
      </div>

      {actionHint && <div className="project-cost-ledger-state" role="status">{actionHint}</div>}

      <div className="project-cost-ledger-filters">
        <label>项目
          <select value={draftFilters.projectId} onChange={(event) => updateDraft('projectId', event.target.value)}>
            <option value="">全部项目</option>
            {projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}
          </select>
        </label>
        <label>开始日期<input type="date" value={draftFilters.dateFrom} onChange={(event) => updateDraft('dateFrom', event.target.value)} /></label>
        <label>结束日期<input type="date" value={draftFilters.dateTo} onChange={(event) => updateDraft('dateTo', event.target.value)} /></label>
        <label>费用类别
          <select value={draftFilters.category} onChange={(event) => updateDraft('category', event.target.value)}>
            <option value="">全部类别</option>
            {CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label>来源模块
          <select value={draftFilters.sourceModule} onChange={(event) => updateDraft('sourceModule', event.target.value)}>
            {SOURCE_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
          </select>
        </label>
        <label>调整状态
          <select value={draftFilters.adjusted} onChange={(event) => updateDraft('adjusted', event.target.value)}>
            <option value="all">全部记录</option><option value="adjusted">仅已调整</option><option value="unadjusted">仅未调整</option>
          </select>
        </label>
        <label className="project-cost-ledger-keyword">关键词搜索<input value={draftFilters.keyword} onChange={(event) => updateDraft('keyword', event.target.value)} placeholder="单号、说明" /></label>
        <div className="project-cost-ledger-filter-actions">
          <button className="project-cost-ledger-primary" type="button" disabled={!filtersDirty || visibleState.status === 'loading'} onClick={handleApply}>应用筛选</button>
          <button type="button" disabled={visibleState.status === 'loading'} onClick={handleClear}>清除筛选</button>
        </div>
        <div className="project-cost-ledger-snapshot-label">
          <span>当前报表：{appliedLabel}</span>
          {snapshot && <small>数据时间 {formatInstant(snapshot.generatedAt)}</small>}
          {filtersDirty && <strong>筛选条件有改动，尚未应用</strong>}
        </div>
      </div>

      {visibleState.status === 'idle' && <div className="project-cost-ledger-state">项目成本尚未读取</div>}
      {visibleState.status === 'forbidden' && <div className="project-cost-ledger-state">无权读取项目成本</div>}
      {visibleState.status === 'loading' && <div className="project-cost-ledger-state" role="status">正在读取项目成本…</div>}
      {visibleState.status === 'error' && (
        <div className="project-cost-ledger-alert" role="alert">
          <span>项目成本读取失败：{visibleState.error}</span>
          <button type="button" onClick={() => load(appliedFilters, snapshot?.page ?? 1, snapshot?.pageSize ?? 20)}>重新读取</button>
        </div>
      )}
      {snapshot && visibleAuditState.status === 'loading' && (
        <div className="project-cost-ledger-state" role="status">正在读取项目成本审计…</div>
      )}
      {snapshot && ['idle', 'error'].includes(visibleAuditState.status) && (
        <div className="project-cost-ledger-alert" role="alert">
          <div><strong>审计记录读取失败，拆分状态暂不可确认</strong><span>{visibleAuditState.error || '请重新读取当前报表'}</span></div>
          <button type="button" disabled={visibleState.status === 'loading'} onClick={() => load(appliedFilters, snapshot.page, snapshot.pageSize)}>重新读取审计</button>
        </div>
      )}
      {snapshot && auditStatus === 'inconsistent' && (
        <div className="project-cost-ledger-alert" role="alert">
          <div><strong>审计版本与明细账不一致，拆分状态暂不可确认</strong><span>数据可能正在更新，请重新读取后再导出或打印</span></div>
          <button type="button" disabled={visibleState.status === 'loading'} onClick={() => load(appliedFilters, snapshot.page, snapshot.pageSize)}>重新读取审计</button>
        </div>
      )}

      {snapshot && snapshot.incompleteSources.length > 0 && (
        <div className="project-cost-ledger-alert" role="alert">
          <div><strong>数据不完整，当前报表不可导出或打印</strong><span>暂时不可用来源：{snapshot.incompleteSources.join('、')}</span></div>
          <button type="button" disabled={visibleState.status === 'loading'} onClick={() => load(appliedFilters, snapshot.page, snapshot.pageSize)}>重新读取</button>
        </div>
      )}

      {snapshot && (
        <>
          <div className="project-cost-ledger-summary">
            <article><span>项目总成本</span><strong>{formatYen(projectTotal)}</strong><small>全部项目有效费用</small></article>
            <article><span>当前筛选成本</span><strong>{formatYen(snapshot.totalAmount)}</strong><small>{appliedLabel}</small></article>
            <article><span>会计净调整</span><strong>{formatYen(snapshot.adjustmentTotal)}</strong><small>只保留会计调整值</small></article>
            <article><span>记录数量</span><strong>{snapshot.totalRows}</strong><small>符合当前已应用筛选</small></article>
          </div>

          <div className="project-cost-ledger-categories" aria-label="费用分类小计">
            {snapshot.categoryTotals.map((total) => (
              <article key={total.category}><span>{total.category}</span><strong>{formatYen(total.amount)}</strong></article>
            ))}
          </div>

          <div className="project-cost-ledger-table-scroll">
            <table className="project-cost-ledger-table">
              <thead><tr>
                {['日期', '费用类别', '来源', '业务单号', '费用说明', '原金额', '会计调整', '最终金额', '项目/拆分', '经办人', '调整标记', '操作'].map((column) => <th key={column}>{column}</th>)}
              </tr></thead>
              <tbody>
                {snapshot.rows.map((row, index) => {
                  const rowKey = `${row.sourceKey}:${row.projectId}`
                  const expanded = expandedRows.has(rowKey)
                  const categoryStart = index === 0 || snapshot.rows[index - 1].category !== row.category
                  const sourceAuditEvents = auditIndex.eventsBySource.get(row.sourceKey) ?? []
                  const latestAllocationEvent = auditIndex.latestAllocationBySource.get(row.sourceKey)
                  const fullAllocations = latestAllocationEvent?.allocationsAfter ?? null
                  const isSplit = auditStatus === 'ready' && fullAllocations?.length > 1
                  return (
                    <Fragment key={rowKey}>
                      <tr className={categoryStart ? 'project-cost-ledger-category-start' : ''}>
                        <td>{row.date}</td><td>{row.category}</td><td>{SOURCE_LABELS[row.sourceModule] || row.sourceModule}</td>
                        <td>{row.sourceDocumentId}</td><td className="project-cost-ledger-description">{row.description || '—'}</td>
                        <td className="project-cost-ledger-amount">{formatYen(row.originalAmount)}</td>
                        <td className="project-cost-ledger-amount">{formatYen(row.adjustmentAmount)}</td>
                        <td className="project-cost-ledger-amount project-cost-ledger-effective">{formatYen(row.effectiveAmount)}</td>
                        <td>{auditStatus !== 'ready'
                          ? '拆分状态待读取'
                          : isSplit
                            ? `已拆分（${fullAllocations.length}个项目）`
                            : row.projectName || projectName(projects, row.projectId)}</td>
                        <td>{row.operator || '—'}</td><td>{row.adjusted ? <span className="project-cost-ledger-adjusted">已调整</span> : '原始'}</td>
                        <td><div className="project-cost-ledger-row-actions">
                          <button type="button" onClick={() => toggleExpanded(rowKey)}>{expanded ? '收起' : '展开'}</button>
                          <button type="button" disabled={!access?.adjust || typeof service?.adjust !== 'function'} onClick={() => openAdjustmentDialog(row)}>调整</button>
                          <button type="button" disabled={!access?.allocate || typeof service?.replaceAllocations !== 'function' || auditStatus !== 'ready'} onClick={() => openAllocationDialog(row, fullAllocations ?? row.allocations)}>拆分</button>
                        </div></td>
                      </tr>
                      {expanded && <tr className="project-cost-ledger-detail-row"><td colSpan="12">
                        <div className="project-cost-ledger-detail-grid">
                          <section><h3>来源详情</h3><dl>
                            <div><dt>来源键</dt><dd>{row.sourceKey}</dd></div><div><dt>单据类型</dt><dd>{row.sourceDocumentType}</dd></div>
                            <div><dt>版本</dt><dd>{row.version}</dd></div>
                          </dl></section>
                          <section><h3>项目分摊</h3>{auditStatus !== 'ready'
                            ? <p>审计记录暂不可用，无法确认完整分摊</p>
                            : (fullAllocations ?? row.allocations).map((allocation) => <div className="project-cost-ledger-allocation" key={allocation.projectId}><span>{projectName(projects, allocation.projectId)}</span><strong>{formatYen(allocation.amount)}</strong></div>)}</section>
                          <section><h3>自动审计记录</h3>{auditStatus !== 'ready'
                            ? <p>审计记录暂不可用</p>
                            : sourceAuditEvents.length === 0
                              ? <p>暂无会计调整</p>
                              : <ol>{sourceAuditEvents.map((event, eventIndex) => <li key={`${event.sequenceNo ?? eventIndex}:${event.createdAt ?? ''}:${event.eventType ?? ''}`}><strong>{auditDescription(event)}</strong><span>{event.reason || '—'}｜{event.actorName || '—'}｜{formatInstant(event.createdAt)}</span></li>)}</ol>}</section>
                        </div>
                      </td></tr>}
                    </Fragment>
                  )
                })}
                {snapshot.rows.length === 0 && <tr><td className="project-cost-ledger-empty" colSpan="12">当前筛选条件下暂无项目成本记录</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="project-cost-ledger-pagination">
            <label>每页显示<select value={snapshot.pageSize} disabled={visibleState.status === 'loading'} onChange={(event) => handlePageSize(event.target.value)}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
            <span>第 {snapshot.page} / {pageCount} 页，共 {snapshot.totalRows} 条</span>
            <div><button type="button" disabled={visibleState.status === 'loading' || snapshot.page <= 1} onClick={() => handlePage(snapshot.page - 1)}>上一页</button><button type="button" disabled={visibleState.status === 'loading' || snapshot.page >= pageCount} onClick={() => handlePage(snapshot.page + 1)}>下一页</button></div>
          </div>
        </>
      )}

      {dialogState?.type === 'adjustment' && <ProjectCostAdjustmentDialog
        row={activeDialogRow}
        allowed={Boolean(access?.adjust)}
        onSubmit={(request) => service.adjust(request)}
        onRefresh={(target) => reloadMutationSnapshot(target)}
        onSuccess={(result, target) => reloadMutationSnapshot(target, { close: true })}
        onCancel={() => setDialogState(null)}
        onAuthInvalid={onAuthInvalid}
      />}
      {dialogState?.type === 'allocation' && <ProjectCostAllocationDialog
        row={activeDialogRow}
        projects={projects}
        allocations={activeAllocationEvent?.allocationsAfter ?? dialogState.allocations}
        allowed={Boolean(access?.allocate)}
        onSubmit={(request) => service.replaceAllocations(request)}
        onRefresh={(target) => reloadMutationSnapshot(target)}
        onSuccess={(result, target) => reloadMutationSnapshot(target, { close: true })}
        onCancel={() => setDialogState(null)}
        onAuthInvalid={onAuthInvalid}
      />}
      {dialogState?.type === 'manual' && <ProjectCostManualEntryDialog
        open
        projects={projects}
        allowed={Boolean(access?.createManual)}
        onSubmit={({ requestId, ...entry }) => service.createManual({ requestId, entry })}
        onSuccess={(result, target) => reloadMutationSnapshot(target, { close: true })}
        onCancel={() => setDialogState(null)}
        onAuthInvalid={onAuthInvalid}
      />}
    </section>
  )
}
