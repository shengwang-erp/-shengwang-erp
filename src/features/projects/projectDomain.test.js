import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_ATTENDANCE_RADIUS_METERS,
  PROJECT_STATUS_OPTIONS,
  assignProjectEmployee,
  confirmProjectLocation,
  createEmptyProject,
  eligibleProjectAssignees,
  isProjectLocationConfirmed,
  localDateValue,
  normalizeAddress,
  normalizeProject,
  updateProjectAddress,
  validateProjectForSave,
  buildProjectPayload,
} from './projectDomain.js'

const design = {
  id: '11111111-1111-4111-8111-111111111111',
  employeeNumber: 'SW-101',
  name: '设计一',
  department: '设计部',
  position: '设计师',
  employmentStatus: '在职',
  accountStatus: 'active',
}
const site = {
  ...design,
  id: '22222222-2222-4222-8222-222222222222',
  employeeNumber: 'SW-202',
  name: '现场一',
  department: '工程部',
  position: '职长',
}

test('status order and new-project defaults are exact', () => {
  assert.deepEqual(PROJECT_STATUS_OPTIONS, [
    '报价中', '设计中', '待开工', '进行中', '暂停', '已完工', '已取消',
  ])
  assert.deepEqual(createEmptyProject(() => '2026-07-15'), {
    projectId: '',
    projectName: '',
    customerName: '',
    address: '',
    latitude: null,
    longitude: null,
    attendanceRadiusMeters: 300,
    locationConfirmedAt: '',
    locationAddressSnapshot: '',
    status: '报价中',
    designAssigneeEmployeeId: '',
    designAssigneeEmployeeNumber: '',
    designAssigneeName: '',
    siteAssigneeEmployeeId: '',
    siteAssigneeEmployeeNumber: '',
    siteAssigneeName: '',
    startDate: '2026-07-15',
    endDate: '',
    remark: '',
  })
})

test('default date formatting uses local calendar getters instead of UTC ISO', () => {
  assert.equal(localDateValue({
    getFullYear: () => 2026,
    getMonth: () => 6,
    getDate: () => 15,
  }), '2026-07-15')
})

test('address normalization safely coerces values and canonicalizes whitespace', () => {
  assert.equal(normalizeAddress(null), '')
  assert.equal(normalizeAddress(undefined), '')
  assert.equal(normalizeAddress(123), '123')
  assert.equal(normalizeAddress('　東京都\t江東区　'), '東京都 江東区')
})

test('old projects normalize location fields and retain manager', () => {
  const project = normalizeProject({
    projectId: 'P001',
    manager: '旧负责人',
    latitude: null,
    longitude: '',
  })
  assert.equal(project.latitude, null)
  assert.equal(project.longitude, null)
  assert.equal(project.attendanceRadiusMeters, DEFAULT_ATTENDANCE_RADIUS_METERS)
  assert.equal(project.manager, '旧负责人')
  assert.equal(project.siteAssigneeName, '')
})

test('address edits preserve coordinates but invalidate confirmation', () => {
  const confirmed = confirmProjectLocation(
    { ...createEmptyProject(), address: '東京都江東区森下4-17-5' },
    { latitude: 35.687, longitude: 139.8 },
    '2026-07-15T01:02:03.000Z',
  )
  assert.equal(isProjectLocationConfirmed(confirmed), true)
  const changed = updateProjectAddress(confirmed, '東京都江東区森下4-17-6')
  assert.equal(changed.latitude, confirmed.latitude)
  assert.equal(changed.longitude, confirmed.longitude)
  assert.equal(changed.locationConfirmedAt, '')
  assert.equal(isProjectLocationConfirmed(changed), false)
  assert.equal(
    isProjectLocationConfirmed(updateProjectAddress(changed, confirmed.address)),
    false,
  )
  assert.equal(
    updateProjectAddress(confirmed, '　東京都江東区森下4-17-5　').locationConfirmedAt,
    confirmed.locationConfirmedAt,
  )
})

test('location confirmation rejects missing, null, empty, and whitespace coordinates', () => {
  const project = { ...createEmptyProject(), address: '東京都江東区森下4-17-5' }
  const confirmedAt = '2026-07-15T01:02:03.000Z'
  assert.throws(
    () => confirmProjectLocation(project, undefined, confirmedAt),
    /定位确认数据无效/,
  )
  for (const missing of [null, '', ' ', '\t']) {
    assert.throws(
      () => confirmProjectLocation(
        project,
        { latitude: missing, longitude: 139.8 },
        confirmedAt,
      ),
      /定位确认数据无效/,
    )
    assert.throws(
      () => confirmProjectLocation(
        project,
        { latitude: 35.687, longitude: missing },
        confirmedAt,
      ),
      /定位确认数据无效/,
    )
  }
})

test('location confirmation accepts explicitly provided numeric zero coordinates', () => {
  const confirmed = confirmProjectLocation(
    { ...createEmptyProject(), address: 'Null Island' },
    { latitude: 0, longitude: 0 },
    '2026-07-15T01:02:03.000Z',
  )
  assert.equal(confirmed.latitude, 0)
  assert.equal(confirmed.longitude, 0)
  assert.equal(isProjectLocationConfirmed(confirmed), true)
})

test('only active employed employees in the exact department are candidates', () => {
  const rows = [
    design,
    site,
    { ...design, id: '33333333-3333-4333-8333-333333333333', employmentStatus: '离职' },
    { ...site, id: '44444444-4444-4444-8444-444444444444', accountStatus: 'disabled' },
  ]
  assert.deepEqual(eligibleProjectAssignees(rows, 'design'), [design])
  assert.deepEqual(eligibleProjectAssignees(rows, 'site'), [site])
  assert.throws(() => assignProjectEmployee({}, 'design', site), /设计担当/)
  assert.deepEqual(assignProjectEmployee({}, 'site', site), {
    siteAssigneeEmployeeId: site.id,
    siteAssigneeEmployeeNumber: 'SW-202',
    siteAssigneeName: '现场一',
  })
})

test('pending-start and active status require confirmed current-address location', () => {
  for (const status of ['待开工', '进行中']) {
    const invalid = validateProjectForSave({
      ...createEmptyProject(),
      projectName: '测试项目',
      address: '東京都江東区',
      status,
    })
    assert.deepEqual(invalid[0], {
      field: 'location',
      code: 'location_required',
      message: '待开工或进行中的项目必须先确认施工位置和打卡范围',
    })
  }
  for (const status of ['报价中', '设计中', '暂停', '已完工', '已取消']) {
    assert.deepEqual(validateProjectForSave({
      ...createEmptyProject(),
      projectName: '测试项目',
      status,
    }), [])
  }
})

test('persistence payload excludes identity, financial, and unknown keys', () => {
  const payload = buildProjectPayload({
    ...createEmptyProject(),
    projectId: 'P999',
    projectName: '安全项目',
    adjustedTaxInclusiveAmount: 1100000,
    projectAmount: 1100000,
    unknownKey: 'reject-me',
  })
  assert.equal(payload.projectName, '安全项目')
  for (const key of [
    'projectId',
    'adjustedTaxInclusiveAmount',
    'projectAmount',
    'unknownKey',
  ]) assert.equal(Object.hasOwn(payload, key), false)
})
