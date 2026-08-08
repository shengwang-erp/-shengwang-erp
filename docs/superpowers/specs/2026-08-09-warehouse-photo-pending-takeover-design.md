# Warehouse Photo Pending Takeover Design

## Goal

Make pending registered-photo and orphan cleanup tickets recoverable after refresh, requester loss, or a lost finalize response without exposing Storage paths before authorization. A new active warehouse manager, president, or SW-000 administrator can take over only under the approved requester-availability and 30-minute rules.

## Authorization

Every pending-list, claim, cancel, finalize, and Storage-delete decision requires an active employee whose effective permissions include the exact `warehouse.catalog.manage` key. SW-000 continues to receive `all` through the existing central permission resolver. The central `private.employee_effective_permission_keys` mapping adds `warehouse.catalog.manage` to the existing fixed president permissions; no photo RPC or policy checks employee name, display text, Auth UUID, or employee number.

The current requester is immediately reclaimable when their effective permission resolver returns no `warehouse.catalog.manage`, including disabled, departed, deleted, first-login, or explicitly deauthorized accounts. If the current requester remains active and authorized, another manager can claim at the exact database-time boundary `assigned_at <= statement_timestamp() - interval '30 minutes'`.

## Outbox and Immutable History

The outbox retains the original requester separately from the current requester and records `assigned_at`, the database-trusted start of the current ticket lease. Initial creation sets both requester columns to the creator and sets `assigned_at` from the database.

Claiming another requester's pending deletion occurs under the variant-first lock order. The transaction rechecks eligibility, generates a new `deletion_id`, changes the current requester, and resets `assigned_at`. The old deletion ID ceases to identify an outbox or completion receipt and is permanently invalid. A private immutable takeover receipt records old/new deletion IDs, original/current/new requester identifiers, reason (`requester_unavailable` or `lease_expired`), and database timestamp. Registered-photo takeover also writes the fixed identifier-only `delete_taken_over` audit action; orphan takeover is represented by the immutable receipt because it has no photo ID.

Completion and cancellation receipts remain immutable. Storage policies consult only the current outbox requester, so an old requester loses delete visibility immediately when claim commits.

## RPC Contracts

`list_warehouse_photo_delete_candidates_secure()` returns a dense JSON array. Each object has exactly:

- `deletionId`
- `kind`
- `createdAt` (the current ticket's `assigned_at`)
- `originalRequesterLabel` (employee name only)

It never returns object path, photo ID, variant ID, employee number, profile UUID, Auth UUID, MIME data, byte size, or photo metadata. It includes the caller's own tickets and only those other tickets that the caller can claim at the statement's database time.

`claim_warehouse_photo_delete_secure(uuid)` accepts only a deletion ID. For the current requester it returns the existing complete exact ticket without mutation. For an eligible manager it performs the atomic takeover and returns a complete exact ticket with the new deletion ID. Ineligible, inactive, and unauthorized callers receive a stable safe error without any path or metadata.

The complete ticket remains exactly `deletionId, kind, photoId, variantId, objectPath, storageDeleted`. The RPC derives every field from locked database rows and Storage existence; callers do not supply variant, photo, or path bindings.

## Service Contract and Recovery Flow

The media service adds:

- `listPendingPhotoDeletes()` — validates and returns only the sanitized candidate array.
- `recoverPendingPhotoDelete(deletionId)` — claims/recovers the exact ticket by deletion ID and runs the existing exact Storage remove/finalize state machine.

Neither method lists photo metadata, creates signed URLs, or depends on a stale browser photo row. An orphan whose finalize response was lost can be recovered from its pending deletion ID. A registered object already removed from Storage can be recovered even when inventory listing or signing fails; `storageDeleted: true` skips the remove and proceeds directly to finalize.

Known explicit Storage failure invokes cancellation only for the current ticket. Ambiguous Storage results retain the pending ticket. A claim racing with the old requester serializes at the variant lock: either the old operation completes first and claim finds no pending ticket, or claim rotates the ID first and the old credential fails.

## Registration and Reordering

A registered pending deletion continues to block registration and reorder for its variant. An orphan pending deletion blocks registration only when the registration uses that exact object path. An orphan for another path does not block registration or reorder.

## Concurrency and Boundary Tests

Database tests cover:

- requester unavailable: immediate claim;
- active authorized requester before 30 minutes: hidden from candidate list and claim rejected;
- exact 30-minute boundary and older: visible and claimable;
- claim rotates deletion ID and resets `assigned_at`;
- old credential fails after takeover and Storage policy recognizes only the new requester;
- takeover versus old requester cancel and finalize;
- two simultaneous takeovers, exactly one winner;
- two simultaneous finalizes, one state transition with an idempotent exact retry;
- orphan pending does not block unrelated register/reorder;
- direct pending predicate calls return false for unauthorized/inactive actors;
- president and SW-000 obtain exact manage authorization through the central resolver.

The committed fail-closed launcher must create a fresh isolated project on explicit non-default ports, reset it, write and remotely prove a fresh nonce marker before fixtures, and reject mismatched or stale targets.

## Verification and Cleanup

Verification includes focused service tests, catalog/media pgTAP, real Storage HTTP, all concurrency cases, full Node tests, production build, combined warehouse pgTAP, full database pgTAP with known baseline failures separated, secret/pollution scans, and a clean worktree. The isolated Supabase containers, volumes, network, ports, and temporary workdir are removed before completion. No deployment or external network access is permitted.
