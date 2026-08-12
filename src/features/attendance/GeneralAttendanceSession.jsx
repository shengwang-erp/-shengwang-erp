import AttendanceLocationAction from './AttendanceLocationAction.jsx'

const TOKYO_TIME_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function openedTime(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? TOKYO_TIME_FORMATTER.format(date) : '时间无效'
}

export default function GeneralAttendanceSession({
  session,
  mutationPending = false,
  locationService,
  createRequestId,
  onClockOut,
  onClockOutSuccess,
  onConfirmationRequired,
}) {
  if (!session) return null
  return (
    <section className="attendance-general-session attendance-session-card">
      <p className="attendance-session-eyebrow">公司考勤</p>
      <h2>今日已打卡上班</h2>
      <p>上班时间：<time dateTime={session.openedAt}>{openedTime(session.openedAt)}</time></p>
      <AttendanceLocationAction
        action="clock_out"
        attendanceMode="general"
        buttonLabel="按当前位置打卡下班"
        targetLocation={null}
        locationService={locationService}
        createRequestId={createRequestId}
        onSubmit={onClockOut}
        onSuccess={onClockOutSuccess}
        onConfirmationRequired={onConfirmationRequired}
        disabled={mutationPending || session.status !== 'open'}
        disabledReason={session.status !== 'open'
          ? '该公司考勤场次已经结束。'
          : '其他考勤操作正在处理中，请稍候。'}
      />
    </section>
  )
}
