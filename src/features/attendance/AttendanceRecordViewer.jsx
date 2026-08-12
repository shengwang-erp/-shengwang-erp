const isNonBlankString = (value) =>
  typeof value === 'string' && Boolean(value.trim())

const nullableFilter = (value) => isNonBlankString(value) ? value : null

export function normalizeAttendanceRecordCursor(cursor) {
  if (!isNonBlankString(cursor?.openedAt) || !isNonBlankString(cursor?.sessionId)) {
    return { beforeOpenedAt: null, beforeSessionId: null }
  }
  return {
    beforeOpenedAt: cursor.openedAt,
    beforeSessionId: cursor.sessionId,
  }
}

export function createAttendanceRecordQuery({
  workDate,
  projectId = null,
  employeeProfileId = null,
  cursor = null,
} = {}) {
  return {
    workDate,
    projectId: nullableFilter(projectId),
    employeeProfileId: nullableFilter(employeeProfileId),
    ...normalizeAttendanceRecordCursor(cursor),
    limit: 50,
  }
}

function normalizeFilters(filters, defaultWorkDate) {
  return {
    workDate: isNonBlankString(filters?.workDate) ? filters.workDate : defaultWorkDate,
    projectId: nullableFilter(filters?.projectId),
    employeeProfileId: nullableFilter(filters?.employeeProfileId),
  }
}

export function createAttendanceRecordViewerController({
  access,
  workDate,
  service,
  onState,
  onAuthInvalid,
} = {}) {
  const authorized = access?.canViewScopedRecords === true
  let mounted = true
  let generation = 0
  let loadMoreLock = null
  let state = {
    filters: normalizeFilters(null, workDate),
    access: { scope: access?.scope || 'own' },
    filterOptions: { projects: [], employees: [] },
    items: [],
    nextCursor: null,
    loading: false,
    errorCode: null,
  }
  const emit = () => onState?.(state)
  const fail = (error) => {
    if (error?.authInvalid === true) onAuthInvalid?.(error)
    state = {
      ...state,
      loading: false,
      errorCode: isNonBlankString(error?.code)
        ? error.code
        : 'ATTENDANCE_RECORDS_FAILED',
    }
    emit()
  }
  const acceptPage = (page, { append }) => {
    const items = append
      ? [...state.items, ...(Array.isArray(page.items) ? page.items : [])]
      : [...(Array.isArray(page.items) ? page.items : [])]
    const seen = new Set()
    state = {
      ...state,
      access: { scope: page.access.scope },
      filterOptions: page.filterOptions,
      items: items.filter((item) => {
        if (seen.has(item.sessionId)) return false
        seen.add(item.sessionId)
        return true
      }),
      nextCursor: page.nextCursor,
      loading: false,
      errorCode: null,
    }
    emit()
    return { status: 'accepted', state }
  }

  return Object.freeze({
    mount() {
      mounted = true
    },
    getState() {
      return state
    },
    async search(filters = state.filters) {
      if (!authorized) return { status: 'denied' }
      generation += 1
      const token = generation
      loadMoreLock = null
      state = {
        ...state,
        filters: normalizeFilters(filters, workDate),
        items: [],
        nextCursor: null,
        loading: true,
        errorCode: null,
      }
      emit()
      let page
      try {
        page = await service.listAttendanceRecords(createAttendanceRecordQuery({
          ...state.filters,
          cursor: null,
        }))
      } catch (error) {
        if (!mounted || token !== generation) return { status: 'stale' }
        fail(error)
        return { status: 'failed', errorCode: state.errorCode }
      }
      if (!mounted || token !== generation) return { status: 'stale' }
      return acceptPage(page, { append: false })
    },
    async loadMore() {
      if (!authorized) return { status: 'denied' }
      if (state.loading || loadMoreLock?.generation === generation) {
        return { status: 'busy' }
      }
      const pairedCursor = normalizeAttendanceRecordCursor(state.nextCursor)
      if (pairedCursor.beforeOpenedAt === null) return { status: 'done' }
      const token = generation
      const operationLock = { generation: token }
      loadMoreLock = operationLock
      const filterSignature = JSON.stringify(state.filters)
      const cursorSignature = JSON.stringify(state.nextCursor)
      try {
        let page
        try {
          page = await service.listAttendanceRecords(createAttendanceRecordQuery({
            ...state.filters,
            cursor: state.nextCursor,
          }))
        } catch (error) {
          if (!mounted || token !== generation) return { status: 'stale' }
          fail(error)
          return { status: 'failed', errorCode: state.errorCode }
        }
        if (!mounted || token !== generation ||
            filterSignature !== JSON.stringify(state.filters) ||
            cursorSignature !== JSON.stringify(state.nextCursor)) {
          return { status: 'stale' }
        }
        return acceptPage(page, { append: true })
      } finally {
        if (loadMoreLock === operationLock) loadMoreLock = null
      }
    },
    unmount() {
      mounted = false
      generation += 1
      loadMoreLock = null
    },
  })
}

export function resolveAttendanceRecordViewState(controller, envelope) {
  return envelope?.owner === controller
    ? envelope.state
    : controller.getState()
}

const TOKYO_RECORD_TIME_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatRecordTime(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? TOKYO_RECORD_TIME_FORMATTER.format(date)
    : '时间无效'
}

function AttendanceRecordEvent({ label, event }) {
  if (!event) return null
  return (
    <div className="attendance-record-event">
      <p>
        <strong>{label}：{event.result === 'not_applicable'
          ? '已记录'
          : event.result === 'abnormal' ? '异常' : '正常'}</strong>
        {' '}
        <time dateTime={event.serverRecordedAt}>{formatRecordTime(event.serverRecordedAt)}</time>
      </p>
      {event.result === 'abnormal' && event.abnormalReason ? (
        <p className="attendance-record-reason">原因：{event.abnormalReason}</p>
      ) : null}
    </div>
  )
}

function AttendanceRecordCard({ attendanceSession, onOpenPhoto }) {
  return (
    <article
      className="attendance-session-card attendance-record-card"
      aria-labelledby={`attendance-record-${attendanceSession.sessionId}`}
    >
      <header className="attendance-record-card-heading">
        <p>
          {attendanceSession.employeeNameSnapshot}（{attendanceSession.employeeNumberSnapshot}）
        </p>
        <h3 id={`attendance-record-${attendanceSession.sessionId}`}>
          {attendanceSession.attendanceMode === 'general'
            ? '公司 / 非项目'
            : attendanceSession.projectNameSnapshot}
        </h3>
        {attendanceSession.attendanceMode === 'project' ? (
          <p>{attendanceSession.projectAddressSnapshot}</p>
        ) : null}
      </header>
      <div className="attendance-record-events">
        <AttendanceRecordEvent label="上班" event={attendanceSession.clockInEvent} />
        <AttendanceRecordEvent label="下班" event={attendanceSession.clockOutEvent} />
      </div>
      {attendanceSession.attendanceMode === 'project' ? (
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
              onOpenPhoto={(photo) => onOpenPhoto?.(photo, {
                source: 'records',
                projectName: attendanceSession.projectNameSnapshot,
                employeeName: attendanceSession.employeeNameSnapshot,
                ordinal: workPoint.ordinal,
                phase: photo.phase,
              })}
            />
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function AttendanceRecordViewerView({
  state,
  onSearch,
  onLoadMore,
  onOpenPhoto,
}) {
  const filters = state.filters
  const options = state.filterOptions
  return (
    <section
      className="attendance-record-viewer"
      aria-labelledby="attendance-record-viewer-heading"
      data-scope={state.access.scope}
    >
      <header className="attendance-record-viewer-heading">
        <h2 id="attendance-record-viewer-heading">考勤记录</h2>
      </header>
      <div className="attendance-record-filters">
        <label htmlFor="attendance-record-date">日期</label>
        <input
          id="attendance-record-date"
          type="date"
          value={filters.workDate}
          disabled={state.loading}
          onChange={(event) => onSearch?.({ ...filters, workDate: event.target.value })}
        />
        <label htmlFor="attendance-record-project">项目筛选</label>
        <select
          id="attendance-record-project"
          value={filters.projectId || ''}
          disabled={state.loading}
          onChange={(event) => onSearch?.({ ...filters, projectId: event.target.value || null })}
        >
          <option value="">全部项目</option>
          {options.projects.map((project) => (
            <option key={project.projectId} value={project.projectId}>{project.projectName}</option>
          ))}
        </select>
        <label htmlFor="attendance-record-employee">员工筛选</label>
        <select
          id="attendance-record-employee"
          value={filters.employeeProfileId || ''}
          disabled={state.loading}
          onChange={(event) => onSearch?.({
            ...filters,
            employeeProfileId: event.target.value || null,
          })}
        >
          <option value="">全部员工</option>
          {options.employees.map((employee) => (
            <option key={employee.employeeProfileId} value={employee.employeeProfileId}>
              {employee.employeeNameSnapshot}（{employee.employeeNumberSnapshot}）
            </option>
          ))}
        </select>
      </div>
      <p className="attendance-record-status" role="status" aria-live="polite">
        {state.loading ? '正在读取考勤记录…' : `共 ${state.items.length} 条场次记录`}
      </p>
      {state.errorCode ? (
        <p className="attendance-error" role="alert">记录读取失败，请重试。</p>
      ) : null}
      <div className="attendance-record-list">
        {state.items.map((attendanceSession) => (
          <AttendanceRecordCard
            key={attendanceSession.sessionId}
            attendanceSession={attendanceSession}
            onOpenPhoto={onOpenPhoto}
          />
        ))}
      </div>
      {state.nextCursor ? (
        <button
          className="attendance-record-more"
          type="button"
          disabled={state.loading}
          onClick={() => onLoadMore?.()}
        >
          加载更多
        </button>
      ) : null}
    </section>
  )
}

export default function AttendanceRecordViewer({
  access,
  workDate,
  service,
  onAuthInvalid,
  onOpenPhoto,
} = {}) {
  const [envelope, setEnvelope] = useState({ owner: null, state: null })
  const controller = useMemo(() => {
    let createdController
    createdController = createAttendanceRecordViewerController({
      access,
      workDate,
      service,
      onAuthInvalid,
      onState: (state) => setEnvelope({ owner: createdController, state }),
    })
    return createdController
  }, [access?.canViewScopedRecords, access?.scope, onAuthInvalid, service, workDate])
  const viewState = resolveAttendanceRecordViewState(controller, envelope)

  useEffect(() => {
    controller.mount()
    if (access?.canViewScopedRecords === true) void controller.search()
    return () => controller.unmount()
  }, [access?.canViewScopedRecords, controller])

  if (access?.canViewScopedRecords !== true) return null
  return (
    <AttendanceRecordViewerView
      state={viewState}
      onSearch={(filters) => void controller.search(filters)}
      onLoadMore={() => void controller.loadMore()}
      onOpenPhoto={onOpenPhoto}
    />
  )
}
import { useEffect, useMemo, useState } from 'react'

import AttendanceWorkPointCard from './AttendanceWorkPointCard.jsx'
