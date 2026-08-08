import { useMemo, useRef, useState } from 'react'

import { buildProjectRevenueReadModel } from '../contract-revenue/contractRevenueCalculations.js'
import { canCreate, canDelete, canEdit } from '../../utils/permissions.js'
import ProjectLocationPicker from './ProjectLocationPicker.jsx'
import {
  PROJECT_STATUS_OPTIONS,
  assignProjectEmployee,
  buildProjectPayload,
  confirmProjectLocation,
  createEmptyProject,
  eligibleProjectAssignees,
  isProjectLocationConfirmed,
  normalizeProject,
  updateProjectAddress,
  validateProjectForSave,
} from './projectDomain.js'
import { projectLocationService } from './projectLocationService.js'
import { canViewProjectFinancials } from './projectPermissions.js'

function formatYen(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? `¥${amount.toLocaleString('ja-JP')}` : '未录入'
}

function formatPercent(value) {
  return `${Math.round(Number(value) || 0)}%`
}

function Field({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  min,
  step,
  fullWidth = false,
}) {
  return (
    <label className={`field${fullWidth ? ' project-form-span-full' : ''}`}>
      <span>{label}</span>
      {type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          rows="3"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          min={min}
          step={step}
        />
      )}
    </label>
  )
}

function AssigneeSelect({
  label,
  role,
  value,
  snapshotName,
  candidates,
  loading,
  directoryError,
  onChange,
}) {
  if (directoryError) {
    return (
      <div className="field readonly-field">
        <span>{label}</span>
        <strong>{snapshotName || '未分配'}</strong>
      </div>
    )
  }

  const selectedStillEligible = candidates.some((employee) => employee.id === value)

  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(role, event.target.value)}
        disabled={loading}
      >
        <option value="">{loading ? '规范员工目录加载中…' : `请选择${label}`}</option>
        {value && !selectedStillEligible ? (
          <option value={value} disabled>
            {snapshotName || '原担当'}｜当前不可选
          </option>
        ) : null}
        {candidates.map((employee) => (
          <option value={employee.id} key={employee.id}>
            {employee.name}｜{employee.employeeNumber}｜{employee.department}
          </option>
        ))}
      </select>
    </label>
  )
}

function PaymentProgress({ project }) {
  const progress = Math.max(0, Math.min(Number(project.paymentProgress) || 0, 100))
  return (
    <div className="payment-progress">
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <strong>{formatPercent(project.paymentProgress)}</strong>
    </div>
  )
}

function revenueSnapshotFor(projectRevenueSnapshots, projectId) {
  if (projectRevenueSnapshots instanceof Map) return projectRevenueSnapshots.get(projectId)
  return projectRevenueSnapshots?.[projectId]
}

function ProjectFinancialDetails({ project, projectRevenueSnapshots }) {
  const displayProject = buildProjectRevenueReadModel(
    project,
    revenueSnapshotFor(projectRevenueSnapshots, project.projectId),
  )
  const adjustedAmount = Number(displayProject.adjustedTaxInclusiveAmount)
  const hasAmount = Number.isFinite(adjustedAmount) && adjustedAmount > 0

  return (
    <div className="project-financial-panel">
      <dl className="detail-list project-financial-details">
        <div>
          <dt>项目金额</dt>
          <dd>{hasAmount ? formatYen(adjustedAmount) : '未录入'}</dd>
        </div>
        <div>
          <dt>已收款</dt>
          <dd>{formatYen(displayProject.totalReceivedTaxInclusiveAmount)}</dd>
        </div>
        <div>
          <dt>收款进度</dt>
          <dd><PaymentProgress project={displayProject} /></dd>
        </div>
        <div>
          <dt>收款状态</dt>
          <dd>
            <span className={`payment-badge ${displayProject.paymentStatus}`}>
              {displayProject.paymentStatus}
            </span>
          </dd>
        </div>
      </dl>
    </div>
  )
}

export function ProjectPage({
  projects,
  projectRevenueSnapshots,
  currentUser,
  employeeDirectory,
  directoryState,
  onRetryDirectory,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onOpenContractRevenue,
  onBack,
}) {
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState('')
  const [form, setForm] = useState(() => createEmptyProject())
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingProjectId, setDeletingProjectId] = useState('')
  const locationSectionRef = useRef(null)

  const directoryLoading = directoryState?.loading === true
  const directoryError = directoryState?.error || ''
  const designCandidates = useMemo(
    () => eligibleProjectAssignees(employeeDirectory, 'design'),
    [employeeDirectory],
  )
  const siteCandidates = useMemo(
    () => eligibleProjectAssignees(employeeDirectory, 'site'),
    [employeeDirectory],
  )
  const canViewFinancials = canViewProjectFinancials(currentUser)
  const canCreateProject = canCreate(currentUser, '工程项目')
  const canUpdateProject = canEdit(currentUser, '工程项目')
  const canDeleteProject = canDelete(currentUser, '工程项目')

  const resetForm = () => {
    setForm(createEmptyProject())
    setEditingProjectId('')
    setError('')
    setIsFormOpen(false)
  }

  const openCreateForm = () => {
    setForm(createEmptyProject())
    setEditingProjectId('')
    setError('')
    setIsFormOpen(true)
  }

  const handleAssigneeChange = (role, employeeId) => {
    const candidates = role === 'design' ? designCandidates : siteCandidates
    const employee = candidates.find((candidate) => candidate.id === employeeId) || null
    setForm((current) => ({
      ...current,
      ...assignProjectEmployee(current, role, employee),
    }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const issues = validateProjectForSave(form)
    if (issues.length > 0) {
      setError(issues[0].message)
      if (issues[0].field === 'location') locationSectionRef.current?.focus()
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = buildProjectPayload(form)
      if (editingProjectId) await onUpdateProject(editingProjectId, payload)
      else await onCreateProject(payload)
      resetForm()
    } catch (operationError) {
      setError(
        operationError?.name === 'ProjectServiceError'
          ? operationError.message
          : '项目保存失败，请稍后重试',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (project) => {
    setEditingProjectId(project.projectId)
    setForm(normalizeProject(project))
    setError('')
    setIsFormOpen(true)
  }

  const handleDelete = async (projectId) => {
    if (!window.confirm('确定删除这个工程项目吗？')) return
    setDeletingProjectId(projectId)
    setListError('')
    try {
      await onDeleteProject(projectId)
    } catch (operationError) {
      setListError(
        operationError?.name === 'ProjectServiceError'
          ? operationError.message
          : '项目删除失败，请稍后重试',
      )
    } finally {
      setDeletingProjectId('')
    }
  }

  const handleDirectoryRetry = async () => {
    try {
      await onRetryDirectory()
    } catch {
      // App owns the safe retry message in directoryState.
    }
  }

  return (
    <main className="app-shell page-shell project-page">
      <header className="page-header">
        <button className="back-button" type="button" onClick={onBack}>
          返回首页
        </button>
        <div>
          <p className="eyebrow dark-text">项目主数据</p>
          <h1>工程项目</h1>
        </div>
        {canCreateProject ? (
          <div className="page-action">
            <button className="primary-button" type="button" onClick={openCreateForm}>
              新增项目
            </button>
          </div>
        ) : null}
      </header>

      {isFormOpen ? (
        <form className="form-panel project-form-panel" onSubmit={handleSubmit}>
          <div className="project-form-heading">
            <div>
              <span>{editingProjectId ? '编辑项目' : '新增项目'}</span>
              <strong>基础资料与施工定位</strong>
            </div>
            <small>进入待开工或进行中前，必须确认施工位置。</small>
          </div>

          {error ? <p className="project-form-error" role="alert">{error}</p> : null}

          <div className="form-grid project-form-grid">
            <Field
              label="项目名称"
              value={form.projectName}
              onChange={(value) => setForm((current) => ({ ...current, projectName: value }))}
              placeholder="例如 森下702空调安装"
              required
            />
            <Field
              label="客户名称"
              value={form.customerName}
              onChange={(value) => setForm((current) => ({ ...current, customerName: value }))}
              placeholder="例如 客户A"
            />

            <div
              className="project-location-form-section project-form-span-full"
              ref={locationSectionRef}
              tabIndex="-1"
            >
              <div className="project-location-form-title">
                <strong>地址定位与打卡范围</strong>
                <span>办公室填写地址后，再通过地图确认实际施工位置。</span>
              </div>
              <Field
                label="项目地址"
                value={form.address}
                onChange={(value) => setForm((current) => updateProjectAddress(current, value))}
                placeholder="例如 東京都江東区森下4-17-5"
                fullWidth
              />
              <ProjectLocationPicker
                key={editingProjectId || 'create'}
                address={form.address}
                latitude={form.latitude}
                longitude={form.longitude}
                attendanceRadiusMeters={form.attendanceRadiusMeters}
                confirmed={isProjectLocationConfirmed(form)}
                locateAddress={projectLocationService.locateAddress}
                onLocationConfirmed={({ latitude, longitude, confirmedAt }) => {
                  setForm((current) => confirmProjectLocation(
                    current,
                    { latitude, longitude },
                    confirmedAt,
                  ))
                }}
                onRadiusChange={(value) => setForm((current) => ({
                  ...current,
                  attendanceRadiusMeters: value,
                }))}
              />
              <div className="project-radius-field">
                <Field
                  label="打卡范围（米）"
                  type="number"
                  min="1"
                  step="1"
                  value={form.attendanceRadiusMeters}
                  onChange={(value) => setForm((current) => ({
                    ...current,
                    attendanceRadiusMeters: value,
                  }))}
                />
                <p>默认 300 米；地图圆圈会随范围同步变化。</p>
              </div>
            </div>

            <label className="field">
              <span>项目状态</span>
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  status: event.target.value,
                }))}
              >
                {PROJECT_STATUS_OPTIONS.map((status) => (
                  <option value={status} key={status}>{status}</option>
                ))}
              </select>
            </label>
            <AssigneeSelect
              label="设计担当"
              role="design"
              value={form.designAssigneeEmployeeId}
              snapshotName={form.designAssigneeName}
              candidates={designCandidates}
              loading={directoryLoading}
              directoryError={directoryError}
              onChange={handleAssigneeChange}
            />
            <AssigneeSelect
              label="现场担当"
              role="site"
              value={form.siteAssigneeEmployeeId}
              snapshotName={form.siteAssigneeName}
              candidates={siteCandidates}
              loading={directoryLoading}
              directoryError={directoryError}
              onChange={handleAssigneeChange}
            />

            {directoryError ? (
              <div className="project-directory-error project-form-span-full" role="alert">
                <div>
                  <strong>规范员工目录加载失败</strong>
                  <span>{directoryError}</span>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={handleDirectoryRetry}
                  disabled={directoryLoading}
                >
                  重试
                </button>
              </div>
            ) : null}

            <Field
              label="开工日期"
              type="date"
              value={form.startDate}
              onChange={(value) => setForm((current) => ({ ...current, startDate: value }))}
            />
            <Field
              label="工程结束日期"
              type="date"
              value={form.endDate}
              onChange={(value) => setForm((current) => ({ ...current, endDate: value }))}
            />
            <Field
              label="备注"
              type="textarea"
              value={form.remark}
              onChange={(value) => setForm((current) => ({ ...current, remark: value }))}
              placeholder="可填写施工范围、注意事项等"
              fullWidth
            />
          </div>

          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? '保存中…' : editingProjectId ? '保存修改' : '保存项目'}
            </button>
            <button className="ghost-button" type="button" onClick={resetForm} disabled={saving}>
              取消
            </button>
          </div>
        </form>
      ) : null}

      {listError ? <p className="project-form-error" role="alert">{listError}</p> : null}

      <div className="record-list project-record-list">
        {projects.length === 0 ? (
          <div className="empty-state">暂无工程项目，请先新增项目</div>
        ) : (
          projects.map((rawProject) => {
            const project = normalizeProject(rawProject)
            const locationConfirmed = isProjectLocationConfirmed(project)
            return (
              <article className="record-card project-record-card" key={project.projectId}>
                <div className="record-header">
                  <div>
                    <strong>{project.projectName}</strong>
                    <span>{project.projectId}</span>
                  </div>
                  <span className={`status-badge ${project.status}`}>{project.status}</span>
                </div>

                <dl className="detail-list project-master-details">
                  <div><dt>客户</dt><dd>{project.customerName || '未填写'}</dd></div>
                  <div><dt>地址</dt><dd>{project.address || '未填写'}</dd></div>
                  <div>
                    <dt>定位状态</dt>
                    <dd className={locationConfirmed ? 'project-location-ok' : 'project-location-pending'}>
                      {locationConfirmed ? '已确认' : '未确认'}
                    </dd>
                  </div>
                  <div><dt>打卡范围</dt><dd>{project.attendanceRadiusMeters} 米</dd></div>
                  <div><dt>设计担当</dt><dd>{project.designAssigneeName || '未分配'}</dd></div>
                  <div><dt>现场担当</dt><dd>{project.siteAssigneeName || '未分配'}</dd></div>
                  {!project.siteAssigneeName && project.manager ? (
                    <div><dt>历史负责人</dt><dd>{project.manager}</dd></div>
                  ) : null}
                  <div><dt>开工日期</dt><dd>{project.startDate || '未填写'}</dd></div>
                  <div><dt>工程结束日期</dt><dd>{project.endDate || '未结束'}</dd></div>
                  {project.remark ? <div><dt>备注</dt><dd>{project.remark}</dd></div> : null}
                </dl>

                {canViewFinancials ? (
                  <ProjectFinancialDetails
                    project={rawProject}
                    projectRevenueSnapshots={projectRevenueSnapshots}
                  />
                ) : null}

                <div className="record-actions">
                  {canViewFinancials ? (
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => onOpenContractRevenue(project.projectId)}
                    >
                      合同收入
                    </button>
                  ) : null}
                  {canUpdateProject ? (
                    <button className="ghost-button" type="button" onClick={() => handleEdit(project)}>
                      编辑
                    </button>
                  ) : null}
                  {canDeleteProject ? (
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => handleDelete(project.projectId)}
                      disabled={deletingProjectId === project.projectId}
                    >
                      {deletingProjectId === project.projectId ? '删除中…' : '删除'}
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })
        )}
      </div>
    </main>
  )
}

export default ProjectPage
