import ProjectLocationPicker from './ProjectLocationPicker.jsx'
import {
  MIRAISYA_CUSTOMER_NAME,
  PROJECT_STATUS_OPTIONS,
  PROJECT_TYPES,
  confirmProjectLocation,
  isProjectLocationConfirmed,
  updateProjectAddress,
} from './projectDomain.js'
import { projectLocationService } from './projectLocationService.js'

function activeEmployees(employees) {
  return (Array.isArray(employees) ? employees : []).filter((employee) =>
    employee &&
    employee.employmentStatus === '在职' &&
    employee.accountStatus === 'active' &&
    typeof employee.id === 'string' &&
    typeof employee.employeeNumber === 'string' &&
    typeof employee.name === 'string'
  )
}

function updateWorkerAssignments(value, employee, selected) {
  const current = Array.isArray(value.workerAssignments) ? value.workerAssignments : []
  const withoutEmployee = current.filter((item) => item.employeeId !== employee.id)
  return selected
    ? [...withoutEmployee, {
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        name: employee.name,
      }]
    : withoutEmployee
}

export default function LightweightProjectForm({
  projectType,
  value,
  employees,
  disabled = false,
  error = '',
  editing = false,
  onChange,
  onSubmit,
  onCancel,
}) {
  const isMiraisya = projectType === PROJECT_TYPES.MIRAISYA
  const availableEmployees = activeEmployees(employees)
  const leaderCandidates = availableEmployees.filter((employee) =>
    employee.department === '工程部'
  )
  const selectedWorkerIds = new Set(
    (Array.isArray(value.workerAssignments) ? value.workerAssignments : [])
      .map((assignment) => assignment.employeeId),
  )

  const setValue = (patch) => onChange({ ...value, ...patch })

  return (
    <form className="form-panel project-form-panel lightweight-project-form" onSubmit={onSubmit}>
      <div className="project-form-heading">
        <div>
          <span>{editing ? '编辑项目' : isMiraisya ? '新增未来社项目' : '新增小项目'}</span>
          <strong>{isMiraisya ? '未来社简化项目资料' : '小项目简化资料'}</strong>
        </div>
        <small>适合半天或一天完成的安装、补修、更换等工程。</small>
      </div>

      {error ? <p className="project-form-error" role="alert">{error}</p> : null}

      <div className="form-grid project-form-grid">
        <label className="field">
          <span>项目名称</span>
          <input
            value={value.projectName}
            onChange={(event) => setValue({ projectName: event.target.value })}
            placeholder="例如 空调安装或壁纸补修"
            required
            disabled={disabled}
          />
        </label>

        <label className="field">
          <span>客户名称</span>
          <input
            value={isMiraisya ? MIRAISYA_CUSTOMER_NAME : value.customerName}
            onChange={(event) => setValue({ customerName: event.target.value })}
            readOnly={isMiraisya}
            disabled={disabled}
            placeholder="请输入客户名称"
          />
        </label>

        <div className="project-location-form-section project-form-span-full">
          <div className="project-location-form-title">
            <strong>项目地址与施工定位</strong>
            <span>地址变更后请重新确认地图位置，供项目考勤使用。</span>
          </div>
          <label className="field">
            <span>项目地址</span>
            <input
              value={value.address}
              onChange={(event) => onChange(updateProjectAddress(value, event.target.value))}
              placeholder="例如 東京都江東区森下4-17-5"
              disabled={disabled}
            />
          </label>
          <ProjectLocationPicker
            key={value.projectId || projectType}
            address={value.address}
            latitude={value.latitude}
            longitude={value.longitude}
            attendanceRadiusMeters={value.attendanceRadiusMeters}
            confirmed={isProjectLocationConfirmed(value)}
            locateAddress={projectLocationService.locateAddress}
            onLocationConfirmed={({ latitude, longitude, confirmedAt }) => {
              onChange(confirmProjectLocation(value, { latitude, longitude }, confirmedAt))
            }}
            onRadiusChange={(attendanceRadiusMeters) => setValue({ attendanceRadiusMeters })}
          />
        </div>

        <label className="field">
          <span>施工日期</span>
          <input
            type="date"
            value={value.startDate}
            onChange={(event) => setValue({ startDate: event.target.value })}
            required
            disabled={disabled}
          />
        </label>

        <label className="field">
          <span>工期</span>
          <select
            value={value.durationType}
            onChange={(event) => setValue({ durationType: event.target.value })}
            disabled={disabled}
          >
            <option value="half_day">半天</option>
            <option value="full_day">全天</option>
          </select>
        </label>

        <label className="field">
          <span>负责人</span>
          <select
            value={value.siteAssigneeEmployeeId}
            onChange={(event) => {
              const employee = leaderCandidates.find((item) => item.id === event.target.value)
              setValue(employee ? {
                siteAssigneeEmployeeId: employee.id,
                siteAssigneeEmployeeNumber: employee.employeeNumber,
                siteAssigneeName: employee.name,
              } : {
                siteAssigneeEmployeeId: '',
                siteAssigneeEmployeeNumber: '',
                siteAssigneeName: '',
              })
            }}
            disabled={disabled}
          >
            <option value="">请选择负责人</option>
            {leaderCandidates.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}｜{employee.employeeNumber}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="field lightweight-worker-field" disabled={disabled}>
          <legend>施工人员</legend>
          <div className="lightweight-worker-options">
            {availableEmployees.length === 0 ? <span>暂无可选人员</span> : null}
            {availableEmployees.map((employee) => (
              <label key={employee.id}>
                <input
                  type="checkbox"
                  checked={selectedWorkerIds.has(employee.id)}
                  onChange={(event) => setValue({
                    workerAssignments: updateWorkerAssignments(
                      value,
                      employee,
                      event.target.checked,
                    ),
                  })}
                />
                <span>{employee.name}｜{employee.employeeNumber}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {projectType === PROJECT_TYPES.SMALL && (
          <label className="field">
            <span>预计金额</span>
            <input
              type="number"
              min="0"
              step="1"
              value={value.expectedAmount}
              onChange={(event) => setValue({ expectedAmount: Number(event.target.value) || 0 })}
              disabled={disabled}
            />
          </label>
        )}

        <label className="field">
          <span>项目状态</span>
          <select
            value={value.status}
            onChange={(event) => setValue({ status: event.target.value })}
            disabled={disabled}
          >
            {PROJECT_STATUS_OPTIONS.map((status) => (
              <option value={status} key={status}>{status}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>结算状态</span>
          <select
            value={value.lightweightSettlementStatus}
            onChange={(event) => setValue({
              lightweightSettlementStatus: event.target.value,
            })}
            disabled={disabled || isMiraisya}
          >
            <option value="unsettled">未结算</option>
            <option value="settled">已结算</option>
          </select>
        </label>

        <label className="field project-form-span-full">
          <span>备注</span>
          <textarea
            value={value.remark}
            onChange={(event) => setValue({ remark: event.target.value })}
            rows="3"
            placeholder="填写施工内容、注意事项等"
            disabled={disabled}
          />
        </label>

        <div className="lightweight-attachment-entry project-form-span-full">
          <strong>现场照片与附件</strong>
          <span>保存项目后，可在项目档案中继续上传和管理照片、图纸及凭证。</span>
        </div>
      </div>

      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={disabled}>
          {disabled ? '保存中…' : editing ? '保存修改' : '保存项目'}
        </button>
        <button className="ghost-button" type="button" onClick={onCancel} disabled={disabled}>
          取消
        </button>
      </div>
    </form>
  )
}
