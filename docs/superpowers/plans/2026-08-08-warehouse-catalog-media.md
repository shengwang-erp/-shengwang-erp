# Warehouse Catalog, Media, and QR Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Use superpowers:test-driven-development for every task and preserve the Phase 1 contracts.

**Goal:** Deliver secure item/variant/location management, multiple private photos, system/manufacturer QR handling, scanning, and printable labels in the second-version style.

**Architecture:** Catalog mutations are validated server-side and authorized by `warehouse.catalog.manage`. Photos live in a private Supabase Storage bucket with database metadata; QR values map to stable variant ids. Heavy scan/export dependencies stay behind lazy imports.

**Tech Stack:** React 19, Supabase Storage/RPC, QRCode, ZXing Browser, Node tests.

---

### Task 1: Install only the warehouse client dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/features/warehouse/warehouseLazyLoading.test.js`

- [ ] Write a failing source contract proving QR generation, scanning, and spreadsheet code are reachable only through `lazy()` or dynamic `import()` from the warehouse route.
- [ ] Install `@zxing/browser@^0.2.1`, `exceljs@^4.4.0`, and `qrcode@^1.5.4` with `npm install`.
- [ ] Confirm no package is added for PDF generation; browser print-to-PDF is the supported PDF path.
- [ ] Run `node --test src/features/warehouse/warehouseLazyLoading.test.js` and `npm run build`; record main and warehouse chunk sizes in the phase commit message.
- [ ] Commit with message `build: add lazy warehouse media dependencies`.

### Task 2: Implement authorized catalog and location mutations

**Files:**
- Create: `supabase/migrations/202608080003_warehouse_catalog_media.sql`
- Create: `supabase/tests/warehouse_catalog_media.sql`
- Modify: `src/services/warehouseService.js`
- Modify: `src/services/warehouseService.test.js`
- Create: `src/features/warehouse/warehouseCatalogPersistence.js`
- Create: `src/features/warehouse/warehouseCatalogPersistence.test.js`

- [ ] Write failing tests for create/update/deactivate site, shelf, item, and variant; duplicate SKU/manufacturer QR; reserved `SWERP:VARIANT:` manufacturer QR; invalid quantity/price; requester without catalog permission; inactive user; and id mismatch.
- [ ] Add RPCs `upsert_warehouse_site_secure`, `upsert_warehouse_location_secure`, `upsert_warehouse_item_secure`, and `upsert_warehouse_variant_secure`. Resolve the actor server-side, require `warehouse.catalog.manage`, validate exact JSON fields, and audit before/after identifiers without sensitive blobs.
- [ ] Generate `system_qr` as `SWERP:VARIANT:<variant-id>` in Postgres, never from browser input. Normalize manufacturer QR with Unicode trim and case-insensitive uniqueness.
- [ ] Prevent deactivation when a location has stock or a variant has pending warehouse documents; return stable Chinese-safe error codes through the service.
- [ ] Add service methods `saveSite`, `saveLocation`, `saveItem`, and `saveVariant`; validate exact response envelopes and never fall back to generic `baseRecordService`.
- [ ] Run `node --test src/services/warehouseService.test.js src/features/warehouse/warehouseCatalogPersistence.test.js`.
- [ ] Run `npx supabase db reset && npx supabase test db supabase/tests/warehouse_catalog_media.sql`.
- [ ] Commit with message `feat: add secure warehouse catalog mutations`.

### Task 3: Add private multiple-photo storage

**Files:**
- Extend: `supabase/migrations/202608080003_warehouse_catalog_media.sql`
- Extend: `supabase/tests/warehouse_catalog_media.sql`
- Create: `src/services/warehouseMediaService.js`
- Create: `src/services/warehouseMediaService.test.js`
- Adapt from source: `src/features/warehouse/warehouseMedia.js`
- Create/adapt: `src/features/warehouse/warehouseMedia.test.js`

- [ ] Add table `warehouse_variant_photos(id, variant_id, object_path, sort_order, mime_type, byte_size, created_by_employee_profile_id, created_at)` with unique `(variant_id, object_path)` and `(variant_id, sort_order)`.
- [ ] Create private bucket `warehouse-item-photos`; object paths must match `<variant-id>/<uuid>.<jpg|png|webp>` and cannot be supplied outside that variant prefix.
- [ ] Add policies/RPCs so active inventory viewers can obtain short-lived signed URLs, but only catalog managers can register/delete photo metadata and storage objects.
- [ ] Adapt client image validation/compression to accept JPEG, PNG, and WebP, maximum input 12 MB, maximum long edge 2000 px, and output target below 2 MB. Do not store data URLs in database or localStorage.
- [ ] Add service methods `uploadVariantPhoto`, `listVariantPhotos`, `reorderVariantPhotos`, and `deleteVariantPhoto`; if metadata registration fails after upload, delete the just-uploaded orphan.
- [ ] Test multiple photos, order changes, invalid MIME, oversized input, cross-variant path denial, unauthenticated signed URL denial, and orphan cleanup.
- [ ] Run `node --test src/services/warehouseMediaService.test.js src/features/warehouse/warehouseMedia.test.js`.
- [ ] Run the storage HTTP test added as `supabase/tests/warehouse_photo_storage_http.mjs` against the isolated local Supabase.
- [ ] Commit with message `feat: add private warehouse item photos`.

### Task 4: Add QR lookup, scan, and label printing

**Files:**
- Create/adapt: `src/features/warehouse/WarehouseQrScanner.jsx`
- Create/adapt: `src/features/warehouse/warehouseQrScanner.test.js`
- Modify: `src/features/warehouse/warehouseQr.js`
- Modify: `src/features/warehouse/warehouseQr.test.js`
- Create: `src/features/warehouse/WarehouseLabelSheet.jsx`
- Create: `src/features/warehouse/warehouseLabelSheet.test.js`
- Extend: `src/services/warehouseService.js`

- [ ] Write tests for system QR, manufacturer QR, manual scan entry, unknown QR, duplicate manufacturer QR, camera permission denial, cleanup of the camera reader on close/unmount, and printable label content.
- [ ] Add RPC `resolve_warehouse_qr_secure(p_code text)` that returns one active variant without cost fields and requires `module.inventory.view`.
- [ ] Dynamically import `@zxing/browser` only when the scan dialog opens; always stop controls and media tracks on success, close, error, and unmount.
- [ ] Dynamically import `qrcode` only when rendering/printing a label. Label includes company name, item name, variant model/size/material, SKU, unit, and system QR; optional location label includes warehouse/shelf text.
- [ ] Scope print CSS to `.warehouse-label-print-sheet` and a named `@page warehouse-label`; do not affect existing ERP print pages.
- [ ] Run the QR/scanner/label tests and `npm run build`.
- [ ] Commit with message `feat: add warehouse QR scan and labels`.

### Task 5: Build catalog UI in the second-version visual shell

**Files:**
- Create/adapt: `src/features/warehouse/WarehouseCatalog.jsx`
- Create: `src/features/warehouse/WarehouseCatalog.test.js`
- Create/adapt: `src/features/warehouse/warehouse.css`
- Create/adapt: `src/features/warehouse/warehouseVisualContract.test.js`
- Modify only warehouse route wiring later in Phase 4; do not modify `App.jsx` in this task.

- [ ] Render searchable item cards and a detail/editor panel with name, category, brand, description, active status, multiple variants, model, size, material, unit, SKU, minimum stock, default purchase price, manufacturer QR, system QR, and ordered photos.
- [ ] Hide all mutation controls unless `manageCatalog`; hide price/cost unless `viewCost`; keep scan and read-only details available to inventory viewers.
- [ ] Add warehouse/site/shelf management with types normal, project site, and shared tool. Project-site warehouses still support shelf zones but are not broken into extra sub-warehouses.
- [ ] Reuse second-version black/gold variables and existing button/table/form class patterns; keep every new selector under `.warehouse-management-page`.
- [ ] Add mobile tests for 720 px breakpoint, touch targets, stacked fields, image carousel, horizontal table containment, focus rings, and no global print/theme leakage.
- [ ] Run `node --test src/features/warehouse/WarehouseCatalog.test.js src/features/warehouse/warehouseVisualContract.test.js` and `npm run build`.
- [ ] Commit with message `feat: add second-version warehouse catalog UI`.

## Phase 2 completion gate

- [ ] Catalog and photo pgTAP/HTTP tests pass on a reset local Supabase.
- [ ] QR scanner stops all camera resources in tests.
- [ ] No data URL, public bucket, generic base-record mutation, or localStorage warehouse fallback exists.
- [ ] `npm test` and `npm run build` pass.
- [ ] Phase 1 tests remain green.

