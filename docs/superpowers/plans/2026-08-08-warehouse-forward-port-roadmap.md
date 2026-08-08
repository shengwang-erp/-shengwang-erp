# Warehouse Forward-Port Roadmap

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this roadmap one phase at a time. Before each implementation task, use superpowers:test-driven-development. Before claiming a phase complete, use superpowers:verification-before-completion.

**Goal:** Add the complete warehouse-management capability to the exact online second-version ERP base without importing first-version authentication, shell, persistence, or unrelated modules.

**Architecture:** Keep the exact uploaded source of production deployment `dpl_Dq9YrqRqTixNAubjzq4pFWJyp4QN` (created 2026-08-05 19:01:38 Asia/Tokyo), recovered and audited in Task 0, as the application base layered on the existing Git history. Commit `d5953c546996dc9af73326fbe21c36062dca46d0` is only the underlying incomplete Git reference, not the complete application baseline. Reuse only warehouse-owned pure domain rules and visual components from `07f478957b51f8393b4ad918de3329563fcdb601`; rebuild every authentication, permission, purchase, accounting, storage, and Supabase connection against the recovered second-version contracts. Inventory is authoritative only through server transactions and an immutable movement ledger.

**Tech Stack:** React 19, Vite 6, Supabase Auth/Postgres/Storage/RPC, Node test runner, pgTAP, ExcelJS, QRCode, ZXing Browser.

---

## Non-negotiable boundary

- [ ] Work only in `/Users/yu/Documents/kaobeierp/warehouse-forward-port` on branch `codex/warehouse-forward-port`.
- [ ] Treat `/Users/yu/Documents/亚马逊请求书/.worktrees/warehouse-management` as read-only warehouse reference.
- [ ] Never touch `/Users/yu/Desktop/ERP第一版备份/ERP` or archived GitHub repository `shengwang-erp/ERP`.
- [ ] Never merge or cherry-pick the source branch as a whole.
- [ ] Never copy source `App.jsx`, authentication, general persistence, page shell, personnel, project, purchase, accounting, attendance, or global CSS files.
- [ ] Never run a Vercel deploy or apply migrations to the online Supabase project during these four phases.
- [ ] Start warehouse tables empty; preserve existing employee and project rows.

## Phase order and gates

1. [Warehouse ledger foundation](./2026-08-08-warehouse-ledger-foundation.md)
   - Task 0 first recovers and audits the exact deployed second-version source; later tasks add pure warehouse rules, stable permissions, normalized warehouse schema, immutable ledger, and the read service.
   - Gate: foundation pgTAP, unit tests, second-version auth/permission regressions, and production build pass.
2. [Catalog, media, and QR](./2026-08-08-warehouse-catalog-media.md)
   - Item/variant/location master data, multiple photos, system/manufacturer QR, scan, label print.
   - Gate: catalog authorization, QR uniqueness, private photo access, UI contract, and build pass.
3. [Confirmation and cost integration](./2026-08-08-warehouse-confirmation-cost-integration.md)
   - Purchase arrival, confirmed stock-in, stock-out/return, FIFO, frozen cost, project cost, and minor work orders.
   - Gate: full two-price FIFO scenario, idempotency/concurrency/permission failures, return reversal, and accounting regression pass.
4. [Operations, reports, UI, and local acceptance](./2026-08-08-warehouse-operations-reports-ui.md)
   - Transfer, monthly stocktake, reversal, reports, print/Excel, second-version navigation/home/style, full local acceptance.
   - Gate: all tests, production build, old-code pollution scan, local Supabase business scenario, and user acceptance pass.

Do not begin a later phase while an earlier gate is red. A failing gate means fix or revert only that phase; it never authorizes changing the archived first version or the online environment.

## Stable cross-phase contracts

### Permission keys

`module.inventory.view` remains the top-level module gate. The following action keys are added to the second-version permission catalog and server allow-list:

```js
export const WAREHOUSE_PERMISSION_KEYS = Object.freeze({
  catalogManage: 'warehouse.catalog.manage',
  receiptSubmit: 'warehouse.receipt.submit',
  receiptConfirm: 'warehouse.receipt.confirm',
  stockFlowRequest: 'warehouse.stock_flow.request',
  stockFlowConfirm: 'warehouse.stock_flow.confirm',
  transferManage: 'warehouse.transfer.manage',
  stocktakeConfirm: 'warehouse.stocktake.confirm',
  costView: 'warehouse.cost.view',
  reportExport: 'warehouse.report.export',
})
```

`SW-000` remains the only frontend super-administrator bypass. Database operations still resolve the current active employee profile and check current grants; the browser never supplies an operator identity.

### Inventory and cost invariants

- Requests and arrivals are pending documents and never change quantity.
- Confirmations are one Postgres transaction with a unique idempotency key.
- Stock-in creates a priced batch; stock-out consumes oldest available batches first.
- Movement quantity, unit cost, project/destination snapshot, operator, and time are immutable.
- Editing a catalog price affects only later receipts, never existing batches or historical movements.
- A confirmed formal-project stock-out creates exactly one warehouse-managed project material-cost record; return or reversal creates an opposite record at the original frozen cost.
- Transfer changes locations but not company quantity or batch cost.
- Direct delete/update of movement rows is denied; corrections create reversal movements.

### Outbound destination types

```js
export const WAREHOUSE_DESTINATION_TYPES = Object.freeze({
  project: 'project',
  minorWorkOrder: 'minor_work_order',
  internalUse: 'internal_use',
})
```

A small job that is not a main project uses a lightweight `minor_work_order`; company consumption uses `internal_use`. Assigning a minor work order to a formal project later creates the project-cost posting from the frozen outbound total without rewriting the inventory movement.

The separate “未来社按月结算大项/小项目” feature stays in `docs/superpowers/handoffs/2026-08-06-miraisya-monthly-settlement-backlog.md` and is not implemented by this roadmap.

## Final local acceptance scenario

- [ ] Create one normal warehouse, shelf zones, one project-site warehouse, and one shared-tool location.
- [ ] Create an item with two variants, multiple photos, system QR, and one manufacturer QR.
- [ ] Receive the same variant in two batches at different prices; confirm each arrival once and verify a retry is a no-op.
- [ ] Submit a formal-project stock-out; confirm it; verify FIFO and frozen project material cost.
- [ ] Submit a minor-work-order stock-out and an internal-use stock-out; verify neither requires a fake project.
- [ ] Return part of the formal-project issue; verify original-cost inventory restoration and cost reduction.
- [ ] Transfer stock between locations; verify company quantity and cost remain unchanged.
- [ ] Complete the monthly stocktake with no-change, gain, loss, damaged, and scrapped examples.
- [ ] Reverse one eligible operation and verify opposite movements rather than deletion.
- [ ] Filter and print/export item, stock, receipt, issue, return, transfer, stocktake, low-stock, and ledger reports.
- [ ] Verify unauthorized, inactive, first-login-password-change, duplicate QR, insufficient stock, concurrent confirmation, and cross-warehouse requests fail closed.
- [ ] Run `npm test`, `npm run build`, `npx supabase test db`, and the pollution scan in Phase 4.
- [ ] Start the local preview on a dedicated port with the visible label `第二版 + 仓库移植测试` and obtain explicit user approval before planning any online release.
