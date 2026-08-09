# Project Address Auto-Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically locate the most likely Japanese project address after typing pauses, while preserving explicit retry and manual map correction.

**Architecture:** A small timer scheduler owns debounce and cancellation without knowing React or Leaflet. `ProjectLocationPicker` reuses its existing stale-request and abort protections for both scheduled and button-triggered lookup, and keeps the provider display name only in transient form UI.

**Tech Stack:** React 19, Vite 6, Leaflet 1.9.4, Nominatim adapter, Node `node:test`

## Global Constraints

- Modify only `/Users/yu/Documents/kaobeierp/warehouse-forward-port`; never touch the archived first version.
- Automatic lookup begins about 1200 ms after a non-empty address stops changing.
- Keep the existing “地址定位” button, map click, and draggable marker.
- Only the latest address may update the map; manual selection cancels scheduled or in-flight lookup.
- A failed lookup must not move or clear the existing coordinates.
- Use Japan GSI address search first and Nominatim only as fallback; show the best-match full address for review, but do not add a database field.
- Do not change warehouse functions, database schema, local business data, remote data, or online deployment.
- Add no third-party dependency.

---

## File map

- Create `src/features/projects/projectAddressAutoLocate.js`: framework-independent cancelable debounce scheduler.
- Create `src/features/projects/projectAddressAutoLocate.test.js`: real scheduler behavior with deterministic fake timers.
- Modify `src/features/projects/ProjectLocationPicker.jsx`: connect address changes, explicit retry, stale-request protection, and resolved-address display.
- Modify `src/features/projects/projectLocationService.js`: add a Japan GSI primary adapter with Nominatim fallback.
- Modify `src/features/projects/projectLocationService.test.js`: verify GSI coordinate order, exact request shape, and fallback behavior.
- Modify `src/features/projects/projectLocationPickerContract.test.js`: preserve the component's integration and safe-copy contract.
- Modify `src/styles.css`: style the transient resolved-address line consistently with the current black/gold project form.

### Task 1: Cancelable automatic-location scheduler

**Files:**
- Create: `src/features/projects/projectAddressAutoLocate.js`
- Create: `src/features/projects/projectAddressAutoLocate.test.js`

**Interfaces:**
- Produces: `PROJECT_ADDRESS_AUTO_LOCATE_DELAY_MS` with value `1200`.
- Produces: `createProjectAddressAutoLocateScheduler({ delayMs, setTimer, clearTimer })` returning frozen `{ schedule(task), cancel() }`.
- `schedule(task)` replaces an earlier pending task and runs only the latest task after `delayMs`.
- `cancel()` prevents a pending task from running and is safe when no task exists.

- [ ] **Step 1: Write the failing scheduler tests**

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PROJECT_ADDRESS_AUTO_LOCATE_DELAY_MS,
  createProjectAddressAutoLocateScheduler,
} from './projectAddressAutoLocate.js'

function fakeTimers() {
  let nextId = 0
  const tasks = new Map()
  return {
    tasks,
    setTimer(task, delay) {
      nextId += 1
      tasks.set(nextId, { task, delay })
      return nextId
    },
    clearTimer(id) { tasks.delete(id) },
    runAll() {
      const pending = [...tasks.values()]
      tasks.clear()
      for (const entry of pending) entry.task()
    },
  }
}

test('only the last scheduled address lookup runs after 1200 ms', () => {
  const timers = fakeTimers()
  const calls = []
  const scheduler = createProjectAddressAutoLocateScheduler(timers)
  scheduler.schedule(() => calls.push('旧地址'))
  scheduler.schedule(() => calls.push('最新地址'))
  assert.deepEqual([...timers.tasks.values()].map(({ delay }) => delay), [
    PROJECT_ADDRESS_AUTO_LOCATE_DELAY_MS,
  ])
  timers.runAll()
  assert.deepEqual(calls, ['最新地址'])
})

test('cancel prevents a scheduled address lookup', () => {
  const timers = fakeTimers()
  let calls = 0
  const scheduler = createProjectAddressAutoLocateScheduler(timers)
  scheduler.schedule(() => { calls += 1 })
  scheduler.cancel()
  timers.runAll()
  assert.equal(calls, 0)
})
```

- [ ] **Step 2: Run the scheduler test and verify RED**

Run: `node --test src/features/projects/projectAddressAutoLocate.test.js`

Expected: FAIL because `projectAddressAutoLocate.js` does not exist.

- [ ] **Step 3: Implement the minimal scheduler**

```js
export const PROJECT_ADDRESS_AUTO_LOCATE_DELAY_MS = 1200

export function createProjectAddressAutoLocateScheduler({
  delayMs = PROJECT_ADDRESS_AUTO_LOCATE_DELAY_MS,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  let timerId = null

  function cancel() {
    if (timerId === null) return
    clearTimer(timerId)
    timerId = null
  }

  function schedule(task) {
    cancel()
    timerId = setTimer(() => {
      timerId = null
      task()
    }, delayMs)
  }

  return Object.freeze({ schedule, cancel })
}
```

- [ ] **Step 4: Run the scheduler test and verify GREEN**

Run: `node --test src/features/projects/projectAddressAutoLocate.test.js`

Expected: 2 tests pass, 0 fail.

- [ ] **Step 5: Commit the scheduler**

```bash
git add src/features/projects/projectAddressAutoLocate.js src/features/projects/projectAddressAutoLocate.test.js
git commit -m "test: add project address auto-location scheduler"
```

### Task 2: Connect automatic lookup to the Leaflet picker

**Files:**
- Modify: `src/features/projects/projectLocationPickerContract.test.js`
- Modify: `src/features/projects/ProjectLocationPicker.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `createProjectAddressAutoLocateScheduler()` from Task 1.
- Consumes: existing `normalizeGeocodingAddress(address)` and `locateAddress(address, { signal })`.
- Preserves: `onLocationConfirmed({ latitude, longitude, confirmedAt })` as the only coordinate callback.
- Adds transient UI state `resolvedDisplayName`; it never enters the project payload.

- [ ] **Step 1: Add failing integration contract assertions**

Extend `projectLocationPickerContract.test.js` so it requires the component to:

```js
assert.match(source, /createProjectAddressAutoLocateScheduler/)
assert.match(source, /normalizeGeocodingAddress\(address\)/)
assert.match(source, /autoLocateSchedulerRef\.current\.schedule/)
assert.match(source, /autoLocateSchedulerRef\.current\.cancel/)
assert.match(source, /识别地址：/)
assert.match(source, /result\.displayName/)
assert.match(source, /未自动识别精确地址/)
assert.match(source, /map\.on\(['"]click['"]/)
assert.match(source, /marker\.on\(['"]dragend['"]/)
```

The break caught is removal of automatic scheduling, normalization, cancellation, review copy, or the existing manual fallbacks from the real picker integration.

- [ ] **Step 2: Run the picker contract test and verify RED**

Run: `node --test src/features/projects/projectLocationPickerContract.test.js`

Expected: FAIL because the picker does not import or schedule the automatic locator and does not render “识别地址”.

- [ ] **Step 3: Implement the minimal React integration**

In `ProjectLocationPicker.jsx`:

1. Import `normalizeGeocodingAddress` with `GeocodingError` and import `createProjectAddressAutoLocateScheduler`.
2. Create one scheduler in a ref and cancel it inside `cancelPendingLocate` and component cleanup.
3. Convert `handleLocate` to `useCallback`; at its start cancel any scheduled timer, clear old resolved display text, and then reuse the existing AbortController/request-id/current-input checks.
4. In the existing address-change effect, clear errors and resolved text, cancel old work, and call `schedule(() => handleLocate())` only when `normalizeGeocodingAddress(address)` is non-empty.
5. On a valid result, set `resolvedDisplayName` from a trimmed `result.displayName`, then call the existing `confirmCoordinates(..., { center: true })`.
6. On map click or marker drag, clear `resolvedDisplayName` because the manual point no longer claims to be the provider's exact result.
7. Render `识别地址：{resolvedDisplayName}` below the coordinate line only when a value exists.

The success branch must retain this shape:

```js
const displayName = typeof result?.displayName === 'string'
  ? result.displayName.trim()
  : ''
setResolvedDisplayName(displayName)
confirmCoordinates(selection.latitude, selection.longitude, { center: true })
```

The address-change branch must retain this behavior:

```js
cancelPendingLocate()
setLocateError('')
setResolvedDisplayName('')
if (normalizeGeocodingAddress(address)) {
  autoLocateSchedulerRef.current.schedule(() => handleLocate())
}
```

In `src/styles.css`, add `.project-location-resolved-address` to the existing status/error/coordinates typography group and give it the current muted-gold readable color; do not change layout dimensions.

- [ ] **Step 4: Run focused project tests and verify GREEN**

Run:

```bash
node --test \
  src/features/projects/projectAddressAutoLocate.test.js \
  src/features/projects/projectLocationPickerContract.test.js \
  src/features/projects/projectLocationService.test.js \
  src/features/projects/projectDomain.test.js \
  src/features/projects/projectPageContract.test.js
```

Expected: all focused tests pass, 0 fail.

- [ ] **Step 5: Commit the picker integration**

```bash
git add src/features/projects/ProjectLocationPicker.jsx src/features/projects/projectLocationPickerContract.test.js src/styles.css
git commit -m "feat: auto-locate project addresses"
```

### Task 3: Full verification and local acceptance

**Files:**
- No production file changes expected.
- Update this plan's checkboxes only if execution tracking is desired.

**Interfaces:**
- Consumes the complete feature from Tasks 1-2.
- Produces fresh verification evidence; it performs no deployment.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`

Expected: exit 0 and zero failed tests.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: exit 0 with Vite build output and no compile error.

- [ ] **Step 3: Check repository scope**

Run: `git status --short && git diff fd91930..HEAD --check && git diff fd91930..HEAD --stat`

Expected: no uncommitted files, no whitespace errors, and changes limited to the five files in this plan plus the committed spec/plan documents.

- [ ] **Step 4: Verify the local second-version page**

At `http://127.0.0.1:5174/`, sign in with the preserved local acceptance account and verify:

1. Enter a complete Japanese address and stop typing; after about 1.2 seconds the map centers and shows a marker.
2. The UI displays the returned complete “识别地址”.
3. Change the address rapidly; only the latest address result is shown.
4. Click “地址定位” to retry immediately.
5. Click the map and drag the marker; the manual point remains selected and old automatic results do not overwrite it.
6. Simulate or observe a failed lookup; the existing coordinates remain and the safe retry/manual-location message appears.
7. Confirm no online deployment or remote-data mutation occurred.

- [ ] **Step 5: Record the verification result**

Report exact focused-test, full-test, build, browser-console, and repository-status evidence. If any check fails, report the actual failure and return to the smallest failing TDD step instead of claiming completion.
