import AttendanceWorkPointCard from './AttendanceWorkPointCard.jsx'

const TOKYO_TIME_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function TokyoTime({ value }) {
  const date = new Date(value)
  const label = Number.isFinite(date.getTime())
    ? TOKYO_TIME_FORMATTER.format(date)
    : '时间无效'
  return <time dateTime={value}>{label}</time>
}

function AttendanceEvent({ label, event }) {
  if (!event) return null
  const resultLabel = event.result === 'abnormal' ? '异常' : '正常'
  return (
    <div className="attendance-history-event">
      <p>
        <strong>{label}：{resultLabel}</strong>
        {' '}
        <TokyoTime value={event.serverRecordedAt} />
      </p>
      {event.result === 'abnormal' && event.abnormalReason ? (
        <p className="attendance-history-reason">原因：{event.abnormalReason}</p>
      ) : null}
    </div>
  )
}

export default function TodayAttendanceHistory({
  completedSessions,
  onOpenPhoto,
}) {
  const closedSessions = (Array.isArray(completedSessions) ? completedSessions : [])
    .filter((attendanceSession) => attendanceSession?.status === 'closed')
  const openPhoto = (photo) => onOpenPhoto?.(photo)

  return (
    <section className="attendance-history" aria-labelledby="attendance-history-heading">
      <header className="attendance-history-heading">
        <p className="attendance-history-eyebrow">今日已完成</p>
        <h2 id="attendance-history-heading">今日场次记录</h2>
      </header>

      {closedSessions.length === 0 ? (
        <p className="attendance-history-empty" role="status" aria-live="polite">
          今日暂无结束场次。
        </p>
      ) : closedSessions.map((attendanceSession) => (
        <article
          className="attendance-history-session"
          key={attendanceSession.sessionId}
          aria-labelledby={`attendance-history-${attendanceSession.sessionId}`}
        >
          <header className="attendance-history-session-heading">
            <h3 id={`attendance-history-${attendanceSession.sessionId}`}>
              {attendanceSession.projectNameSnapshot}
            </h3>
            <p>{attendanceSession.projectAddressSnapshot}</p>
          </header>

          <div className="attendance-history-events">
            <AttendanceEvent label="上班" event={attendanceSession.clockInEvent} />
            <AttendanceEvent label="下班" event={attendanceSession.clockOutEvent} />
          </div>

          <div className="attendance-work-point-grid">
            {[...(attendanceSession.workPoints || [])]
              .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
              .slice(0, 7)
              .map((workPoint) => (
                <AttendanceWorkPointCard
                  key={workPoint.workPointId || workPoint.ordinal}
                  point={workPoint}
                  ordinal={workPoint.ordinal}
                  readOnly
                  photoStates={{}}
                  onOpenPhoto={openPhoto}
                />
              ))}
          </div>
        </article>
      ))}
    </section>
  )
}
