import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { attendancePhotoStorage } from '../../services/attendancePhotoStorage.js'
import { attendanceService } from '../../services/attendanceService.js'
import ActiveAttendanceSession from './ActiveAttendanceSession.jsx'
import AttendanceLocationAction from './AttendanceLocationAction.jsx'
import AttendanceOutOfRangeDialog from './AttendanceOutOfRangeDialog.jsx'
import AttendanceProjectPicker from './AttendanceProjectPicker.jsx'
import AttendanceRecordViewer from './AttendanceRecordViewer.jsx'
import GeneralAttendanceSession from './GeneralAttendanceSession.jsx'
import { attendanceLocationService } from './attendanceLocationService.js'
import { resolveAttendanceExperience } from './attendancePolicy.js'
import {
  isAttendanceProjectEligible,
  normalizeAttendanceWorkPointInput,
} from './attendanceDomain.js'
import { validateAttendancePhotoFile } from './attendancePhotoDomain.js'
import {
  attendancePhotoUploadReducer,
  createAttendancePhotoUploadState,
} from './attendancePhotoUploadState.js'
import TodayAttendanceHistory from './TodayAttendanceHistory.jsx'
import './todayAttendance.css'

const EDITABLE_POINT_FIELDS = Object.freeze([
  'areaName',
  'workDescription',
  'completionNote',
])

const isNonBlankString = (value) =>
  typeof value === 'string' && Boolean(value.trim())

const safeErrorCode = (error, fallback) =>
  isNonBlankString(error?.code) ? error.code : fallback

function forwardAuthInvalid(error, onAuthInvalid) {
  if (error?.authInvalid !== true) return
  onAuthInvalid?.(error)
}

export function filterEligibleAttendanceProjects(projects) {
  return Array.isArray(projects)
    ? projects.filter(isAttendanceProjectEligible)
    : []
}

export function createTodayAttendanceSnapshotController({
  service,
  onSnapshot,
  onAuthInvalid,
} = {}) {
  let mounted = true
  let generation = 0
  let snapshot = { projects: [], selectedProjectId: '', today: null }

  const begin = () => {
    if (!mounted) return null
    generation += 1
    return generation
  }
  const isCurrent = (token) => mounted && token === generation
  const accept = (token, nextSnapshot) => {
    if (!isCurrent(token)) return { status: 'stale' }
    snapshot = nextSnapshot
    onSnapshot?.(snapshot)
    return { status: 'accepted', snapshot, today: snapshot.today }
  }
  const fail = (token, error) => {
    if (!isCurrent(token)) return { status: 'stale' }
    forwardAuthInvalid(error, onAuthInvalid)
    throw error
  }

  return Object.freeze({
    mount() {
      mounted = true
    },
    async loadInitial({ selectedProjectId = '' } = {}) {
      const token = begin()
      if (token === null) return { status: 'stale' }
      try {
        const [projects, today] = await Promise.all([
          service.listAttendanceProjects(),
          service.getMyTodayAttendance(),
        ])
        if (!isCurrent(token)) return { status: 'stale' }
        const eligibleProjects = filterEligibleAttendanceProjects(projects)
        const validSelection = eligibleProjects.some(
          (project) => project.projectId === selectedProjectId,
        ) ? selectedProjectId : ''
        return accept(token, {
          projects: eligibleProjects,
          selectedProjectId: validSelection,
          today,
        })
      } catch (error) {
        return fail(token, error)
      }
    },
    async refreshToday() {
      const token = begin()
      if (token === null) return { status: 'stale' }
      try {
        const today = await service.getMyTodayAttendance()
        if (!isCurrent(token)) return { status: 'stale' }
        return accept(token, { ...snapshot, today })
      } catch (error) {
        return fail(token, error)
      }
    },
    selectProject(projectId) {
      const selectedProjectId = snapshot.projects.some(
        (project) => project.projectId === projectId,
      ) ? projectId : ''
      snapshot = { ...snapshot, selectedProjectId }
      onSnapshot?.(snapshot)
      return selectedProjectId
    },
    getSnapshot() {
      return snapshot
    },
    unmount() {
      mounted = false
      generation += 1
    },
  })
}

export function createAttendanceDraftKey(sessionId, ordinal) {
  const normalizedSessionId = String(sessionId ?? '').trim()
  const normalizedOrdinal = Number(ordinal)
  if (!normalizedSessionId || !Number.isInteger(normalizedOrdinal) || normalizedOrdinal < 1) {
    throw new TypeError('attendance draft identity is invalid')
  }
  return `${normalizedSessionId}:${normalizedOrdinal}`
}

export function updateAttendanceDraft(drafts = {}, { sessionId, point } = {}) {
  const key = createAttendanceDraftKey(sessionId, point?.ordinal)
  const previous = drafts[key]
  const draft = {
    sessionId: String(sessionId).trim(),
    ordinal: Number(point.ordinal),
    areaName: String(point.areaName ?? ''),
    workDescription: String(point.workDescription ?? ''),
    completionNote: String(point.completionNote ?? ''),
    version: Number(previous?.version || 0) + 1,
  }
  return { ...drafts, [key]: draft }
}

export function overlayAttendanceDrafts(session, drafts = {}) {
  if (!session) return []
  const serverPoints = Array.isArray(session.workPoints) ? session.workPoints : []
  const byOrdinal = new Map(serverPoints.map((point) => [Number(point.ordinal), point]))
  for (const draft of Object.values(drafts)) {
    if (draft?.sessionId !== session.sessionId) continue
    const ordinal = Number(draft.ordinal)
    const serverPoint = byOrdinal.get(ordinal)
    if (serverPoint) {
      byOrdinal.set(ordinal, {
        ...serverPoint,
        areaName: draft.areaName,
        workDescription: draft.workDescription,
        completionNote: draft.completionNote,
      })
    } else {
      byOrdinal.set(ordinal, {
        ordinal,
        areaName: draft.areaName,
        workDescription: draft.workDescription,
        completionNote: draft.completionNote,
        photos: { before: null, after: null },
      })
    }
  }
  return [...byOrdinal.values()].sort(
    (left, right) => Number(left.ordinal) - Number(right.ordinal),
  )
}

export function clearAttendanceDraftAfterRefresh(drafts = {}, {
  sessionId,
  ordinal,
  version,
  today,
  savedPoint,
} = {}) {
  const key = createAttendanceDraftKey(sessionId, ordinal)
  const draft = drafts[key]
  if (!draft || draft.version !== version ||
      today?.activeSession?.sessionId !== sessionId) return drafts
  const serverPoint = today.activeSession.workPoints?.find(
    (point) => Number(point.ordinal) === Number(ordinal),
  )
  const expectedPoint = savedPoint || draft
  if (!serverPoint || EDITABLE_POINT_FIELDS.some(
    (field) => String(serverPoint[field] ?? '') !== String(expectedPoint[field] ?? ''),
  )) return drafts
  const next = { ...drafts }
  delete next[key]
  return next
}

export function createAttendancePageWriteGuard() {
  let mounted = true
  let locked = false
  let token = 0
  return Object.freeze({
    mount() {
      if (mounted) return
      mounted = true
      locked = false
      token += 1
    },
    begin() {
      if (!mounted || locked) return null
      locked = true
      token += 1
      return token
    },
    isCurrent(candidate) {
      return mounted && locked && candidate === token
    },
    finish(candidate) {
      if (candidate === token) locked = false
    },
    unmount() {
      mounted = false
      locked = false
      token += 1
    },
  })
}

export function createAttendanceWorkPointSaveController({
  service,
  getToday,
  getDrafts,
  setDrafts,
  refreshToday,
  onAuthInvalid,
  writeGuard: providedWriteGuard,
} = {}) {
  const writeGuard = providedWriteGuard || createAttendancePageWriteGuard()
  const ownsWriteGuard = !providedWriteGuard
  let mounted = true
  let lifecycleEpoch = 0
  const isCurrent = (epoch, writeToken) => mounted &&
    epoch === lifecycleEpoch && writeGuard.isCurrent(writeToken)
  return Object.freeze({
    mount() {
      if (mounted) return
      mounted = true
      lifecycleEpoch += 1
      if (ownsWriteGuard) writeGuard.mount()
    },
    async savePoint(point) {
      const writeToken = writeGuard.begin()
      if (writeToken === null) return { status: 'busy' }
      const operationEpoch = lifecycleEpoch
      try {
        const attendanceSession = getToday?.()?.activeSession
        const ordinal = Number(point?.ordinal)
        if (!isCurrent(operationEpoch, writeToken) ||
            attendanceSession?.status !== 'open' ||
            !Number.isInteger(ordinal)) return { status: 'invalid' }
        const sessionId = attendanceSession.sessionId
        const key = createAttendanceDraftKey(sessionId, ordinal)
        const capturedVersion = getDrafts?.()?.[key]?.version ?? null
        let normalizedPoint
        try {
          normalizedPoint = normalizeAttendanceWorkPointInput({ ...point, ordinal })
        } catch {
          return { status: 'invalid' }
        }
        const input = {
          sessionId,
          ordinal: normalizedPoint.ordinal,
          areaName: normalizedPoint.areaName,
          workDescription: normalizedPoint.workDescription,
          completionNote: normalizedPoint.completionNote,
        }
        try {
          await service.upsertWorkPoint(input)
        } catch (error) {
          if (!isCurrent(operationEpoch, writeToken) ||
              getToday?.()?.activeSession?.sessionId !== sessionId) {
            return { status: 'stale' }
          }
          forwardAuthInvalid(error, onAuthInvalid)
          return {
            status: 'failed',
            errorCode: safeErrorCode(error, 'ATTENDANCE_WORK_POINT_SAVE_FAILED'),
          }
        }
        if (!isCurrent(operationEpoch, writeToken) ||
            getToday?.()?.activeSession?.sessionId !== sessionId) {
          return { status: 'stale' }
        }
        let refreshed
        try {
          refreshed = await refreshToday()
        } catch (error) {
          return {
            status: 'refresh-failed',
            errorCode: safeErrorCode(error, 'ATTENDANCE_REFRESH_FAILED'),
          }
        }
        if (!isCurrent(operationEpoch, writeToken) ||
            refreshed?.status === 'stale') return { status: 'stale' }
        const refreshedToday = refreshed?.today || getToday?.()
        if (refreshedToday?.activeSession?.sessionId !== sessionId) {
          return { status: 'stale' }
        }
        const currentDrafts = getDrafts?.() || {}
        if (capturedVersion !== null && currentDrafts[key]?.version !== capturedVersion) {
          return { status: 'stale' }
        }
        if (capturedVersion !== null) {
          setDrafts?.(clearAttendanceDraftAfterRefresh(currentDrafts, {
            sessionId,
            ordinal,
            version: capturedVersion,
            today: refreshedToday,
            savedPoint: input,
          }))
        }
        return { status: 'succeeded' }
      } finally {
        writeGuard.finish(writeToken)
      }
    },
    unmount() {
      mounted = false
      lifecycleEpoch += 1
      if (ownsWriteGuard) writeGuard.unmount()
    },
  })
}

export function createAttendanceClockController({
  service,
  getToday,
  getSelectedProject,
  refreshToday,
  onAuthInvalid,
  writeGuard: providedWriteGuard,
} = {}) {
  const writeGuard = providedWriteGuard || createAttendancePageWriteGuard()
  const ownsWriteGuard = !providedWriteGuard
  let mounted = true
  let activeOperation = null
  let pendingConfirmation = null

  const submit = async (kind, submission) => {
    const writeToken = writeGuard.begin()
    if (writeToken === null) return { status: 'busy' }
    const attendanceSession = getToday?.()?.activeSession
    const attendanceMode = attendanceSession?.attendanceMode ||
      getToday?.()?.policy?.attendanceMode || 'project'
    const selectedProject = getSelectedProject?.()
    const targetId = kind === 'clock_out'
      ? attendanceSession?.sessionId
      : attendanceMode === 'project' ? selectedProject?.projectId : null
    if (!mounted || !['project', 'general'].includes(attendanceMode) ||
        (attendanceMode === 'project' && !isNonBlankString(targetId)) ||
        (kind === 'clock_out' && !isNonBlankString(targetId)) ||
        (kind === 'clock_out' && attendanceSession?.status !== 'open') ||
        (kind === 'clock_in' && attendanceSession)) {
      writeGuard.finish(writeToken)
      return { status: 'invalid' }
    }
    const input = kind === 'clock_out'
      ? { attendanceMode, sessionId: targetId, ...submission }
      : { attendanceMode, projectId: targetId, ...submission }
    try {
      const result = kind === 'clock_out'
        ? await service.clockOut(input)
        : await service.clockIn(input)
      if (!mounted || !writeGuard.isCurrent(writeToken)) {
        writeGuard.finish(writeToken)
        return { status: 'stale' }
      }
      if (result?.status === 'confirmation_required') {
        pendingConfirmation = { kind, input, confirmation: result.confirmation }
        writeGuard.finish(writeToken)
        return { status: 'confirmation_required', confirmation: result.confirmation }
      }
      activeOperation = { writeToken, kind, targetId, result }
      return { status: 'submitted', result }
    } catch (error) {
      if (mounted && writeGuard.isCurrent(writeToken)) {
        forwardAuthInvalid(error, onAuthInvalid)
      }
      writeGuard.finish(writeToken)
      throw error
    }
  }

  return Object.freeze({
    mount() {
      if (mounted) return
      mounted = true
      if (ownsWriteGuard) writeGuard.mount()
    },
    clockIn(submission) {
      return submit('clock_in', submission)
    },
    clockOut(submission) {
      return submit('clock_out', submission)
    },
    async confirmOutOfRange() {
      const pending = pendingConfirmation
      if (!pending) return { status: 'invalid' }
      const writeToken = writeGuard.begin()
      if (writeToken === null) return { status: 'busy' }
      pendingConfirmation = null
      try {
        const result = pending.kind === 'clock_out'
          ? await service.clockOut({ ...pending.input, outOfRangeConfirmed: true })
          : await service.clockIn({ ...pending.input, outOfRangeConfirmed: true })
        if (!mounted || !writeGuard.isCurrent(writeToken)) {
          writeGuard.finish(writeToken)
          return { status: 'stale' }
        }
        if (result?.status !== 'saved') {
          pendingConfirmation = pending
          writeGuard.finish(writeToken)
          return { status: 'invalid' }
        }
        activeOperation = {
          writeToken,
          kind: pending.kind,
          targetId: pending.kind === 'clock_out'
            ? pending.input.sessionId
            : pending.input.projectId,
          result,
        }
        return { status: 'submitted', result }
      } catch (error) {
        if (mounted) pendingConfirmation = pending
        if (mounted && writeGuard.isCurrent(writeToken)) forwardAuthInvalid(error, onAuthInvalid)
        writeGuard.finish(writeToken)
        throw error
      }
    },
    cancelOutOfRange() {
      if (!pendingConfirmation) return { status: 'invalid' }
      pendingConfirmation = null
      return { status: 'cancelled' }
    },
    async refreshAfterClock() {
      const operation = activeOperation
      if (!operation || !writeGuard.isCurrent(operation.writeToken)) {
        return { status: 'invalid' }
      }
      try {
        const refreshed = await refreshToday()
        if (!mounted || refreshed?.status === 'stale') return { status: 'stale' }
        return { status: 'succeeded' }
      } catch (error) {
        throw error
      } finally {
        activeOperation = null
        writeGuard.finish(operation.writeToken)
      }
    },
    unmount() {
      mounted = false
      if (activeOperation) writeGuard.finish(activeOperation.writeToken)
      activeOperation = null
      pendingConfirmation = null
      if (ownsWriteGuard) writeGuard.unmount()
    },
  })
}

export function createAttendancePhotoPreviewController({
  photoStorage,
  onPreview,
} = {}) {
  let mounted = true
  let generation = 0
  return Object.freeze({
    mount() {
      mounted = true
    },
    async open({ photo, context } = {}) {
      if (!mounted) return { status: 'stale' }
      generation += 1
      const token = generation
      let url
      try {
        url = await photoStorage.createAttendancePhotoSignedUrl({ photo })
      } catch (error) {
        if (!mounted || token !== generation) return { status: 'stale' }
        const preview = {
          status: 'failed',
          errorCode: safeErrorCode(error, 'ATTENDANCE_PHOTO_PREVIEW_FAILED'),
          photo,
          context,
        }
        onPreview?.(preview)
        return preview
      }
      if (!mounted || token !== generation) return { status: 'stale' }
      const preview = { status: 'opened', url, photo, context }
      onPreview?.(preview)
      return preview
    },
    close() {
      if (!mounted) return
      generation += 1
      onPreview?.(null)
    },
    unmount() {
      mounted = false
      generation += 1
    },
  })
}

function photoKey(workPointId, phase) {
  return `${workPointId}:${phase}`
}

function pendingPhotoMatches(photo, context) {
  return photo?.uploadStatus === 'pending' &&
    isNonBlankString(photo.photoId) &&
    photo.workPointId === context.workPointId &&
    photo.phase === context.phase
}

function activePhotoMatches(photo, reservation) {
  return photo?.uploadStatus === 'active' &&
    photo.photoId === reservation?.photoId &&
    photo.workPointId === reservation?.workPointId &&
    photo.phase === reservation?.phase
}

function cleanupPhotoMatches(photo, reservation) {
  return photo?.uploadStatus === 'cleanup_pending' &&
    photo.photoId === reservation?.photoId &&
    photo.workPointId === reservation?.workPointId &&
    photo.phase === reservation?.phase
}

export function createAttendancePhotoOperationController({
  service,
  photoStorage,
  createAttemptId,
  getToday,
  refreshToday,
  onAuthInvalid,
  onAction,
  writeGuard: providedWriteGuard,
} = {}) {
  const writeGuard = providedWriteGuard || createAttendancePageWriteGuard()
  const ownsWriteGuard = !providedWriteGuard
  let mounted = true
  const states = new Map()
  const generations = new Map()
  const usedAttemptIds = new Set()

  const getState = (key) => states.get(key) || createAttendancePhotoUploadState()
  const dispatch = (key, action) => {
    const previous = getState(key)
    const next = attendancePhotoUploadReducer(previous, action)
    if (next !== previous) {
      states.set(key, next)
      onAction?.(key, action, next)
    }
    return next
  }
  const replaceStateFromServer = (key, action, initialState) => {
    const next = attendancePhotoUploadReducer(initialState, action)
    startGeneration(key)
    states.set(key, next)
    onAction?.(key, action, next)
    return next
  }
  const resetFromServer = (key) => replaceStateFromServer(
    key,
    { type: 'reset' },
    createAttendancePhotoUploadState(),
  )
  const recoverFromServer = (key, reservation) => replaceStateFromServer(
    key,
    { type: 'hydrate-pending', reservation },
    createAttendancePhotoUploadState(),
  )
  const currentContext = (workPointId, phase) => {
    const attendanceSession = getToday?.()?.activeSession
    const workPoint = attendanceSession?.status === 'open'
      ? attendanceSession.workPoints?.find((candidate) => candidate.workPointId === workPointId)
      : null
    if (!workPoint || !['before', 'after'].includes(phase)) return null
    return {
      sessionId: attendanceSession.sessionId,
      workPointId,
      phase,
      key: photoKey(workPointId, phase),
    }
  }
  const startGeneration = (key) => {
    const generation = Number(generations.get(key) || 0) + 1
    generations.set(key, generation)
    return generation
  }
  const isCurrent = (context, generation) => {
    if (!mounted || generations.get(context.key) !== generation) return false
    const latest = currentContext(context.workPointId, context.phase)
    return latest?.sessionId === context.sessionId
  }

  const refreshAfterConfirmed = async (context, generation, stage) => {
    let refreshed
    try {
      refreshed = await refreshToday()
    } catch (error) {
      return {
        status: 'refresh-failed',
        stage,
        errorCode: safeErrorCode(error, 'ATTENDANCE_REFRESH_FAILED'),
      }
    }
    if (!isCurrent(context, generation) || refreshed?.status === 'stale') {
      return { status: 'stale' }
    }
    return { status: 'refreshed', refreshed }
  }

  const abandonCurrentReservation = async (context, generation, reservation) => {
    const abandoning = dispatch(context.key, {
      type: 'abandon-start', photoId: reservation.photoId,
    })
    if (abandoning.failedStage !== 'abandon') return { status: 'invalid' }
    let cleanupPhoto
    try {
      cleanupPhoto = await service.abandonPhoto({ photoId: reservation.photoId })
    } catch (error) {
      if (!isCurrent(context, generation)) return { status: 'stale' }
      forwardAuthInvalid(error, onAuthInvalid)
      dispatch(context.key, {
        type: 'abandon-failure', photoId: reservation.photoId,
        errorCode: safeErrorCode(error, 'ATTENDANCE_PHOTO_ABANDON_FAILED'),
      })
      return { status: 'failed', stage: 'abandon' }
    }
    if (!isCurrent(context, generation)) return { status: 'stale' }
    if (!cleanupPhotoMatches(cleanupPhoto, reservation)) {
      dispatch(context.key, {
        type: 'abandon-failure', photoId: reservation.photoId,
        errorCode: 'ATTENDANCE_PHOTO_CLEANUP_MISMATCH',
      })
      return { status: 'failed', stage: 'abandon' }
    }
    const cleaned = dispatch(context.key, { type: 'abandon-success', photo: cleanupPhoto })
    if (cleaned.phase !== 'cleanup_pending' || cleaned.reservation !== null) {
      return { status: 'failed', stage: 'abandon' }
    }
    const refreshed = await refreshAfterConfirmed(context, generation, 'abandon')
    if (refreshed.status !== 'refreshed') return refreshed
    return { status: 'cleaned' }
  }

  const finalizeCurrentReservation = async (context, generation, reservation) => {
    let activePhoto
    try {
      activePhoto = await service.finalizePhoto({ photoId: reservation.photoId })
    } catch (error) {
      if (!isCurrent(context, generation)) return { status: 'stale' }
      forwardAuthInvalid(error, onAuthInvalid)
      dispatch(context.key, {
        type: 'finalize-failure', photoId: reservation.photoId,
        errorCode: safeErrorCode(error, 'ATTENDANCE_PHOTO_FINALIZE_FAILED'),
      })
      return { status: 'failed', stage: 'finalize' }
    }
    if (!isCurrent(context, generation)) return { status: 'stale' }
    if (!activePhotoMatches(activePhoto, reservation)) {
      dispatch(context.key, {
        type: 'finalize-failure', photoId: reservation.photoId,
        errorCode: 'ATTENDANCE_PHOTO_FINALIZE_MISMATCH',
      })
      return { status: 'failed', stage: 'finalize' }
    }
    const finalized = dispatch(context.key, { type: 'finalize-success', photo: activePhoto })
    if (finalized.phase !== 'active' ||
        finalized.activePhoto?.photoId !== reservation.photoId) {
      return { status: 'failed', stage: 'finalize' }
    }
    const refreshed = await refreshAfterConfirmed(context, generation, 'finalize')
    if (refreshed.status !== 'refreshed') return refreshed
    return { status: 'succeeded', photo: activePhoto }
  }

  return Object.freeze({
    mount() {
      if (mounted) return
      mounted = true
      if (ownsWriteGuard) writeGuard.mount()
    },
    getState,
    reconcile(today) {
      const attendanceSession = today?.activeSession
      if (!attendanceSession || !Array.isArray(today.pendingPhotoReservations)) return
      const workPoints = attendanceSession.workPoints || []
      const pointIds = new Set(workPoints.map((workPoint) => workPoint.workPointId))
      const pendingByKey = new Map()
      for (const reservation of today.pendingPhotoReservations) {
        if (!isNonBlankString(reservation?.photoId) ||
            !pointIds.has(reservation.workPointId) ||
            !['before', 'after'].includes(reservation.phase) ||
            reservation.uploadStatus !== 'pending') continue
        pendingByKey.set(photoKey(reservation.workPointId, reservation.phase), reservation)
      }

      for (const [key, state] of states) {
        let serverPhoto = null
        for (const workPoint of workPoints) {
          for (const phase of ['before', 'after']) {
            if (photoKey(workPoint.workPointId, phase) === key) {
              serverPhoto = workPoint.photos?.[phase] || null
            }
          }
        }
        const pending = pendingByKey.get(key)
        const preserveLocalSelection = state.reservation === null && (
          ['selected', 'reserving'].includes(state.phase) ||
          (state.phase === 'failed' && state.failedStage === 'reserve')
        )
        if (pending) {
          const sameReservation = state.reservation?.photoId === pending.photoId &&
            state.reservation.workPointId === pending.workPointId &&
            state.reservation.phase === pending.phase
          if (sameReservation) continue
          recoverFromServer(key, pending)
          continue
        }
        if (preserveLocalSelection) continue
        const localPhotoId = state.activePhoto?.photoId || state.reservation?.photoId
        const serverRepresentsLocalPhoto = serverPhoto?.uploadStatus === 'active' &&
          isNonBlankString(localPhotoId) && serverPhoto.photoId === localPhotoId
        if (state.phase === 'cleanup_pending' || serverRepresentsLocalPhoto) {
          resetFromServer(key)
        }
      }

      for (const reservation of today.pendingPhotoReservations) {
        if (!isNonBlankString(reservation?.photoId) ||
            !pointIds.has(reservation.workPointId) ||
            !['before', 'after'].includes(reservation.phase) ||
            reservation.uploadStatus !== 'pending') continue
        const key = photoKey(reservation.workPointId, reservation.phase)
        if (states.has(key)) continue
        const state = getState(key)
        dispatch(key, { type: 'hydrate-pending', reservation })
      }
    },
    async selectPhoto({ workPointId, phase, file } = {}) {
      const writeToken = writeGuard.begin()
      if (writeToken === null) return { status: 'busy' }
      try {
        const context = currentContext(workPointId, phase)
        if (!context) return { status: 'invalid' }
        let metadata
        let attemptId
        try {
          metadata = validateAttendancePhotoFile(file)
          attemptId = createAttemptId()
          if (!isNonBlankString(attemptId)) {
            throw new TypeError('attendance photo attempt id is required')
          }
          attemptId = attemptId.trim()
          if (usedAttemptIds.has(attemptId)) {
            const duplicateError = new TypeError('attendance photo attempt id must be new')
            duplicateError.code = 'ATTENDANCE_PHOTO_ATTEMPT_INVALID'
            throw duplicateError
          }
        } catch (error) {
          return { status: 'invalid', errorCode: safeErrorCode(error, 'ATTENDANCE_PHOTO_INVALID') }
        }
        const generation = startGeneration(context.key)
        const selected = dispatch(context.key, { type: 'select', file })
        if (selected.phase !== 'selected' || selected.file !== file) {
          return { status: 'invalid', errorCode: 'ATTENDANCE_PHOTO_STATE_LOCKED' }
        }
        const reserving = dispatch(context.key, { type: 'reserve-start', attemptId })
        if (reserving.phase !== 'reserving' || reserving.attemptId !== attemptId) {
          return { status: 'invalid', errorCode: 'ATTENDANCE_PHOTO_STATE_LOCKED' }
        }
        usedAttemptIds.add(attemptId)

        let reservation
        try {
          reservation = await service.reservePhoto({
            workPointId,
            phase,
            originalFileName: metadata.originalFileName,
            contentType: metadata.contentType,
            sizeBytes: metadata.sizeBytes,
            capturedAt: metadata.capturedAt,
          })
        } catch (error) {
          if (!isCurrent(context, generation)) return { status: 'stale' }
          forwardAuthInvalid(error, onAuthInvalid)
          dispatch(context.key, {
            type: 'reserve-failure', attemptId,
            errorCode: safeErrorCode(error, 'ATTENDANCE_PHOTO_RESERVE_FAILED'),
          })
          return { status: 'failed', stage: 'reserve' }
        }
        if (!isCurrent(context, generation)) return { status: 'stale' }
        if (!pendingPhotoMatches(reservation, context)) {
          dispatch(context.key, {
            type: 'reserve-failure', attemptId,
            errorCode: 'ATTENDANCE_PHOTO_RESERVATION_MISMATCH',
          })
          return { status: 'failed', stage: 'reserve' }
        }
        const uploading = dispatch(context.key, {
          type: 'reserve-success', attemptId, reservation,
        })
        if (uploading.phase !== 'uploading' ||
            uploading.reservation?.photoId !== reservation.photoId) {
          return { status: 'failed', stage: 'reserve' }
        }

        try {
          await photoStorage.uploadReservedPhoto({ reservation, file })
        } catch (error) {
          if (!isCurrent(context, generation)) return { status: 'stale' }
          dispatch(context.key, {
            type: 'upload-failure', photoId: reservation.photoId,
            errorCode: safeErrorCode(error, 'ATTENDANCE_PHOTO_UPLOAD_FAILED'),
          })
          return abandonCurrentReservation(context, generation, reservation)
        }
        if (!isCurrent(context, generation)) return { status: 'stale' }
        const confirming = dispatch(context.key, {
          type: 'upload-success', photoId: reservation.photoId,
        })
        if (confirming.phase !== 'confirming' ||
            confirming.reservation?.photoId !== reservation.photoId) {
          return { status: 'failed', stage: 'upload' }
        }

        return finalizeCurrentReservation(context, generation, reservation)
      } finally {
        writeGuard.finish(writeToken)
      }
    },
    async retryFinalize({ workPointId, phase, photoId } = {}) {
      const writeToken = writeGuard.begin()
      if (writeToken === null) return { status: 'busy' }
      try {
        const context = currentContext(workPointId, phase)
        if (!context) return { status: 'invalid' }
        const state = getState(context.key)
        const reservation = state.reservation
        if (!pendingPhotoMatches(reservation, context) ||
            reservation.photoId !== photoId ||
            !['finalize', 'recovered'].includes(state.failedStage)) {
          return { status: 'invalid' }
        }
        const generation = startGeneration(context.key)
        const confirming = dispatch(context.key, { type: 'finalize-retry' })
        if (confirming.phase !== 'confirming') return { status: 'invalid' }
        return finalizeCurrentReservation(context, generation, reservation)
      } finally {
        writeGuard.finish(writeToken)
      }
    },
    async abandonPhoto({ workPointId, phase, photoId } = {}) {
      const writeToken = writeGuard.begin()
      if (writeToken === null) return { status: 'busy' }
      try {
        const context = currentContext(workPointId, phase)
        if (!context) return { status: 'invalid' }
        const state = getState(context.key)
        const reservation = state.reservation
        if (!pendingPhotoMatches(reservation, context) || reservation.photoId !== photoId) {
          return { status: 'invalid' }
        }
        if (state.failedStage === 'finalize') return { status: 'prohibited' }
        if (!['upload', 'recovered', 'abandon'].includes(state.failedStage)) {
          return { status: 'invalid' }
        }
        const generation = startGeneration(context.key)
        return abandonCurrentReservation(context, generation, reservation)
      } finally {
        writeGuard.finish(writeToken)
      }
    },
    unmount() {
      mounted = false
      if (ownsWriteGuard) writeGuard.unmount()
      for (const [key, generation] of generations) {
        generations.set(key, generation + 1)
      }
    },
  })
}

export function resolveAttendanceViewTab(requestedTab, access) {
  return requestedTab === 'records' && access?.canViewScopedRecords === true
    ? 'records'
    : 'mine'
}

export function resolveAttendanceTabKey(activeTab, key, canViewRecords) {
  if (canViewRecords !== true) return null
  if (key === 'Home') return 'mine'
  if (key === 'End') return 'records'
  if (!['ArrowLeft', 'ArrowRight'].includes(key)) return null
  return activeTab === 'records' ? 'mine' : 'records'
}

export function attendancePageErrorMessage(errorCode) {
  if (!errorCode) return ''
  if (String(errorCode).includes('PHOTO')) {
    return '照片处理失败，请按当前操作重试。'
  }
  if (String(errorCode).includes('LOAD')) {
    return '考勤读取失败，请重试。'
  }
  return '考勤操作失败，请重试。'
}

export async function retryAttendanceAuthoritativeSnapshot({
  snapshotController,
  snapshot,
  onErrorCode,
} = {}) {
  try {
    const result = snapshot?.today
      ? await snapshotController.refreshToday()
      : await snapshotController.loadInitial({
        selectedProjectId: snapshot?.selectedProjectId || '',
      })
    if (result?.status === 'accepted') onErrorCode?.(null)
    return result
  } catch (error) {
    const errorCode = safeErrorCode(
      error,
      snapshot?.today ? 'ATTENDANCE_REFRESH_FAILED' : 'ATTENDANCE_LOAD_FAILED',
    )
    onErrorCode?.(errorCode)
    return { status: 'failed', errorCode }
  }
}

function findAttendancePhotoContext(today, photo) {
  const attendanceSessions = [
    today?.activeSession,
    ...(Array.isArray(today?.completedSessions) ? today.completedSessions : []),
  ].filter(Boolean)
  for (const attendanceSession of attendanceSessions) {
    for (const workPoint of attendanceSession.workPoints || []) {
      for (const phase of ['before', 'after']) {
        const candidate = workPoint.photos?.[phase]
        if (candidate?.photoId === photo?.photoId &&
            candidate.uploadStatus === 'active') {
          return {
            source: 'mine',
            projectName: attendanceSession.projectNameSnapshot,
            employeeName: attendanceSession.employeeNameSnapshot,
            ordinal: workPoint.ordinal,
            phase,
          }
        }
      }
    }
  }
  return {
    source: 'mine',
    projectName: '考勤记录',
    ordinal: null,
    phase: photo?.phase,
  }
}

export function AttendancePhotoModal({ preview, onClose }) {
  const headingId = useId()
  const closeRef = useRef(null)
  const modalRef = useRef(null)
  useEffect(() => {
    if (!preview) return undefined
    const modal = modalRef.current
    const background = [...(modal?.parentElement?.children || [])]
      .filter((sibling) => sibling !== modal)
      .map((sibling) => ({
        sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute('aria-hidden'),
      }))
    for (const { sibling } of background) {
      sibling.inert = true
      sibling.setAttribute('aria-hidden', 'true')
    }
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
      if (event.key === 'Tab') {
        event.preventDefault()
        closeRef.current?.focus()
      }
    }
    globalThis.document?.addEventListener('keydown', onKeyDown)
    return () => {
      globalThis.document?.removeEventListener('keydown', onKeyDown)
      for (const previous of background) {
        const { sibling } = previous
        sibling.inert = previous.inert
        if (previous.ariaHidden === null) sibling.removeAttribute('aria-hidden')
        else sibling.setAttribute('aria-hidden', previous.ariaHidden)
      }
    }
  }, [onClose, preview])

  if (!preview) return null
  const context = preview.context || {}
  const phase = context.phase || preview.photo?.phase
  const phaseLabel = phase === 'after' ? '完工照片' : '开工前照片'
  const ordinalLabel = Number.isInteger(Number(context.ordinal))
    ? `第 ${Number(context.ordinal)} 点位`
    : ''
  const alt = `${context.projectName || '考勤记录'}${ordinalLabel}${phaseLabel}`

  return (
    <div
      ref={modalRef}
      className="attendance-photo-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div className="attendance-photo-modal-panel">
        <h2 id={headingId}>照片预览</h2>
        <button
          ref={closeRef}
          className="attendance-photo-modal-close"
          type="button"
          aria-label="关闭照片预览"
          onClick={() => onClose?.()}
        >
          关闭
        </button>
        {preview.status === 'opened' ? (
          <img className="attendance-photo-modal-image" src={preview.url} alt={alt} />
        ) : (
          <p className="attendance-error" role="alert">暂时无法打开照片，请重试。</p>
        )}
      </div>
    </div>
  )
}

export function TodayAttendanceView({
  snapshot = { projects: [], selectedProjectId: '', today: null },
  loading = false,
  errorCode = null,
  tab = 'mine',
  drafts = {},
  saveStates = {},
  photoStates = {},
  mutationPending = false,
  locationService,
  createRequestId,
  recordService,
  handlers = {},
  preview = null,
  confirmation = null,
  confirmationPending = false,
  onTabChange,
  onBack,
  onAuthInvalid,
  onClosePreview,
}) {
  const today = snapshot.today
  const access = today?.viewerAccess
  const activeTab = resolveAttendanceViewTab(tab, access)
  const activeSession = today?.activeSession
  const experience = today
    ? resolveAttendanceExperience(today.policy, activeSession)
    : null
  const points = overlayAttendanceDrafts(activeSession, drafts)
  const selectedProject = snapshot.projects.find(
    (project) => project.projectId === snapshot.selectedProjectId,
  ) || null
  const handleTabKeyDown = (event) => {
    const nextTab = resolveAttendanceTabKey(
      activeTab,
      event.key,
      access?.canViewScopedRecords === true,
    )
    if (!nextTab) return
    event.preventDefault()
    const ownerDocument = event.currentTarget.ownerDocument
    onTabChange?.(nextTab)
    const focusTab = () => ownerDocument
      ?.getElementById(`attendance-tab-${nextTab}`)
      ?.focus()
    if (globalThis.queueMicrotask) globalThis.queueMicrotask(focusTab)
    else focusTab()
  }

  return (
    <main className="app-shell page-shell attendance-page">
      <header className="attendance-page-heading">
        <button className="attendance-back" type="button" onClick={() => onBack?.()}>
          返回
        </button>
        <div>
          <p className="attendance-page-eyebrow">现场考勤</p>
          <h1>今日打卡</h1>
          {today?.workDate ? <p>工作日期：{today.workDate}</p> : null}
        </div>
      </header>

      <div className="attendance-view-tabs" role="tablist" aria-label="今日考勤视图">
        <button
          id="attendance-tab-mine"
          tabIndex={activeTab === 'mine' ? 0 : -1}
          type="button"
          role="tab"
          aria-selected={activeTab === 'mine'}
          aria-controls="attendance-panel-mine"
          onKeyDown={handleTabKeyDown}
          onClick={() => onTabChange?.('mine')}
        >
          我的打卡
        </button>
        {access?.canViewScopedRecords === true ? (
          <button
            id="attendance-tab-records"
            tabIndex={activeTab === 'records' ? 0 : -1}
            type="button"
            role="tab"
            aria-selected={activeTab === 'records'}
            aria-controls="attendance-panel-records"
            onKeyDown={handleTabKeyDown}
            onClick={() => onTabChange?.('records')}
          >
            考勤记录
          </button>
        ) : null}
      </div>

      {activeTab === 'mine' ? (
        <section
          id="attendance-panel-mine"
          className="attendance-view-panel"
          role="tabpanel"
          aria-labelledby="attendance-tab-mine"
        >
          {loading && !today ? (
            <p className="attendance-loading" role="status" aria-live="polite">
              正在读取今日考勤…
            </p>
          ) : null}
          {errorCode ? (
            <div className="attendance-error-panel">
              <p className="attendance-error" role="alert">
                {attendancePageErrorMessage(errorCode)}
              </p>
              <button
                className="attendance-retry-refresh"
                type="button"
                disabled={loading || mutationPending}
                onClick={() => handlers.retryRefresh?.()}
              >
                {loading ? '正在重新读取…' : '重新读取服务器记录'}
              </button>
            </div>
          ) : null}
          {experience?.kind === 'project-clock-in' ? (
            <section className="attendance-clock-in-card attendance-session-card">
              <AttendanceProjectPicker
                projects={snapshot.projects}
                selectedProjectId={snapshot.selectedProjectId}
                disabled={mutationPending}
                onChange={handlers.selectProject}
              />
              <AttendanceLocationAction
                action="clock_in"
                attendanceMode="project"
                targetLocation={selectedProject}
                locationService={locationService}
                createRequestId={createRequestId}
                onSubmit={handlers.clockIn}
                onSuccess={handlers.clockRefresh}
                onConfirmationRequired={handlers.openClockConfirmation}
                disabled={mutationPending || !selectedProject}
                disabledReason={mutationPending
                  ? '其他考勤操作正在处理中，请稍候。'
                  : '请先选择可打卡项目。'}
              />
            </section>
          ) : null}
          {experience?.kind === 'project-active' ? (
            <ActiveAttendanceSession
              session={activeSession}
              points={points}
              saveStates={saveStates}
              photoStates={photoStates}
              mutationPending={mutationPending}
              locationService={locationService}
              createRequestId={createRequestId}
              onAddPoint={handlers.addPoint}
              onChangePoint={handlers.changePoint}
              onSavePoint={handlers.savePoint}
              onSelectPhoto={handlers.selectPhoto}
              onRetryFinalize={handlers.retryFinalize}
              onAbandonPhoto={handlers.abandonPhoto}
              onOpenPhoto={handlers.openPhoto}
              onClockOut={handlers.clockOut}
              onClockOutSuccess={handlers.clockRefresh}
              onConfirmationRequired={handlers.openClockConfirmation}
            />
          ) : null}
          {experience?.kind === 'general-clock-in' ? (
            <section className="attendance-general-clock-in attendance-session-card">
              <p className="attendance-session-eyebrow">公司考勤</p>
              <h2>按当前位置完成公司上班打卡</h2>
              <AttendanceLocationAction
                action="clock_in"
                attendanceMode="general"
                buttonLabel="按当前位置打卡上班"
                targetLocation={null}
                locationService={locationService}
                createRequestId={createRequestId}
                onSubmit={handlers.clockIn}
                onSuccess={handlers.clockRefresh}
                onConfirmationRequired={handlers.openClockConfirmation}
                disabled={mutationPending}
                disabledReason="其他考勤操作正在处理中，请稍候。"
              />
            </section>
          ) : null}
          {experience?.kind === 'general-active' ? (
            <GeneralAttendanceSession
              session={activeSession}
              mutationPending={mutationPending}
              locationService={locationService}
              createRequestId={createRequestId}
              onClockOut={handlers.clockOut}
              onClockOutSuccess={handlers.clockRefresh}
              onConfirmationRequired={handlers.openClockConfirmation}
            />
          ) : null}
          {experience?.kind === 'exempt' ? (
            <section className="attendance-exempt-card attendance-session-card" role="status">
              <p className="attendance-session-eyebrow">免每日打卡</p>
              <h2>已设置为免每日打卡</h2>
              <p>本月按正常出勤工资规则处理，无需每天打卡上班或下班。</p>
            </section>
          ) : null}
          {experience?.kind === 'policy-conflict' ? (
            <section className="attendance-policy-conflict attendance-session-card" role="alert">
              <h2>人员打卡设置已变化，请重新读取</h2>
              <button
                className="attendance-retry-refresh"
                type="button"
                disabled={loading || mutationPending}
                onClick={() => handlers.retryRefresh?.()}
              >
                重新读取服务器记录
              </button>
            </section>
          ) : null}
          {today ? (
            <TodayAttendanceHistory
              completedSessions={today.completedSessions}
              onOpenPhoto={handlers.openPhoto}
            />
          ) : null}
        </section>
      ) : (
        <section
          id="attendance-panel-records"
          className="attendance-view-panel"
          role="tabpanel"
          aria-labelledby="attendance-tab-records"
        >
          <AttendanceRecordViewer
            access={access}
            workDate={today.workDate}
            service={recordService}
            onAuthInvalid={onAuthInvalid}
            onOpenPhoto={handlers.openPhoto}
          />
        </section>
      )}

      <AttendancePhotoModal preview={preview} onClose={onClosePreview} />
      <AttendanceOutOfRangeDialog
        confirmation={confirmation?.confirmation}
        pending={confirmationPending}
        returnFocus={confirmation?.returnFocus}
        onCancel={handlers.cancelClockConfirmation}
        onConfirm={handlers.confirmClock}
      />
    </main>
  )
}

function operationError(code) {
  const error = new Error('attendance operation failed')
  error.code = code
  return error
}

export default function TodayAttendancePage({
  currentUser: _currentUser,
  service = attendanceService,
  photoStorage = attendancePhotoStorage,
  locationService = attendanceLocationService,
  createRequestId = () => globalThis.crypto.randomUUID(),
  onAuthInvalid,
  onBack,
}) {
  const [snapshot, setSnapshot] = useState({
    projects: [], selectedProjectId: '', today: null,
  })
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const [loading, setLoading] = useState(true)
  const [errorCode, setErrorCode] = useState(null)
  const [tab, setTab] = useState('mine')
  const [drafts, setDrafts] = useState({})
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const [saveStates, setSaveStates] = useState({})
  const [photoStates, setPhotoStates] = useState({})
  const [mutationPending, setMutationPending] = useState(false)
  const [preview, setPreview] = useState(null)
  const [clockConfirmation, setClockConfirmation] = useState(null)
  const [confirmationPending, setConfirmationPending] = useState(false)
  const returnFocusRef = useRef(null)
  const pendingCountRef = useRef(0)
  const clockPendingRef = useRef(false)
  const createRequestIdRef = useRef(createRequestId)
  createRequestIdRef.current = createRequestId

  const applySnapshot = useCallback((nextSnapshot) => {
    snapshotRef.current = nextSnapshot
    setSnapshot(nextSnapshot)
  }, [])
  const commitDrafts = useCallback((nextDrafts) => {
    draftsRef.current = nextDrafts
    setDrafts(nextDrafts)
  }, [])
  const writeGuard = useMemo(() => createAttendancePageWriteGuard(), [])
  const snapshotController = useMemo(() => createTodayAttendanceSnapshotController({
    service,
    onAuthInvalid,
    onSnapshot: applySnapshot,
  }), [applySnapshot, onAuthInvalid, service])
  const refreshToday = useCallback(
    () => snapshotController.refreshToday(),
    [snapshotController],
  )
  const selectedProject = useCallback(() => {
    const current = snapshotRef.current
    return current.projects.find(
      (project) => project.projectId === current.selectedProjectId,
    ) || null
  }, [])

  const saveController = useMemo(() => createAttendanceWorkPointSaveController({
    service,
    getToday: () => snapshotRef.current.today,
    getDrafts: () => draftsRef.current,
    setDrafts: commitDrafts,
    refreshToday,
    onAuthInvalid,
    writeGuard,
  }), [commitDrafts, onAuthInvalid, refreshToday, service, writeGuard])
  const photoController = useMemo(() => createAttendancePhotoOperationController({
    service,
    photoStorage,
    createAttemptId: () => createRequestIdRef.current(),
    getToday: () => snapshotRef.current.today,
    refreshToday,
    onAuthInvalid,
    writeGuard,
    onAction: (key, action, state) => {
      void action
      setPhotoStates((current) => ({ ...current, [key]: state }))
    },
  }), [onAuthInvalid, photoStorage, refreshToday, service, writeGuard])
  const clockController = useMemo(() => createAttendanceClockController({
    service,
    getToday: () => snapshotRef.current.today,
    getSelectedProject: selectedProject,
    refreshToday,
    onAuthInvalid,
    writeGuard,
  }), [onAuthInvalid, refreshToday, selectedProject, service, writeGuard])
  const previewController = useMemo(() => createAttendancePhotoPreviewController({
    photoStorage,
    onPreview: setPreview,
  }), [photoStorage])

  const beginPending = useCallback(() => {
    pendingCountRef.current += 1
    setMutationPending(true)
  }, [])
  const endPending = useCallback(() => {
    pendingCountRef.current = Math.max(0, pendingCountRef.current - 1)
    if (pendingCountRef.current === 0) setMutationPending(false)
  }, [])

  useEffect(() => {
    writeGuard.mount()
    return () => writeGuard.unmount()
  }, [writeGuard])

  useEffect(() => {
    saveController.mount()
    photoController.mount()
    clockController.mount()
    previewController.mount()
    return () => {
      saveController.unmount()
      photoController.unmount()
      clockController.unmount()
      previewController.unmount()
    }
  }, [clockController, photoController, previewController, saveController])

  useEffect(() => {
    let cancelled = false
    snapshotController.mount()
    setLoading(true)
    setErrorCode(null)
    void snapshotController.loadInitial({
      selectedProjectId: snapshotRef.current.selectedProjectId,
    }).catch((error) => {
      if (!cancelled) setErrorCode(safeErrorCode(error, 'ATTENDANCE_LOAD_FAILED'))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
      snapshotController.unmount()
    }
  }, [snapshotController])

  useEffect(() => {
    photoController.reconcile(snapshot.today)
    if (snapshot.today?.viewerAccess?.canViewScopedRecords !== true) {
      setTab('mine')
    }
  }, [photoController, snapshot.today])

  const editDraft = useCallback((point) => {
    const attendanceSession = snapshotRef.current.today?.activeSession
    if (attendanceSession?.status !== 'open') return
    commitDrafts(updateAttendanceDraft(draftsRef.current, {
      sessionId: attendanceSession.sessionId,
      point,
    }))
  }, [commitDrafts])

  const handleSavePoint = useCallback((point) => {
    setErrorCode(null)
    const ordinal = Number(point.ordinal)
    beginPending()
    setSaveStates((current) => ({
      ...current,
      [ordinal]: { saving: true, error: '' },
    }))
    void saveController.savePoint(point).then((result) => {
      setSaveStates((current) => ({
        ...current,
        [ordinal]: {
          saving: false,
          error: ['failed', 'refresh-failed'].includes(result.status)
            ? '现场日志保存失败，请重试。'
            : '',
        },
      }))
    }).finally(endPending)
  }, [beginPending, endPending, saveController])

  const runPhotoOperation = useCallback((operation) => {
    setErrorCode(null)
    beginPending()
    void operation().then((result) => {
      if (['failed', 'refresh-failed'].includes(result.status)) {
        setErrorCode(result.errorCode || 'ATTENDANCE_PHOTO_FAILED')
      }
    }).finally(endPending)
  }, [beginPending, endPending])

  const submitClock = useCallback(async (method, submission) => {
    setErrorCode(null)
    beginPending()
    try {
      const result = await clockController[method](submission)
      if (result.status !== 'submitted') {
        if (result.status === 'confirmation_required') {
          endPending()
          return result
        }
        throw operationError('ATTENDANCE_WRITE_BUSY')
      }
      clockPendingRef.current = true
      return result.result
    } catch (error) {
      endPending()
      throw error
    }
  }, [beginPending, clockController, endPending])

  const openClockConfirmation = useCallback((value) => {
    setClockConfirmation(value)
  }, [])

  const cancelClockConfirmation = useCallback(() => {
    if (confirmationPending) return
    clockController.cancelOutOfRange()
    setClockConfirmation(null)
  }, [clockController, confirmationPending])

  const refreshAfterClock = useCallback(async () => {
    try {
      const result = await clockController.refreshAfterClock()
      if (result.status !== 'succeeded') {
        throw operationError('ATTENDANCE_REFRESH_FAILED')
      }
    } finally {
      if (clockPendingRef.current) {
        clockPendingRef.current = false
        endPending()
      }
    }
  }, [clockController, endPending])

  const confirmClock = useCallback(() => {
    if (confirmationPending) return
    setConfirmationPending(true)
    setErrorCode(null)
    beginPending()
    void clockController.confirmOutOfRange().then(async (result) => {
      if (result.status !== 'submitted') throw operationError('ATTENDANCE_WRITE_BUSY')
      clockPendingRef.current = true
      setClockConfirmation(null)
      await refreshAfterClock()
    }).catch((error) => {
      if (!clockPendingRef.current) endPending()
      setErrorCode(safeErrorCode(error, 'ATTENDANCE_SERVICE_UNAVAILABLE'))
    }).finally(() => setConfirmationPending(false))
  }, [beginPending, clockController, confirmationPending, endPending, refreshAfterClock])

  const handleOpenPhoto = useCallback((photo, suppliedContext) => {
    if (photo?.uploadStatus !== 'active') return
    returnFocusRef.current = globalThis.document?.activeElement || null
    const context = suppliedContext || findAttendancePhotoContext(
      snapshotRef.current.today,
      photo,
    )
    void previewController.open({ photo, context })
  }, [previewController])

  const handleClosePreview = useCallback((requestedTab) => {
    const returnFocus = returnFocusRef.current
    returnFocusRef.current = null
    previewController.close()
    if (!returnFocus) return
    const activeTab = resolveAttendanceViewTab(
      requestedTab || tab,
      snapshotRef.current.today?.viewerAccess,
    )
    const restoreFocus = () => {
      const focusTarget = returnFocus?.isConnected
        ? returnFocus
        : globalThis.document?.getElementById(`attendance-tab-${activeTab}`)
      focusTarget?.focus()
    }
    if (globalThis.queueMicrotask) globalThis.queueMicrotask(restoreFocus)
    else restoreFocus()
  }, [previewController, tab])

  useEffect(() => {
    handleClosePreview()
  }, [handleClosePreview, snapshot.today?.viewerAccess?.canViewScopedRecords, tab])

  const retryAuthoritativeSnapshot = useCallback(() => {
    if (pendingCountRef.current > 0) return
    setLoading(true)
    void retryAttendanceAuthoritativeSnapshot({
      snapshotController,
      snapshot: snapshotRef.current,
      onErrorCode: setErrorCode,
    }).finally(() => setLoading(false))
  }, [snapshotController])

  const handlers = {
    selectProject: (projectId) => snapshotController.selectProject(projectId),
    addPoint: editDraft,
    changePoint: editDraft,
    savePoint: handleSavePoint,
    selectPhoto: (input) => runPhotoOperation(() => photoController.selectPhoto(input)),
    retryFinalize: (input) => runPhotoOperation(() => photoController.retryFinalize(input)),
    abandonPhoto: (input) => runPhotoOperation(() => photoController.abandonPhoto(input)),
    openPhoto: handleOpenPhoto,
    clockIn: (submission) => submitClock('clockIn', submission),
    clockOut: (submission) => submitClock('clockOut', submission),
    clockRefresh: refreshAfterClock,
    openClockConfirmation,
    cancelClockConfirmation,
    confirmClock,
    retryRefresh: retryAuthoritativeSnapshot,
  }

  return (
    <TodayAttendanceView
      snapshot={snapshot}
      loading={loading}
      errorCode={errorCode}
      tab={tab}
      drafts={drafts}
      saveStates={saveStates}
      photoStates={photoStates}
      mutationPending={mutationPending}
      locationService={locationService}
      createRequestId={createRequestId}
      recordService={service}
      handlers={handlers}
      preview={preview}
      confirmation={clockConfirmation}
      confirmationPending={confirmationPending}
      onTabChange={(nextTab) => {
        const resolvedTab = resolveAttendanceViewTab(
          nextTab,
          snapshotRef.current.today?.viewerAccess,
        )
        handleClosePreview(resolvedTab)
        setTab(resolvedTab)
      }}
      onBack={onBack}
      onAuthInvalid={onAuthInvalid}
      onClosePreview={handleClosePreview}
    />
  )
}
