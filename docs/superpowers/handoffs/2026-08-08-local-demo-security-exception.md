# User-approved local demo authentication exception

**Approved:** 2026-08-08 (Asia/Tokyo)

## Decision and scope

The fixed local demonstration login `SW-000` / `320086` is intentionally retained in `src/auth/AuthGate.jsx` at the user's explicit direction. This is a narrow development-only exception, not a production credential or an alternative production authentication path. The recovered baseline already uses the same demo-mode flag in `src/App.jsx` to keep local demonstration data flows offline; no other runtime file may use the credential or flag.

The exception is enabled only by the exact conjunction:

```js
import.meta.env.DEV && import.meta.env.VITE_LOCAL_DEMO_MODE === 'true'
```

The default is off. Values such as an unset flag, `false`, `1`, and `TRUE` remain fail-closed. The credential and demo user objects are also guarded by `import.meta.env.DEV` so that production dead-code elimination removes the credential even if the build process receives `VITE_LOCAL_DEMO_MODE=true`.

## Automated gates

- `src/auth/localDemoSecurity.test.js` renders the production component through Vite development transforms and proves the default-off/exact-opt-in behavior.
- The same test locks the authorization expression to `DEV && VITE_LOCAL_DEMO_MODE === 'true'`, proves the credential appears only in `AuthGate.jsx`, and proves the flag appears only in the two existing runtime files (`App.jsx` and `AuthGate.jsx`) so the exception cannot silently expand.
- `scripts/verify-local-demo-production-build.mjs` performs an isolated production build with the demo flag deliberately set to `true`, scans every emitted asset, and fails if either the fixed password or the flag name appears.
- `npm run verify:local-demo-security` exposes the production scan as a standalone release gate.

Any broader flag value, non-development enablement, additional demo identity, production fallback, persistence shortcut, credential reuse outside `AuthGate.jsx`, or flag reuse outside the existing `App.jsx`/`AuthGate.jsx` pair requires a new explicit user decision and corresponding failing tests first.
