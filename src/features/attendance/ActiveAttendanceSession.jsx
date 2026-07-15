import {
  MAX_ATTENDANCE_WORK_POINTS,
  canClockOut,
  createAttendanceWorkPointDraft,
} from './attendanceDomain.js'
import AttendanceLocationAction from './AttendanceLocationAction.jsx'
import AttendanceWorkPointCard from './AttendanceWorkPointCard.jsx'

export function getNextAttendanceWorkPointOrdinal(points) {
  const values = Array.isArray(points) ? points : []
  if (values.length >= MAX_ATTENDANCE_WORK_POINTS) return null
  const usedOrdinals = new Set(values.map((point) => Number(point?.ordinal)))
  for (let ordinal = 1; ordinal <= MAX_ATTENDANCE_WORK_POINTS; ordinal += 1) {
    if (!usedOrdinals.has(ordinal)) return ordinal
  }
  return null
}

function sortedDisplayPoints(points) {
  return [...(Array.isArray(points) ? points : [])]
    .sort((left, right) => Number(left?.ordinal) - Number(right?.ordinal))
    .slice(0, MAX_ATTENDANCE_WORK_POINTS)
}

export default function ActiveAttendanceSession({
  session,
  points,
  saveStates = {},
  photoStates = {},
  mutationPending = false,
  locationService,
  createRequestId,
  onAddPoint,
  onChangePoint,
  onSavePoint,
  onSelectPhoto,
  onRetryFinalize,
  onAbandonPhoto,
  onOpenPhoto,
  onClockOut,
  onClockOutSuccess,
}) {
  if (!session) return null
  const displayPoints = sortedDisplayPoints(points ?? session.workPoints)
  const nextOrdinal = getNextAttendanceWorkPointOrdinal(points ?? session.workPoints)
  const readOnly = session.status !== 'open'
  const serverCanClockOut = canClockOut(session.workPoints)
  const clockOutAllowed = !readOnly && serverCanClockOut
  const clockOutDisabledReason = readOnly
    ? '该项目场次已经结束。'
    : !serverCanClockOut
      ? '至少完成一个含开工前和完工照片的点位后可打卡下班。'
      : mutationPending
        ? '其他考勤操作正在处理中，请稍候。'
        : ''
  const clockOutTarget = {
    sessionId: session.sessionId,
    latitude: session.projectLatitudeSnapshot,
    longitude: session.projectLongitudeSnapshot,
    attendanceRadiusMeters: session.attendanceRadiusMetersSnapshot,
  }

  return (
    <section className="attendance-active-session" aria-labelledby={`attendance-session-${session.sessionId}`}>
      <header className="attendance-session-heading">
        <p className="attendance-session-eyebrow">当前项目场次</p>
        <h2 id={`attendance-session-${session.sessionId}`}>
          {session.projectNameSnapshot}
        </h2>
        <p className="attendance-session-address">{session.projectAddressSnapshot}</p>
      </header>

      <div className="attendance-work-point-grid">
        {displayPoints.map((workPoint) => {
          const stateKey = workPoint.workPointId || `ordinal-${workPoint.ordinal}`
          return (
            <AttendanceWorkPointCard
              key={stateKey}
              point={workPoint}
              ordinal={workPoint.ordinal}
              readOnly={readOnly || mutationPending}
              saveState={saveStates[workPoint.ordinal]}
              photoStates={{
                before: workPoint.workPointId
                  ? photoStates[`${workPoint.workPointId}:before`]
                  : undefined,
                after: workPoint.workPointId
                  ? photoStates[`${workPoint.workPointId}:after`]
                  : undefined,
              }}
              onChange={onChangePoint}
              onSave={onSavePoint}
              onSelectPhoto={onSelectPhoto}
              onRetryFinalize={onRetryFinalize}
              onAbandonPhoto={onAbandonPhoto}
              onOpenPhoto={onOpenPhoto}
            />
          )
        })}
      </div>

      {!readOnly && nextOrdinal !== null ? (
        <button
          className="attendance-work-point-add"
          type="button"
          disabled={mutationPending}
          onClick={() => onAddPoint?.(createAttendanceWorkPointDraft(nextOrdinal))}
        >
          添加工作点位
        </button>
      ) : null}

      <div className="attendance-clock-out">
        <AttendanceLocationAction
          action="clock_out"
          targetLocation={clockOutTarget}
          locationService={locationService}
          createRequestId={createRequestId}
          onSubmit={onClockOut}
          onSuccess={onClockOutSuccess}
          disabled={!clockOutAllowed || mutationPending}
          disabledReason={clockOutDisabledReason}
        />
      </div>
    </section>
  )
}
