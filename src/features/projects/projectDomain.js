export const PROJECT_STATUS_OPTIONS = Object.freeze([
  '报价中', '设计中', '待开工', '进行中', '暂停', '已完工', '已取消',
])
export const DEFAULT_ATTENDANCE_RADIUS_METERS = 300
const LOCATION_REQUIRED = new Set(['待开工', '进行中'])
const ROLE_CONFIG = Object.freeze({
  design: { department: '设计部', prefix: 'designAssignee', label: '设计担当' },
  site: { department: '工程部', prefix: 'siteAssignee', label: '现场担当' },
})

export function normalizeAddress(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

export function localDateValue(date = new Date()) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

export function createEmptyProject(today = () => localDateValue()) {
  return normalizeProject({ startDate: today() })
}

function parseCoordinate(value, minimum, maximum) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && !value.trim())
  ) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null
}

export function normalizeProject(project = {}) {
  const radius = Number(project.attendanceRadiusMeters)
  return {
    ...project,
    projectId: project.projectId || '',
    projectName: project.projectName || '',
    customerName: project.customerName || '',
    address: project.address || '',
    latitude: parseCoordinate(project.latitude, -90, 90),
    longitude: parseCoordinate(project.longitude, -180, 180),
    attendanceRadiusMeters: Number.isFinite(radius) && radius > 0
      ? radius
      : DEFAULT_ATTENDANCE_RADIUS_METERS,
    locationConfirmedAt: project.locationConfirmedAt || '',
    locationAddressSnapshot: project.locationAddressSnapshot || '',
    status: PROJECT_STATUS_OPTIONS.includes(project.status) ? project.status : '报价中',
    ...(Object.hasOwn(project, 'manager') ? { manager: project.manager || '' } : {}),
    designAssigneeEmployeeId: project.designAssigneeEmployeeId || '',
    designAssigneeEmployeeNumber: project.designAssigneeEmployeeNumber || '',
    designAssigneeName: project.designAssigneeName || '',
    siteAssigneeEmployeeId: project.siteAssigneeEmployeeId || '',
    siteAssigneeEmployeeNumber: project.siteAssigneeEmployeeNumber || '',
    siteAssigneeName: project.siteAssigneeName || '',
    startDate: project.startDate || '',
    endDate: project.endDate || '',
    remark: project.remark || '',
  }
}

export function isProjectLocationConfirmed(project) {
  const value = normalizeProject(project)
  return Boolean(
    normalizeAddress(value.address) &&
    value.latitude !== null &&
    value.longitude !== null &&
    value.attendanceRadiusMeters > 0 &&
    value.locationConfirmedAt &&
    normalizeAddress(value.locationAddressSnapshot) === normalizeAddress(value.address)
  )
}

export function updateProjectAddress(project, address) {
  const nextAddress = typeof address === 'string' ? address : ''
  return {
    ...project,
    address: nextAddress,
    locationConfirmedAt:
      normalizeAddress(nextAddress) === normalizeAddress(project?.address)
        ? project?.locationConfirmedAt || ''
        : '',
  }
}

export function confirmProjectLocation(project, point, confirmedAt) {
  const latitude = parseCoordinate(point?.latitude, -90, 90)
  const longitude = parseCoordinate(point?.longitude, -180, 180)
  if (
    latitude === null ||
    longitude === null ||
    !normalizeAddress(project?.address) ||
    typeof confirmedAt !== 'string' || !confirmedAt
  ) throw new TypeError('定位确认数据无效')
  return {
    ...project,
    latitude,
    longitude,
    locationConfirmedAt: confirmedAt,
    locationAddressSnapshot: normalizeAddress(project.address),
  }
}

function isEligible(employee, role) {
  const config = ROLE_CONFIG[role]
  return Boolean(
    config &&
    employee &&
    employee.department === config.department &&
    employee.employmentStatus === '在职' &&
    employee.accountStatus === 'active' &&
    typeof employee.id === 'string' &&
    typeof employee.employeeNumber === 'string' &&
    typeof employee.name === 'string'
  )
}

export function eligibleProjectAssignees(directory, role) {
  return (Array.isArray(directory) ? directory : []).filter((employee) =>
    isEligible(employee, role)
  )
}

export function assignProjectEmployee(project, role, employee) {
  const config = ROLE_CONFIG[role]
  if (!config) throw new TypeError('担当类型无效')
  const prefix = config.prefix
  if (employee === null) {
    return {
      [prefix + 'EmployeeId']: '',
      [prefix + 'EmployeeNumber']: '',
      [prefix + 'Name']: '',
    }
  }
  if (!isEligible(employee, role)) throw new TypeError(config.label + '候选员工无效')
  return {
    [prefix + 'EmployeeId']: employee.id,
    [prefix + 'EmployeeNumber']: employee.employeeNumber,
    [prefix + 'Name']: employee.name,
  }
}

export function validateProjectForSave(project) {
  const value = normalizeProject(project)
  if (!value.projectName.trim()) {
    return [{ field: 'projectName', code: 'project_name_required', message: '请填写项目名称' }]
  }
  if (LOCATION_REQUIRED.has(value.status) && !isProjectLocationConfirmed(value)) {
    return [{
      field: 'location',
      code: 'location_required',
      message: '待开工或进行中的项目必须先确认施工位置和打卡范围',
    }]
  }
  return []
}

export function buildProjectPayload(project) {
  const value = normalizeProject(project)
  return Object.fromEntries([
    'projectName', 'customerName', 'address', 'latitude', 'longitude',
    'attendanceRadiusMeters', 'locationConfirmedAt', 'locationAddressSnapshot',
    'status', 'designAssigneeEmployeeId', 'designAssigneeEmployeeNumber',
    'designAssigneeName', 'siteAssigneeEmployeeId',
    'siteAssigneeEmployeeNumber', 'siteAssigneeName', 'startDate', 'endDate', 'remark',
  ].map((key) => [key, value[key]]))
}
