import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEPARTMENT_OPTIONS,
  POSITION_OPTIONS,
} from '../../auth/employeeAuthDomain.js'
import {
  applyPermissionTemplateSnapshot,
  canSavePermissionTemplateDraft,
  clearPermissionTemplateSnapshot,
  createPermissionTemplateAsyncGuard,
  createPermissionTemplateEditorData,
  discardPermissionTemplateDraft,
  isPermissionTemplateDraftDirty,
  refreshAuthorizationAfterTemplateSave,
  selectPermissionTemplateSubject,
  togglePermissionTemplateDraft,
} from './permissionTemplateEditorState.js'
import * as permissionTemplateEditorState from './permissionTemplateEditorState.js'

const MODULE_KEY = 'module.projects.view'
const OTHER_MODULE_KEY = 'module.personnel.create'

function createSnapshot() {
  return {
    departments: Object.fromEntries(
      DEPARTMENT_OPTIONS.map((department, index) => [
        department,
        index === 0 ? [MODULE_KEY] : index === 1 ? [OTHER_MODULE_KEY] : [],
      ]),
    ),
    positions: Object.fromEntries(
      POSITION_OPTIONS.map((position, index) => [
        position,
        index === 0 ? [MODULE_KEY, OTHER_MODULE_KEY] : [],
      ]),
    ),
  }
}

test('tab keyboard navigation wraps and supports Home and End', () => {
  const resolve = permissionTemplateEditorState.resolvePermissionTemplateTabKey
  assert.equal(typeof resolve, 'function')

  assert.equal(resolve('ArrowRight', 0, 2), 1)
  assert.equal(resolve('ArrowDown', 1, 2), 0)
  assert.equal(resolve('ArrowLeft', 0, 2), 1)
  assert.equal(resolve('ArrowUp', 1, 2), 0)
  assert.equal(resolve('Home', 1, 2), 0)
  assert.equal(resolve('End', 0, 2), 1)
  assert.equal(resolve('Enter', 0, 2), null)
  assert.equal(resolve('ArrowRight', -1, 2), null)
  assert.equal(resolve('ArrowRight', 0, 0), null)
})

test('loading a snapshot binds the draft to the selected subject in one state transition', () => {
  const initial = createPermissionTemplateEditorData()
  const snapshot = createSnapshot()
  const loaded = applyPermissionTemplateSnapshot(initial, snapshot)

  assert.equal(loaded.subjectType, 'department')
  assert.equal(loaded.selectedSubject, DEPARTMENT_OPTIONS[0])
  assert.deepEqual(loaded.draft, {
    subjectType: 'department',
    subjectCode: DEPARTMENT_OPTIONS[0],
    permissionKeys: [MODULE_KEY],
  })
  assert.equal(isPermissionTemplateDraftDirty(loaded), false)
  assert.equal(
    canSavePermissionTemplateDraft(loaded, { loading: false, mutation: false }),
    false,
  )
  assert.equal(initial.templates, null)
})

test('switching department or position replaces the bound draft synchronously', () => {
  const loaded = applyPermissionTemplateSnapshot(
    createPermissionTemplateEditorData(),
    createSnapshot(),
  )

  const department = selectPermissionTemplateSubject(
    loaded,
    'department',
    DEPARTMENT_OPTIONS[1],
  )
  assert.deepEqual(department.draft, {
    subjectType: 'department',
    subjectCode: DEPARTMENT_OPTIONS[1],
    permissionKeys: [OTHER_MODULE_KEY],
  })
  assert.equal(isPermissionTemplateDraftDirty(department), false)

  const position = selectPermissionTemplateSubject(
    department,
    'position',
    POSITION_OPTIONS[0],
  )
  assert.deepEqual(position.draft, {
    subjectType: 'position',
    subjectCode: POSITION_OPTIONS[0],
    permissionKeys: [MODULE_KEY, OTHER_MODULE_KEY],
  })
  assert.equal(isPermissionTemplateDraftDirty(position), false)
})

test('only a dirty draft bound to the current subject can be saved', () => {
  const loaded = applyPermissionTemplateSnapshot(
    createPermissionTemplateEditorData(),
    createSnapshot(),
  )
  const changed = togglePermissionTemplateDraft(loaded, OTHER_MODULE_KEY)

  assert.equal(isPermissionTemplateDraftDirty(changed), true)
  assert.equal(
    canSavePermissionTemplateDraft(changed, {
      loading: false,
      mutation: false,
    }),
    true,
  )
  assert.equal(
    canSavePermissionTemplateDraft(changed, { loading: true, mutation: false }),
    false,
  )

  const mismatched = {
    ...changed,
    selectedSubject: DEPARTMENT_OPTIONS[1],
  }
  assert.equal(isPermissionTemplateDraftDirty(mismatched), false)
  assert.equal(
    canSavePermissionTemplateDraft(mismatched, {
      loading: false,
      mutation: false,
    }),
    false,
  )

  const discarded = discardPermissionTemplateDraft(changed)
  assert.deepEqual(discarded.draft.permissionKeys, [MODULE_KEY])
  assert.equal(isPermissionTemplateDraftDirty(discarded), false)
})

test('clearing a snapshot fails closed without carrying a previous subject draft', () => {
  const loaded = applyPermissionTemplateSnapshot(
    createPermissionTemplateEditorData(),
    createSnapshot(),
  )
  const changed = togglePermissionTemplateDraft(loaded, OTHER_MODULE_KEY)
  const cleared = clearPermissionTemplateSnapshot(changed)

  assert.equal(cleared.templates, null)
  assert.deepEqual(cleared.draft, {
    subjectType: 'department',
    subjectCode: DEPARTMENT_OPTIONS[0],
    permissionKeys: [],
  })
  assert.equal(isPermissionTemplateDraftDirty(cleared), false)
  assert.equal(
    canSavePermissionTemplateDraft(cleared, {
      loading: false,
      mutation: false,
    }),
    false,
  )
})

test('post-save authorization refresh falls back to invalidation when missing or rejected', async () => {
  const snapshot = createSnapshot()
  const refreshedEvents = []
  assert.equal(
    await refreshAuthorizationAfterTemplateSave({
      snapshot,
      onTemplatesChanged: (nextSnapshot) => {
        refreshedEvents.push(['refresh', nextSnapshot])
      },
      onAuthInvalid: () => {
        refreshedEvents.push(['invalidate'])
      },
    }),
    true,
  )
  assert.deepEqual(refreshedEvents, [['refresh', snapshot]])

  const missingEvents = []
  assert.equal(
    await refreshAuthorizationAfterTemplateSave({
      snapshot,
      onAuthInvalid: () => {
        missingEvents.push('invalidate')
      },
    }),
    false,
  )
  assert.deepEqual(missingEvents, ['invalidate'])

  const rejectedEvents = []
  assert.equal(
    await refreshAuthorizationAfterTemplateSave({
      snapshot,
      onTemplatesChanged: () => {
        rejectedEvents.push('refresh')
        throw new Error('supplier details must not escape')
      },
      onAuthInvalid: () => {
        rejectedEvents.push('invalidate')
        throw new Error('logout failure must not reopen the editor')
      },
    }),
    false,
  )
  assert.deepEqual(rejectedEvents, ['refresh', 'invalidate'])
})

test('async guard rejects stale reads, stale saves, and every result after unmount', () => {
  const guard = createPermissionTemplateAsyncGuard()
  guard.mount()

  const firstServiceGeneration = guard.beginServiceGeneration()
  const firstRead = guard.beginRead(firstServiceGeneration)
  const firstSave = guard.beginSave()
  assert.equal(guard.isCurrentRead(firstRead), true)
  assert.equal(guard.isCurrentSave(firstSave), true)

  const secondServiceGeneration = guard.beginServiceGeneration()
  assert.equal(guard.isCurrentRead(firstRead), false)
  assert.equal(guard.isCurrentSave(firstSave), false)

  const secondRead = guard.beginRead(secondServiceGeneration)
  const secondSave = guard.beginSave()
  assert.equal(guard.isCurrentRead(secondRead), true)
  assert.equal(guard.isCurrentSave(secondSave), true)

  guard.unmount()
  assert.equal(guard.isMounted(), false)
  assert.equal(guard.isCurrentRead(secondRead), false)
  assert.equal(guard.isCurrentSave(secondSave), false)
})
