# Current production deployment source baseline

**Recorded:** 2026-08-08 (Asia/Tokyo)

## Deployment identity and recovery method

- Production deployment: `dpl_Dq9YrqRqTixNAubjzq4pFWJyp4QN`
- Deployment created: 2026-08-05 19:01:38 (Asia/Tokyo)
- Underlying incomplete Git reference: `d5953c546996dc9af73326fbe21c36062dca46d0`
- Read-only recovered source supplied to Task 0: `/private/tmp/shengwang-deployment-source-dpl_Dq9YrqRqTixNAubjzq4pFWJyp4QN`
- Durable full file manifest: [`2026-08-08-deployed-second-version-source-manifest.json`](./2026-08-08-deployed-second-version-source-manifest.json)
- Recovery manifest timestamp: `2026-08-08T06:00:17.479Z`
- Recovery manifest SHA-256: `e326437ba23a2be495f47ce89184fe3942b8117c74568502522d4487405b0ad4`

The source directory was recovered from the files uploaded for the named production deployment before Task 0. Task 0 performed no network access, deployment, remote migration, or online data operation. It treated the directory as read-only, recomputed SHA-1 for every manifest entry, compared source and destination by content, and imported only missing or content-different paths. All 283 manifest entries matched their recorded SHA-1 content identifiers. The tracked durable manifest records every entry as `{path, sha1, bytes}`; the temporary recovery directory is historical evidence, not a continuing audit dependency.

The application baseline is this recovered deployment snapshot layered on the existing Git history. The Git commit `d5953c5` remains useful provenance, but is not the complete application baseline.

## Exclusions and accounting

- Manifest-listed relevant source/runtime files: 283
- Already content-identical in the integration worktree: 250
- Content-different and imported: 14
- Missing and imported: 19
- Total exact imports: 33
- No destination files were deleted.
- Excluded from import: `node_modules/`, `.vercel/`, build output, every `.env*`, and `DEPLOYMENT_SOURCE_MANIFEST.json`.
- The existing tracked, secret-free `.env.example` was preserved; SHA-256 after recovery: `ecb324b1f27b11218e083bc1a21d3991ca6acb7a881f39a4f3cac25e89c10ebe`.
- No secret or environment value is recorded here.
- The durable manifest contains exactly 283 entries, has SHA-256 `cfd5f9b3f26c8a07a06b81a3f53b438866c7395428d2927d74b46f86ef0370f3`, and contains no excluded or `.env*` path.

After the exact import, four recovered static test fixtures were intentionally corrected. `src/services/projectDocumentSchema.test.js` now asserts the recovered prototype migration's actual equivalent security semantics instead of stale DDL names. Three contract-revenue tests now assert the recovered service-authoritative state and permission-gated callbacks instead of the superseded local-persistence wiring. A later review fix also guarded the explicitly approved local demo credential data with `import.meta.env.DEV`, because a failing production-bundle test proved the recovered unconditional objects leaked the password into a programmatic production build; `package.json` gained only the standalone production security-gate command. Service code and the recovered migration remain byte-identical. Therefore 277/283 manifest paths remain byte-identical to recovered source and six paths have the documented deltas below.

### Intentional audited deviations after import

| Path | Recovered SHA-1 | Current SHA-1 | Corrected mismatch |
|---|---|---|---|
| `package.json` | `0ad2d0954ded4a73d6b119f15acbf02959f24b83` | `abfa9637e9b47b3329e5522cf3038e03468624fe` | adds only the standalone `verify:local-demo-security` script entry |
| `src/auth/AuthGate.jsx` | `99e0f6218958920bbb404fa0b6ea4922b2a49b00` | `8a8b198539adcd0feb017d4f7be69d6404405a26` | retains the approved development-only demo behavior while excluding its credential data from production bundles |
| `src/features/contract-revenue/contractChangesPage.test.js` | `2e232aba3f619fd73c97b79c982bed104e1c2d9e` | `7ef174d5a8219c389fb16d4da0d020187215fc3d` | asserts service-authoritative state and update-gated callbacks |
| `src/features/contract-revenue/customerReceiptsPage.test.js` | `80d593e70867107e07584e9923da03c7ee1f6a74` | `b48a009d83e474a37232218124991ff6bdffaba5` | asserts service-authoritative state and update-gated callbacks |
| `src/features/contract-revenue/paymentPlanPage.test.js` | `8d319b2ccfe0a995e47e61a2d750165a984296a9` | `f07236bcb3fcc1b2a09b0b378471372aa995e715` | asserts service-authoritative state and update-gated callback |
| `src/services/projectDocumentSchema.test.js` | `886862180a4ca721097f720a73c8d1c8d795a26b` | `1773293d7b0f10954fa80cce24aec8d1c8be9ce9` | asserts equivalent CHECK/trigger/revoke semantics instead of stale DDL names |

## Exact imported paths and recovered hashes

| Imported path | Recovered SHA-1 | Post-recovery state |
|---|---|---|
| `public/apple-touch-icon-152x152.png` | `9f329ffe9f410454091bf9a702a43550946bf634` | exact |
| `public/apple-touch-icon-167x167.png` | `d51c465bda536e9b779e3a09915406a5bf7794e8` | exact |
| `public/apple-touch-icon.png` | `0f11522924d997238ebf71f0f21acda54340b67c` | exact |
| `public/favicon-32x32.png` | `cc722917953e084b2b043abbeac86ffaf6f041c1` | exact |
| `public/manifest.webmanifest` | `b99df8b2d864bf79aa5cb98dae1a87c1b561ea35` | exact |
| `public/pwa-192x192.png` | `801a7d71b03530a519437f8c781e68ca0c8a2462` | exact |
| `public/pwa-512x512.png` | `c4eb2fe4ba86442eb629f86d496b9038641497e2` | exact |
| `docs/supabase-schema.md` | `3f8d6159f1071c5656a1d7ccb07bd1c96a4cbeff` | exact |
| `docs/superpowers/plans/2026-07-15-today-attendance-site-log.md` | `d7c80c21f8303aed9bbcd1f83dd34aa7d618301d` | exact |
| `docs/superpowers/plans/2026-07-19-production-auth-backup-deploy.md` | `263e94ffb7ef46f8b51fd37e846becd08b1b1ab3` | exact |
| `docs/superpowers/plans/2026-08-05-accounting-gold-text.md` | `0c37e1ff1d11bbe5cc13003290bf5d07c9bf3d8a` | exact |
| `docs/superpowers/specs/2026-08-05-accounting-gold-text-design.md` | `13360400e47b61079e175561e58ac61c9b10da04` | exact |
| `index.html` | `969b47f2b709f1f48b01ecd45dcec8cf1d909403` | exact |
| `local-session-seed.html` | `36195157d4105513e527d598c67cb98291d722b5` | exact |
| `src/auth/AuthGate.jsx` | `99e0f6218958920bbb404fa0b6ea4922b2a49b00` | security-hardened; current SHA-1 `8a8b198539adcd0feb017d4f7be69d6404405a26` |
| `src/blackGoldTheme.css` | `1bb99948f0a283700956d7cb6959787124cde3cf` | exact |
| `src/blackGoldTheme.test.js` | `28f5cc17ce9db1c17826a3e5aa2c3c3fe2420416` | exact |
| `src/features/employees/personnelPageContract.test.js` | `0cf39252f975285dd94592c08f64f4aae39f03db` | exact |
| `src/features/projects/ProjectLocationPicker.jsx` | `0387d737e1ae8280279e331aca08af11c40c075f` | exact |
| `src/features/projects/ProjectPage.jsx` | `fcd6dbd9a2a7570d0839d425d49c281f08175831` | exact |
| `src/features/projects/projectAppIntegration.test.js` | `b95699f6edc731dbd232424a8b762702bf434d41` | exact |
| `src/features/projects/projectLocationPickerContract.test.js` | `9c09ab3cf6325e87ffaa9927b39c76cb9ba24fd3` | exact |
| `src/features/projects/projectPageContract.test.js` | `ecd0e4771661d37b54cec485b0db1b402937de90` | exact |
| `src/homeScreenIcon.test.js` | `6b30172860f1ea102751485f0139ccd7dc8a7470` | exact |
| `src/services/projectDocumentSchema.test.js` | `886862180a4ca721097f720a73c8d1c8d795a26b` | fixture corrected; current SHA-1 `1773293d7b0f10954fa80cce24aec8d1c8be9ce9` |
| `src/styles.css` | `f0e881a2ceaba59be97a0cc2a8da9d8465994f58` | exact |
| `supabase/functions/employee-bootstrap-admin/handler.js` | `16b79a5a313bc95069f76cd58524c2fa0be37f56` | exact |
| `supabase/functions/employee-bootstrap-admin/handler.test.js` | `0497ec3c0269e5650d9c5e28a479f6312a36da5f` | exact |
| `supabase/migrations/202607150002_project_documents.sql` | `0dde3d51deaa32c25fc1656ff63ad6a5adf8e8a8` | exact |
| `supabase/tests/attendance_accounting.sql` | `a3cead6d486b41bda12328264faf1f11012ce2eb` | exact |
| `supabase/tests/project_documents.sql` | `cff8331099fce87b42d4848e1f42c716c15f35cc` | exact |
| `supabase/tests/purchase_accrual_access.sql` | `0705cafcef9b787b14bc78543d959bb4fe556aab` | exact |
| `supabase/tests/today_attendance.sql` | `6d831e6d07b95575d2413bdc3be7dbaf82c7af54` | exact |

## Approved local demo security exception

The recovered `AuthGate.jsx` includes the fixed `SW-000` local development login. The user explicitly directed that behavior and its hardcoded password be retained. Its approved scope, production exclusion rule, and automated non-expansion gates are recorded in [`2026-08-08-local-demo-security-exception.md`](./2026-08-08-local-demo-security-exception.md). This exception does not authorize a production fallback or any warehouse authentication shortcut.

## Safety boundary

This record does not authorize deployment or database work. Task 0 did not copy warehouse feature code, touch the read-only warehouse source, touch either prohibited old/dirty worktree, deploy Vercel, apply any remote Supabase migration, or write online data.
