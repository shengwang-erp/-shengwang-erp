import { useId } from 'react'

import { isAttendanceProjectEligible } from './attendanceDomain.js'

const EMPTY_PROJECT_MESSAGE = '暂无可打卡项目，请联系办公室完善项目定位。'

export function getEligibleAttendanceProjects(projects) {
  return Array.isArray(projects) ? projects.filter(isAttendanceProjectEligible) : []
}

export function notifyAttendanceProjectChange({
  projects,
  requestedProjectId,
  onChange,
}) {
  const projectId = getEligibleAttendanceProjects(projects)
    .some((project) => project.projectId === requestedProjectId)
    ? requestedProjectId
    : ''
  onChange?.(projectId)
  return projectId
}

export default function AttendanceProjectPicker({
  projects,
  selectedProjectId,
  disabled = false,
  hasOpenSession = false,
  onChange,
}) {
  const selectId = useId()
  const descriptionId = useId()
  const eligibleProjects = getEligibleAttendanceProjects(projects)
  const controlledProjectId = eligibleProjects.some(
    (project) => project.projectId === selectedProjectId,
  ) ? selectedProjectId : ''
  const selectionDisabled = disabled || hasOpenSession || eligibleProjects.length === 0
  const hasDescription = hasOpenSession || eligibleProjects.length === 0

  return (
    <section className="attendance-project-picker" aria-labelledby={`${selectId}-heading`}>
      <h2 id={`${selectId}-heading`} className="attendance-project-heading">选择打卡项目</h2>
      <label htmlFor={selectId}>项目名称</label>
      <select
        id={selectId}
        className="attendance-project-select"
        value={controlledProjectId}
        disabled={selectionDisabled}
        aria-describedby={hasDescription ? descriptionId : undefined}
        onChange={(event) => notifyAttendanceProjectChange({
          projects: eligibleProjects,
          requestedProjectId: event.target.value,
          onChange,
        })}
      >
        <option value="">请选择项目</option>
        {eligibleProjects.map((project) => (
          <option value={project.projectId} key={project.projectId}>
            {project.projectName}｜{project.address}｜打卡半径 {project.attendanceRadiusMeters} 米
          </option>
        ))}
      </select>
      {eligibleProjects.length === 0 ? (
        <p
          id={descriptionId}
          className="attendance-project-status"
          role="status"
          aria-live="polite"
        >
          {EMPTY_PROJECT_MESSAGE}
        </p>
      ) : hasOpenSession ? (
        <p
          id={descriptionId}
          className="attendance-project-status"
          role="status"
          aria-live="polite"
        >
          当前场次结束后可选择其他项目。
        </p>
      ) : null}
    </section>
  )
}
