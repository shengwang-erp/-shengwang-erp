import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'

import WarehouseOverview from './WarehouseOverview.jsx'
import './warehouse.css'

const WarehouseCatalog = lazy(() => import('./WarehouseCatalog.jsx'))
const WarehouseOperations = lazy(() => import('./WarehouseOperations.jsx'))
const WarehouseReports = lazy(() => import('./WarehouseReports.jsx'))

const EMPTY_SNAPSHOT = Object.freeze({
  catalog: Object.freeze({ items: Object.freeze([]), variants: Object.freeze([]) }),
  locations: Object.freeze({ sites: Object.freeze([]), locations: Object.freeze([]) }),
  balances: Object.freeze([]),
  receiptRows: Object.freeze([]),
  context: Object.freeze({
    stockOutRequests: Object.freeze([]),
    returnRequests: Object.freeze([]),
    minorWorkOrders: Object.freeze([]),
  }),
})

const TABS = Object.freeze([
  Object.freeze({ id: 'overview', label: '库存总览' }),
  Object.freeze({ id: 'catalog', label: '物品档案' }),
  Object.freeze({ id: 'operations', label: '出入库作业' }),
  Object.freeze({ id: 'stocktake', label: '月度盘点' }),
  Object.freeze({ id: 'reports', label: '报表打印' }),
])

export function isWarehousePreviewEnabled(isDevelopment, flag) {
  return isDevelopment === true && flag === 'true'
}

function loadError(error) {
  return error?.message || '仓库实时数据读取失败，请稍后重试'
}

export async function loadWarehouseSnapshot({
  access = {}, warehouseService, warehouseConfirmationService,
}) {
  if (
    typeof warehouseService?.listCatalog !== 'function' ||
    typeof warehouseService?.listLocations !== 'function' ||
    typeof warehouseService?.listBalances !== 'function' ||
    (access.confirmReceipt === true && typeof warehouseService?.listReport !== 'function') ||
    typeof warehouseConfirmationService?.listRequestContext !== 'function'
  ) throw new Error('仓库云端服务尚未配置')
  const [catalog, locations, balances, context, pendingReceipts] = await Promise.all([
    warehouseService.listCatalog(),
    warehouseService.listLocations(),
    warehouseService.listBalances({ page: 1, pageSize: 500 }),
    warehouseConfirmationService.listRequestContext(),
    access.confirmReceipt === true
      ? warehouseService.listReport('receipts', {
          status: 'pending', page: 1, pageSize: 500,
        })
      : Promise.resolve({ rows: [] }),
  ])
  return { catalog, locations, balances, context, receiptRows: pendingReceipts.rows }
}

export default function WarehouseManagementPage({
  access = {},
  currentUser = null,
  companyName = '生旺株式会社',
  warehouseService,
  warehouseConfirmationService,
  warehouseMediaService,
  initialSnapshot = null,
  onNavigate,
  onBack,
  onAuthInvalid,
  preview = isWarehousePreviewEnabled(
    import.meta.env.DEV,
    import.meta.env.VITE_WAREHOUSE_MIGRATION_PREVIEW,
  ),
}) {
  const [activeTab, setActiveTab] = useState('overview')
  const [snapshot, setSnapshot] = useState(initialSnapshot ?? EMPTY_SNAPSHOT)
  const [loading, setLoading] = useState(initialSnapshot === null)
  const [error, setError] = useState('')
  const [snapshotVersion, setSnapshotVersion] = useState(0)
  const requestSequence = useRef(0)

  const refresh = useCallback(async () => {
    if (access.page !== true) return
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    setLoading(true)
    setError('')
    try {
      const nextSnapshot = await loadWarehouseSnapshot({
        access, warehouseService, warehouseConfirmationService,
      })
      if (requestSequence.current !== sequence) return
      setSnapshot(nextSnapshot)
      setSnapshotVersion((value) => value + 1)
    } catch (nextError) {
      if (requestSequence.current !== sequence) return
      setError(loadError(nextError))
      if (nextError?.authInvalid) onAuthInvalid?.()
    } finally {
      if (requestSequence.current === sequence) setLoading(false)
    }
  }, [access.confirmReceipt, access.page, onAuthInvalid, warehouseConfirmationService, warehouseService])

  useEffect(() => {
    if (initialSnapshot === null) void refresh()
    return () => { requestSequence.current += 1 }
  }, [initialSnapshot, refresh])

  if (access.page !== true) {
    return <main className="warehouse-management-page"><p role="alert">当前账号没有仓库管理查看权限。</p></main>
  }

  return (
    <main className="warehouse-management-page">
      {preview && <div className="warehouse-preview-banner" role="status">第二版 + 仓库移植测试</div>}
      <header className="warehouse-management-header">
        <div><p>生旺 ERP · WAREHOUSE</p><h1>仓库管理</h1><span>物品档案、库存、调拨、月度盘点与报表统一管理</span></div>
        <div className="warehouse-management-header-actions">
          <button type="button" onClick={() => void refresh()} disabled={loading}>刷新实时数据</button>
          {onBack && <button type="button" className="ghost-button" onClick={onBack}>返回首页</button>}
        </div>
      </header>
      {loading && <p className="warehouse-operation-message" role="status">正在读取仓库实时数据…</p>}
      {error && <div className="warehouse-operation-message is-error" role="alert">{error}<button type="button" onClick={() => void refresh()}>重试</button></div>}
      <nav className="warehouse-tabs" role="tablist" aria-label="仓库管理功能">
        {TABS.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'is-active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
      </nav>
      <section className="warehouse-tab-panel" role="tabpanel">
        {activeTab === 'overview' && <WarehouseOverview snapshot={snapshot} viewCost={access.viewCost === true} />}
        <Suspense fallback={<p role="status">正在载入仓库功能…</p>}>
          {activeTab === 'catalog' && <WarehouseCatalog key={`catalog:${snapshotVersion}`} warehouseService={warehouseService} warehouseMediaService={warehouseMediaService} initialCatalog={snapshot.catalog} initialLocations={snapshot.locations} manageCatalog={access.manageCatalog === true} viewCost={access.viewCost === true} companyName={companyName} onChanged={refresh} />}
          {activeTab === 'operations' && <WarehouseOperations mode="operations" snapshot={snapshot} access={access} warehouseConfirmationService={warehouseConfirmationService} onChanged={refresh} onNavigate={onNavigate} currentUser={currentUser} />}
          {activeTab === 'stocktake' && <WarehouseOperations mode="stocktake" snapshot={snapshot} access={access} warehouseConfirmationService={warehouseConfirmationService} onChanged={refresh} />}
          {activeTab === 'reports' && <WarehouseReports warehouseService={warehouseService} canExport={access.exportReports === true} companyName={companyName} />}
        </Suspense>
      </section>
    </main>
  )
}
