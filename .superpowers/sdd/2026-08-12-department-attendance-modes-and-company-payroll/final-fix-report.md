# Final fix wave report

Status: implementation and complete local verification are green; no push or deployment has been performed.

## Review findings

1. Real `general` SQL events now retain `not_applicable`. The labor DTO validates
   event result, distance, and radius against the enclosing attendance mode; the
   integration fixture no longer rewrites the result to `normal`. Project event
   validation does not reconstruct the server's accuracy-aware geofence decision
   from a DTO that intentionally omits `accuracyMeters`.
2. V2 clock-in/out and the administrator policy writer use the same employee
   advisory/row lock boundary and re-read the effective policy after the lock.
   New deterministic dblink tests cover project/general clock-in, active-session
   clock-out, and authorization before locks.
3. A server-owned append-only effective-date policy history and daily method
   snapshot have been added. Confirmed daily/monthly snapshots reject direct
   rewrites. Mixed months now aggregate daily effective policy; company personnel
   cost is rounded from company pay units over all pay units, while project cost
   only uses frozen project-day resolutions and allocations.
4. V1 reads expose a strict project-only compatibility projection. General and
   exempt old-client project mutations fail closed, while project accounts retain
   the legacy signatures and response shape. Runbooks now require a maintenance
   window and roll-forward instead of promising full old-frontend rollback.

## TDD evidence to date

RED evidence observed on the first fresh database run:

- V1 compatibility lost the legacy abnormal-reason contract.
- A no-resolution daily fact lookup raised `query returned no rows`.
- Direct employee cleanup conflicted with retained append-only policy history.
- Task5 socket dblink could not authenticate under the non-super local test role.
- A real accuracy-driven abnormal project event (`distanceMeters=190`,
  `radiusMeters=200`) was rejected because the client tried to infer the server's
  result without the omitted accuracy measurement.

GREEN evidence after fixes:

- Focused schema/DTO/report Node tests: 53 passed, 0 failed.
- V1 today-attendance plus department-policy pgTAP: 380 passed, 0 failed.
- Original accounting pgTAP: 246 passed, 0 failed.
- Location-review/company-payroll pgTAP in the named isolated container: 56
  assertions, 0 failed.
- Policy/clock dblink races in the named isolated container: 17 assertions, 0
  failed.
- Fresh migrations `202608120001` and `202608120002` apply successfully.
- Mixed-month pgTAP first failed 6 of 56 assertions, then passed 56 of 56 after
  daily aggregation and pay-unit allocation were implemented.
- Mixed DTO and leadership-report Node tests pass 45 of 45.
- Full Node suite: 1868 passed, 0 failed.
- Production Vite build: 532 modules transformed and build completed successfully;
  only the existing chunk-size advisory remains.
- Independent final review found no remaining Critical, Important, or actionable
  Minor findings after the accuracy-aware DTO regression was fixed.

All database commands above targeted the local project
`kaobeierp-department-attendance-task8`; no shared or production database was
modified.

## Completion boundary

All required local gates are green. Commit this coherent fix wave, but do not
push or deploy it from this task.
