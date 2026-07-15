import { useId, useState } from 'react'

import { normalizeAttendanceWorkPointInput } from './attendanceDomain.js'
import {
  ATTENDANCE_PHOTO_CONTENT_TYPES,
  normalizeAttendancePhotoPhase,
} from './attendancePhotoDomain.js'
import { canRetryAttendancePhotoUpload } from './attendancePhotoUploadState.js'

const EDITABLE_FIELDS = new Set(['areaName', 'workDescription', 'completionNote'])
const SELECTABLE_PHASES = new Set(['idle', 'selected', 'cleanup_pending'])
const PHOTO_LABELS = Object.freeze({ before: '开工前照片', after: '完工照片' })
const PHOTO_STATUS_LABELS = Object.freeze({
  idle: '尚未选择照片',
  selected: '已选择照片',
  reserving: '正在预约上传',
  uploading: '正在上传照片',
  confirming: '正在确认照片',
  failed: '照片处理失败',
  active: '照片已保存',
  cleanup_pending: '服务器正在清理本次上传',
})

function hasPendingReservation(state) {
  const reservation = state?.reservation
  return reservation?.uploadStatus === 'pending' &&
    typeof reservation.photoId === 'string' && Boolean(reservation.photoId.trim()) &&
    typeof reservation.workPointId === 'string' && Boolean(reservation.workPointId.trim()) &&
    ['before', 'after'].includes(reservation.phase)
}

function photoMatchesPointPhase(photo, point, phase, uploadStatus) {
  return typeof point?.workPointId === 'string' && Boolean(point.workPointId.trim()) &&
    photo?.workPointId === point.workPointId &&
    photo.phase === phase &&
    photo.uploadStatus === uploadStatus
}

function reservationMatchesPointPhase(state, point, phase) {
  return hasPendingReservation(state) &&
    state.reservation.workPointId === point?.workPointId &&
    state.reservation.phase === phase
}

function canSelectAttendancePhoto(state) {
  if (!state || state.phase === 'idle') return true
  if (state.reservation !== null) return false
  return SELECTABLE_PHASES.has(state.phase) ||
    (state.phase === 'failed' && state.failedStage === 'reserve')
}

export function createAttendanceWorkPointChange(point, ordinal, field, value) {
  if (!EDITABLE_FIELDS.has(field)) {
    throw new TypeError('attendance work point field is not editable')
  }
  return { ...point, ordinal, [field]: value }
}

export function createAttendanceWorkPointSave(point, ordinal) {
  return normalizeAttendanceWorkPointInput({ ...point, ordinal })
}

export function createAttendancePhotoSelection(point, phase, file) {
  return {
    workPointId: point?.workPointId,
    phase: normalizeAttendancePhotoPhase(phase),
    file,
  }
}

export function createAttendancePhotoReservationAction(point, phase, photoState) {
  const normalizedPhase = normalizeAttendancePhotoPhase(phase)
  if (!reservationMatchesPointPhase(photoState, point, normalizedPhase)) {
    throw new TypeError('attendance photo reservation does not match point and phase')
  }
  return {
    workPointId: point?.workPointId,
    phase: normalizedPhase,
    photoId: photoState?.reservation?.photoId,
  }
}

export function getAttendancePhotoCapabilities(state, point, phase) {
  const reservationMatches = reservationMatchesPointPhase(state, point, phase)
  const canRetryFinalize = reservationMatches && canRetryAttendancePhotoUpload(state)
  const canAbandon = state?.phase === 'failed' &&
    ['upload', 'recovered', 'abandon'].includes(state.failedStage) &&
    reservationMatches &&
    !(state.failedStage === 'abandon' && state.errorCode === null)
  return { canRetryFinalize, canAbandon }
}

function activePhotoFor(point, phase, state) {
  if (photoMatchesPointPhase(state?.activePhoto, point, phase, 'active')) {
    return state.activePhoto
  }
  const serverPhoto = point?.photos?.[phase]
  return photoMatchesPointPhase(serverPhoto, point, phase, 'active') ? serverPhoto : null
}

function AttendancePhotoControl({
  point,
  ordinal,
  phase,
  state,
  readOnly,
  afterEnabled,
  onSelectPhoto,
  onRetryFinalize,
  onAbandonPhoto,
  onOpenPhoto,
}) {
  const inputId = useId()
  const statusId = useId()
  const gateId = useId()
  const photoState = state || {
    phase: 'idle',
    reservation: null,
    activePhoto: null,
    failedStage: null,
    errorCode: null,
  }
  const activePhoto = activePhotoFor(point, phase, photoState)
  const displayPhase = activePhoto && photoState.phase === 'idle'
    ? 'active'
    : photoState.phase
  const capabilities = getAttendancePhotoCapabilities(photoState, point, phase)
  const hasWorkPointId = typeof point?.workPointId === 'string' && Boolean(point.workPointId.trim())
  const phaseGateOpen = phase === 'before' || afterEnabled
  const inputDisabled = readOnly || !hasWorkPointId || !phaseGateOpen ||
    !canSelectAttendancePhoto(photoState)
  const gateMessage = !hasWorkPointId
    ? '请先保存工作点位，再选择照片。'
    : phase === 'after' && !afterEnabled
      ? '开工前照片经服务器确认后可选择完工照片。'
      : ''
  const phaseLabel = PHOTO_LABELS[phase]
  const actionPayload = () => createAttendancePhotoReservationAction(point, phase, photoState)

  const handleFileChange = (event) => {
    const file = event.currentTarget.files?.[0] || null
    event.currentTarget.value = ''
    if (!file || inputDisabled) return
    onSelectPhoto?.(createAttendancePhotoSelection(point, phase, file))
  }

  return (
    <section className={`attendance-photo-control attendance-photo-${phase}`}>
      <label htmlFor={inputId}>{phaseLabel}</label>
      <input
        id={inputId}
        className="attendance-photo-input"
        type="file"
        accept={ATTENDANCE_PHOTO_CONTENT_TYPES.join(',')}
        capture="environment"
        disabled={inputDisabled}
        aria-describedby={`${statusId}${gateMessage ? ` ${gateId}` : ''}`}
        onChange={handleFileChange}
      />
      <p
        id={statusId}
        className="attendance-photo-status"
        role="status"
        aria-live="polite"
      >
        {PHOTO_STATUS_LABELS[displayPhase] || PHOTO_STATUS_LABELS.idle}
      </p>
      {gateMessage ? (
        <p id={gateId} className="attendance-photo-guidance">{gateMessage}</p>
      ) : null}
      {photoState.phase === 'failed' ? (
        <p className="attendance-photo-error" role="alert">
          {PHOTO_STATUS_LABELS.failed}，请按当前可用操作继续。
        </p>
      ) : null}
      {activePhoto ? (
        <button
          className="attendance-photo-open"
          type="button"
          aria-label={`查看第 ${ordinal} 点位${phaseLabel}`}
          onClick={() => onOpenPhoto?.(activePhoto)}
        >
          查看{phaseLabel}
        </button>
      ) : null}
      {!readOnly && capabilities.canRetryFinalize ? (
        <button
          className="attendance-photo-retry"
          type="button"
          onClick={() => onRetryFinalize?.(actionPayload())}
        >
          重试确认
        </button>
      ) : null}
      {!readOnly && capabilities.canAbandon ? (
        <button
          className="attendance-photo-abandon"
          type="button"
          onClick={() => onAbandonPhoto?.(actionPayload())}
        >
          {photoState.failedStage === 'abandon' ? '重试放弃本次上传' : '放弃本次上传'}
        </button>
      ) : null}
    </section>
  )
}

export default function AttendanceWorkPointCard({
  point,
  ordinal,
  readOnly = false,
  saveState = { saving: false, error: '' },
  photoStates = {},
  onChange,
  onSave,
  onSelectPhoto,
  onRetryFinalize,
  onAbandonPhoto,
  onOpenPhoto,
}) {
  const areaId = useId()
  const workId = useId()
  const completionId = useId()
  const saveStatusId = useId()
  const [validationError, setValidationError] = useState('')
  const controlledPoint = point || {
    ordinal,
    areaName: '',
    workDescription: '',
    completionNote: '',
    photos: { before: null, after: null },
  }
  const beforeIsActive = photoMatchesPointPhase(
    controlledPoint.photos?.before,
    controlledPoint,
    'before',
    'active',
  )
  const saving = Boolean(saveState?.saving)
  const saveError = validationError || String(saveState?.error || '')

  const changeField = (field, value) => {
    setValidationError('')
    onChange?.(createAttendanceWorkPointChange(controlledPoint, ordinal, field, value))
  }

  const savePoint = () => {
    let normalizedPoint
    try {
      normalizedPoint = createAttendanceWorkPointSave(controlledPoint, ordinal)
      setValidationError('')
    } catch (error) {
      setValidationError(error?.message || '现场日志内容无效')
      return
    }
    onSave?.(normalizedPoint)
  }

  return (
    <article className="attendance-work-point-card" aria-labelledby={`${areaId}-heading`}>
      <header className="attendance-work-point-heading">
        <h3 id={`${areaId}-heading`}>第 {ordinal} 点位</h3>
      </header>

      <div className="attendance-work-point-fields">
        <label htmlFor={areaId}>工作区域</label>
        <input
          id={areaId}
          className="attendance-work-point-input"
          type="text"
          value={controlledPoint.areaName ?? ''}
          disabled={readOnly || saving}
          onChange={(event) => changeField('areaName', event.target.value)}
        />

        <label htmlFor={workId}>工作内容</label>
        <textarea
          id={workId}
          className="attendance-work-point-textarea"
          value={controlledPoint.workDescription ?? ''}
          disabled={readOnly || saving}
          onChange={(event) => changeField('workDescription', event.target.value)}
        />

        <label htmlFor={completionId}>完成说明</label>
        <textarea
          id={completionId}
          className="attendance-work-point-textarea"
          value={controlledPoint.completionNote ?? ''}
          disabled={readOnly || saving}
          onChange={(event) => changeField('completionNote', event.target.value)}
        />
      </div>

      {!readOnly ? (
        <button
          className="attendance-work-point-save"
          type="button"
          disabled={saving}
          aria-describedby={saveStatusId}
          onClick={savePoint}
        >
          {saving ? '保存中…' : '保存现场日志'}
        </button>
      ) : null}
      <p
        id={saveStatusId}
        className="attendance-work-point-save-status"
        role="status"
        aria-live="polite"
      >
        {saving ? '正在保存现场日志…' : '现场日志可分次保存。'}
      </p>
      {saveError ? (
        <p className="attendance-work-point-error" role="alert">{saveError}</p>
      ) : null}

      <div className="attendance-photo-grid">
        <AttendancePhotoControl
          point={controlledPoint}
          ordinal={ordinal}
          phase="before"
          state={photoStates.before}
          readOnly={readOnly}
          afterEnabled
          onSelectPhoto={onSelectPhoto}
          onRetryFinalize={onRetryFinalize}
          onAbandonPhoto={onAbandonPhoto}
          onOpenPhoto={onOpenPhoto}
        />
        <AttendancePhotoControl
          point={controlledPoint}
          ordinal={ordinal}
          phase="after"
          state={photoStates.after}
          readOnly={readOnly}
          afterEnabled={beforeIsActive}
          onSelectPhoto={onSelectPhoto}
          onRetryFinalize={onRetryFinalize}
          onAbandonPhoto={onAbandonPhoto}
          onOpenPhoto={onOpenPhoto}
        />
      </div>
    </article>
  )
}
