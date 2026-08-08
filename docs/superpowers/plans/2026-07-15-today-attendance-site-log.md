# 今日打卡、现场日志与工具入口精简 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用安全的云端考勤域替换重复的一级“还工具”入口，让所有有效在职员工按项目分别完成实时定位上班、最多七个现场点位日志与照片、实时定位下班，并保留“借工具”页面内部完整的归还能力。

**Architecture:** 浏览器端严格拆分设备定位、非权威距离预览、RPC 数据访问、私有 Storage 对象传输和 React 页面状态；PostgreSQL 通过四张规范化业务表、固定 `SECURITY DEFINER` RPC、不可变打卡事件和 Storage RLS 执行最终身份、距离、完整点位及查看权限判定。现有 `labor_records`、工具归还数据和项目页面不参与新考勤写入；页面仅从专用安全 RPC 恢复服务器状态。

**Tech Stack:** React 19, Vite 6, Node `node:test`, Supabase JS 2.110.x, PostgreSQL/Supabase migrations, pgTAP, Supabase Storage, browser Geolocation API, scoped CSS

## Global Constraints

- “今日打卡”对所有已登录、在职、`account_status = 'active'`、`must_change_password = false` 且未删除的员工开放，不依赖任何模块权限。
- 工作日期和可信时间由服务器按 `Asia/Tokyo` 计算；客户端不能提交员工身份、工作日期、服务器时间、项目快照、距离或正常/异常结果。
- 每次新的上班或下班操作必须调用高精度定位，固定使用 `{ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }`；拒绝、超时或无有效坐标时不能用异常原因绕过。
- 最终正常判定严格为 `distance_meters + accuracy_meters <= radius_meters`；超范围必须提交去除首尾空白后 1–500 字符的异常原因。
- 每名员工同一时刻最多一个开放场次；同一天可以顺序完成多个项目，每个项目独立保存上班、日志和下班。
- 每个场次最多七个点位，每点位最多一张当前有效开工前照片和一张当前有效完工照片；下班只要求至少一个点位具备区域、工作内容、`active` 前照和 `active` 后照。
- 其他未使用或未补齐点位不阻止下班、不显示“资料未完整”或同义状态，已保存内容继续保留。
- 照片 bucket 固定为私有 `erp-attendance-photos`；单文件 `1..20 MiB`，只允许 JPEG、PNG、WEBP、HEIC、HEIF，签名 URL 固定 300 秒。
- 普通员工只读写本人开放场次；当前项目现场担当只读该项目全员记录；有效社长和 `SW-000` 只读全部记录；授权必须由数据库按实时项目担当执行。
- 四张考勤业务表不向浏览器开放直接 SELECT/INSERT/UPDATE/DELETE；业务读写只走准确授权的 RPC，Storage 只接受服务器预约的随机路径。
- 上下班事件成功写入后不可更新或删除；同一 `request_id` 网络重试必须返回同一事件，跨员工或跨事件类型复用必须拒绝。
- 一级菜单和首页卡片移除 `toolReturn`，在原位置放置 `todayAttendance`；`ToolManagementPage` 内部 `returns` 标签、`ToolReturnSection`、`toolReturnRecords`、历史和统计全部保留。
- 新功能不得写入 `labor_records`、`baseRecordService`、localStorage、sessionStorage 或 IndexedDB；不得新增 npm 依赖。
- 不修改或提交当前未跟踪的 `src/features/projects/ProjectPage.jsx`、`supabase/migrations/202607150002_project_documents.sql`、`supabase/tests/project_documents.sql`；`003` 不得依赖 `002` 的任何对象。
- `src/auth/AuthGate.jsx` 和 `docs/supabase-schema.md` 已有用户改动；只能做精确小块 patch，并在提交前用路径级 diff 确认未覆盖既有内容。新页面样式放入独立 `todayAttendance.css`，不修改当前脏的 `src/styles.css`。
- 在未完成的 `202607150002_project_documents.sql` 最终化前，不向共享或生产数据库应用 `003`；数据库验证应在不包含该未跟踪文件的隔离 worktree 中先证明只依赖已提交的 `001`。
- 提供仅 `service_role` 可调用的受控照片清理 worker：先原子领取过期非 active 元数据，再通过 Storage API 删除对象，最后删除 cleanup 元数据；浏览器仍无 DELETE，worker 代码随版本交付但本计划不授权生产部署或定时任务启用。

---

## File Structure

### New browser/domain files

- `src/features/attendance/attendanceDomain.js` — 严格项目资格、坐标、Haversine 预览、异常原因、点位输入和下班完整性纯函数。
- `src/features/attendance/attendanceDomain.test.js` — 纯业务边界测试。
- `src/features/attendance/attendancePhotoDomain.js` — 文件 MIME/大小/阶段校验与 canonical 元数据。
- `src/features/attendance/attendancePhotoDomain.test.js` — 五种 MIME、20 MiB 边界及 HEIC/HEIF 兼容测试。
- `src/features/attendance/attendanceLocationService.js` — 无缓存浏览器定位适配器和安全错误映射。
- `src/features/attendance/attendanceLocationService.test.js` — 每次 fresh 定位、参数、取消和错误测试。
- `src/features/attendance/attendancePhotoUploadState.js` — 单张照片 reserve/upload/finalize/abandon 生命周期 reducer。
- `src/features/attendance/attendancePhotoUploadState.test.js` — 网络不确定、重试和互不影响测试。

### New service files

- `src/services/attendanceService.js` — 九个安全 RPC 的唯一浏览器数据接口及严格 DTO 校验。
- `src/services/attendanceService.test.js` — 精确 RPC 名/参数、禁止伪造字段、幂等请求和错误白名单测试。
- `src/services/attendancePhotoStorage.js` — 仅上传预约对象及创建五分钟签名 URL。
- `src/services/attendancePhotoStorage.test.js` — bucket/path、`upsert:false`、无 public URL/DELETE 测试。
- `src/services/attendanceSchema.test.js` — 迁移、ACL、RPC、Storage policy 静态安全契约。

### New database files

- `supabase/migrations/202607150003_today_attendance.sql` — 四表、约束、索引、不可变触发器、私有 helper、九个 RPC、私有 bucket 和 bucket-scoped Storage policy。
- `supabase/tests/today_attendance.sql` — pgTAP 身份、定位、并发边界、日志、照片、下班及查看矩阵。
- `supabase/functions/attendance-photo-cleanup/handler.js` — 注入式、仅定时密钥可调用的非 active 对象清理编排。
- `supabase/functions/attendance-photo-cleanup/handler.test.js` — 鉴权、active 排除、失败保留和成功完成测试。
- `supabase/functions/attendance-photo-cleanup/index.ts` — Deno/Supabase Edge Function 入口和 service-role 客户端。

### New UI files

- `src/features/attendance/TodayAttendancePage.jsx` — 页面加载、服务器恢复、操作协调和视图切换。
- `src/features/attendance/AttendanceProjectPicker.jsx` — 合法项目选择和空列表提示。
- `src/features/attendance/AttendanceLocationAction.jsx` — 定位、客户端预览、异常原因、同请求重试。
- `src/features/attendance/ActiveAttendanceSession.jsx` — 当前场次和点位集合。
- `src/features/attendance/AttendanceWorkPointCard.jsx` — 点位文字与前后照片控件。
- `src/features/attendance/TodayAttendanceHistory.jsx` — 当天已完成多现场场次。
- `src/features/attendance/AttendanceRecordViewer.jsx` — 数据库授权的现场担当/全局管理查看。
- `src/features/attendance/todayAttendance.css` — `.attendance-*` 命名空间的桌面/移动布局。
- `src/features/attendance/todayAttendancePageContract.test.js` — 页面文案、可访问性、照片顺序和关闭只读契约。
- `src/features/attendance/todayAttendanceAppIntegration.test.js` — AuthGate、App、首页、桌面菜单和工具归还保留契约。

### Existing files modified surgically

- `src/auth/AuthGate.jsx` — 有效零模块权限员工进入 authenticated；保留强制改密和本地演示改动。
- `src/auth/frontendAuthContract.test.js` — 零权限员工不再被挡在业务 App 外。
- `src/DesktopAdminShell.jsx` — 原 `toolReturn` 位置改为始终可用的 `todayAttendance`。
- `src/desktopAdminShell.test.js` — 新菜单和工具内部归还契约。
- `src/App.jsx` — 条件加载项目、新路由、首页卡片和仅剩一个工具一级入口。
- `docs/today-attendance-operations.md` — 部署顺序、bucket、pgTAP/HTTP/浏览器验证及清理状态运维说明。

---

### Task 1: Strict attendance and photo domain rules

**Files:**
- Create: `src/features/attendance/attendanceDomain.js`
- Create: `src/features/attendance/attendanceDomain.test.js`
- Create: `src/features/attendance/attendancePhotoDomain.js`
- Create: `src/features/attendance/attendancePhotoDomain.test.js`

**Interfaces:**
- Consumes: `normalizeAddress(value: unknown): string` from `src/features/projects/projectDomain.js`.
- Produces: `AttendanceValidationError`, `isAttendanceProjectEligible(project)`, `normalizeAttendanceLocation(value)`, `surfaceDistanceMeters(from, to)`, `classifyAttendanceLocation(input)`, `previewAttendanceLocation({ center, location })`, `normalizeAbnormalReason(value, options)`, `createAttendanceWorkPointDraft(ordinal)`, `normalizeAttendanceWorkPointInput(value)`, `isCompleteAttendanceWorkPoint(point)`, `canClockOut(workPoints)`, `validateAttendancePhotoFile(file)`, and `normalizeAttendancePhotoPhase(value)`.
- Produces constants: `MAX_ATTENDANCE_WORK_POINTS = 7`, `MAX_ATTENDANCE_AREA_CHARS = 100`, `MAX_ATTENDANCE_TEXT_CHARS = 1000`, `MAX_ABNORMAL_REASON_CHARS = 500`, `ATTENDANCE_PHOTO_BUCKET = 'erp-attendance-photos'`, `MAX_ATTENDANCE_PHOTO_BYTES = 20971520`, `ATTENDANCE_SIGNED_URL_TTL_SECONDS = 300`.

- [ ] **Step 1: Write failing strict-project, distance, reason and work-point tests**

Create `attendanceDomain.test.js` with table-driven checks that prove invalid radius is never repaired to 300, emoji length follows PostgreSQL `char_length`, one complete point is sufficient, and unrelated incomplete points are ignored:

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AttendanceValidationError,
  canClockOut,
  classifyAttendanceLocation,
  isAttendanceProjectEligible,
  normalizeAbnormalReason,
  normalizeAttendanceWorkPointInput,
  surfaceDistanceMeters,
} from './attendanceDomain.js'

const eligibleProject = {
  projectId: 'P001',
  projectName: '东京站现场',
  status: '进行中',
  address: '東京都 千代田区 1-1',
  latitude: 35.681236,
  longitude: 139.767125,
  attendanceRadiusMeters: 300,
  locationConfirmedAt: '2026-07-15T00:00:00.000Z',
  locationAddressSnapshot: '東京都　千代田区 1-1',
}

test('attendance project eligibility is strict and never defaults a bad radius', () => {
  assert.equal(isAttendanceProjectEligible(eligibleProject), true)
  for (const patch of [
    { status: '报价中' },
    { address: ' ' },
    { latitude: null },
    { longitude: 181 },
    { attendanceRadiusMeters: undefined },
    { attendanceRadiusMeters: 0 },
    { attendanceRadiusMeters: -1 },
    { locationConfirmedAt: '' },
    { locationAddressSnapshot: '別住所' },
  ]) assert.equal(isAttendanceProjectEligible({ ...eligibleProject, ...patch }), false)
})

test('normal location includes the exact distance plus accuracy boundary', () => {
  assert.equal(classifyAttendanceLocation({ distanceMeters: 250, accuracyMeters: 50, radiusMeters: 300 }), 'normal')
  assert.equal(classifyAttendanceLocation({ distanceMeters: 250.001, accuracyMeters: 50, radiusMeters: 300 }), 'abnormal')
  assert.equal(classifyAttendanceLocation({ distanceMeters: 0, accuracyMeters: 301, radiusMeters: 300 }), 'abnormal')
  assert.equal(Math.round(surfaceDistanceMeters(
    { latitude: 35.681236, longitude: 139.767125 },
    { latitude: 35.681236, longitude: 139.767125 },
  )), 0)
})

test('abnormal reasons and work point text use code-point limits', () => {
  assert.equal(normalizeAbnormalReason(' 交通管制 ', { required: true }), '交通管制')
  assert.equal(normalizeAbnormalReason('理'.repeat(500), { required: true }).length, 500)
  assert.throws(() => normalizeAbnormalReason('  ', { required: true }), AttendanceValidationError)
  assert.throws(() => normalizeAbnormalReason('理'.repeat(501), { required: true }), AttendanceValidationError)
  assert.equal(normalizeAttendanceWorkPointInput({
    ordinal: 1,
    areaName: '  北侧墙面 ',
    workDescription: ' 下地施工 ',
    completionNote: ' 完成 ',
  }).areaName, '北侧墙面')
  assert.throws(() => normalizeAttendanceWorkPointInput({ ordinal: 8 }), AttendanceValidationError)
})

test('one complete point permits clock out while other incomplete points are neutral', () => {
  const complete = {
    ordinal: 1,
    areaName: '北侧墙面',
    workDescription: '完成下地施工',
    photos: {
      before: { uploadStatus: 'active' },
      after: { uploadStatus: 'active' },
    },
  }
  assert.equal(canClockOut([complete]), true)
  assert.equal(canClockOut([complete, { ordinal: 2, areaName: '南侧', photos: {} }]), true)
  assert.equal(canClockOut([{ ...complete, photos: { before: { uploadStatus: 'pending' }, after: null } }]), false)
})
```

- [ ] **Step 2: Write failing photo-file tests**

Create `attendancePhotoDomain.test.js` with exact byte and canonical MIME expectations:

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AttendancePhotoValidationError,
  MAX_ATTENDANCE_PHOTO_BYTES,
  normalizeAttendancePhotoPhase,
  validateAttendancePhotoFile,
} from './attendancePhotoDomain.js'

function file(name, type, size, lastModified = Date.parse('2026-07-15T08:00:00Z')) {
  return { name, type, size, lastModified }
}

test('photo validation accepts five MIME types and exact 20 MiB', () => {
  for (const [name, type] of [
    ['a.jpg', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.webp', 'image/webp'],
    ['a.heic', 'image/heic'],
    ['a.heif', 'image/heif'],
  ]) assert.equal(validateAttendancePhotoFile(file(name, type, MAX_ATTENDANCE_PHOTO_BYTES)).contentType, type)
  assert.equal(validateAttendancePhotoFile(file('camera.heic', '', 1)).contentType, 'image/heic')
  assert.equal(validateAttendancePhotoFile(file('camera.heif', '', 1)).contentType, 'image/heif')
})

test('photo validation rejects empty, oversize and spoofed files', () => {
  for (const candidate of [
    file('a.jpg', 'image/jpeg', 0),
    file('a.jpg', 'image/jpeg', MAX_ATTENDANCE_PHOTO_BYTES + 1),
    file('a.jpg', 'application/pdf', 1),
    file('a.png', 'image/jpeg', 1),
    file('a.jpg', '', 1),
  ]) assert.throws(() => validateAttendancePhotoFile(candidate), AttendancePhotoValidationError)
  assert.throws(() => normalizeAttendancePhotoPhase('during'), AttendancePhotoValidationError)
})
```

- [ ] **Step 3: Run both tests RED**

Run:

```bash
node --test src/features/attendance/attendanceDomain.test.js src/features/attendance/attendancePhotoDomain.test.js
```

Expected: FAIL because both modules do not exist.

- [ ] **Step 4: Implement the pure domain modules**

Implement `attendanceDomain.js` with strict raw-number checks, Unicode code-point length, and client-only Haversine preview:

```js
import { normalizeAddress } from '../projects/projectDomain.js'

export const MAX_ATTENDANCE_WORK_POINTS = 7
export const MAX_ATTENDANCE_AREA_CHARS = 100
export const MAX_ATTENDANCE_TEXT_CHARS = 1000
export const MAX_ABNORMAL_REASON_CHARS = 500

export class AttendanceValidationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AttendanceValidationError'
    this.code = code
  }
}

const textLength = (value) => [...String(value ?? '')].length
const isNumberInRange = (value, minimum, maximum) =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum

export function isAttendanceProjectEligible(project) {
  return Boolean(
    project &&
    ['待开工', '进行中'].includes(project.status) &&
    String(project.projectName ?? '').trim() &&
    normalizeAddress(project.address) &&
    isNumberInRange(project.latitude, -90, 90) &&
    isNumberInRange(project.longitude, -180, 180) &&
    typeof project.attendanceRadiusMeters === 'number' &&
    Number.isFinite(project.attendanceRadiusMeters) &&
    project.attendanceRadiusMeters > 0 &&
    String(project.locationConfirmedAt ?? '').trim() &&
    normalizeAddress(project.locationAddressSnapshot) === normalizeAddress(project.address)
  )
}

export function normalizeAttendanceLocation(value) {
  if (!isNumberInRange(value?.latitude, -90, 90) ||
      !isNumberInRange(value?.longitude, -180, 180) ||
      typeof value?.accuracyMeters !== 'number' ||
      !Number.isFinite(value.accuracyMeters) || value.accuracyMeters <= 0) {
    throw new AttendanceValidationError('ATTENDANCE_LOCATION_INVALID', '无法取得有效定位，请重新定位')
  }
  return {
    latitude: value.latitude,
    longitude: value.longitude,
    accuracyMeters: value.accuracyMeters,
    deviceRecordedAt: typeof value.deviceRecordedAt === 'string' ? value.deviceRecordedAt : null,
  }
}

export function surfaceDistanceMeters(from, to) {
  const a = normalizeAttendanceLocation({ ...from, accuracyMeters: 1 })
  const b = normalizeAttendanceLocation({ ...to, accuracyMeters: 1 })
  const radians = (degrees) => degrees * Math.PI / 180
  const latitudeDelta = radians(b.latitude - a.latitude)
  const longitudeDelta = radians(b.longitude - a.longitude)
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) *
    Math.sin(longitudeDelta / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))))
}

export function classifyAttendanceLocation({ distanceMeters, accuracyMeters, radiusMeters }) {
  for (const value of [distanceMeters, accuracyMeters, radiusMeters]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new AttendanceValidationError('ATTENDANCE_LOCATION_INVALID', '定位预览数据无效')
    }
  }
  if (distanceMeters < 0 || accuracyMeters <= 0 || radiusMeters <= 0) {
    throw new AttendanceValidationError('ATTENDANCE_LOCATION_INVALID', '定位预览数据无效')
  }
  return distanceMeters + accuracyMeters <= radiusMeters ? 'normal' : 'abnormal'
}

export function previewAttendanceLocation({ center, location }) {
  const normalized = normalizeAttendanceLocation(location)
  const distanceMeters = surfaceDistanceMeters(center, normalized)
  const radiusMeters = Number(center.attendanceRadiusMeters)
  return {
    distanceMeters,
    accuracyMeters: normalized.accuracyMeters,
    radiusMeters,
    result: classifyAttendanceLocation({ distanceMeters, accuracyMeters: normalized.accuracyMeters, radiusMeters }),
  }
}

export function normalizeAbnormalReason(value, { required = false } = {}) {
  const reason = String(value ?? '').trim()
  if ((required && !reason) || textLength(reason) > MAX_ABNORMAL_REASON_CHARS) {
    throw new AttendanceValidationError('ATTENDANCE_ABNORMAL_REASON_INVALID', '异常原因需填写 1–500 个字符')
  }
  return reason || null
}

export function createAttendanceWorkPointDraft(ordinal) {
  return normalizeAttendanceWorkPointInput({ ordinal, areaName: '', workDescription: '', completionNote: '' })
}

export function normalizeAttendanceWorkPointInput(value = {}) {
  const ordinal = Number(value.ordinal)
  const areaName = String(value.areaName ?? '').trim()
  const workDescription = String(value.workDescription ?? '').trim()
  const completionNote = String(value.completionNote ?? '').trim()
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > MAX_ATTENDANCE_WORK_POINTS) {
    throw new AttendanceValidationError('ATTENDANCE_WORK_POINT_ORDINAL_INVALID', '工作点位序号必须在 1–7 之间')
  }
  if (textLength(areaName) > MAX_ATTENDANCE_AREA_CHARS ||
      textLength(workDescription) > MAX_ATTENDANCE_TEXT_CHARS ||
      textLength(completionNote) > MAX_ATTENDANCE_TEXT_CHARS) {
    throw new AttendanceValidationError('ATTENDANCE_WORK_POINT_TEXT_INVALID', '现场日志文字超过长度限制')
  }
  return { ...value, ordinal, areaName, workDescription, completionNote }
}

export function isCompleteAttendanceWorkPoint(workPoint) {
  const value = normalizeAttendanceWorkPointInput(workPoint)
  return Boolean(
    value.areaName && value.workDescription &&
    value.photos?.before?.uploadStatus === 'active' &&
    value.photos?.after?.uploadStatus === 'active'
  )
}

export function canClockOut(workPoints) {
  return Array.isArray(workPoints) && workPoints.some(isCompleteAttendanceWorkPoint)
}
```

Implement `attendancePhotoDomain.js` with extension/MIME agreement and no Node `Buffer` dependency:

```js
export const ATTENDANCE_PHOTO_BUCKET = 'erp-attendance-photos'
export const MAX_ATTENDANCE_PHOTO_BYTES = 20 * 1024 * 1024
export const ATTENDANCE_PHOTO_PHASES = Object.freeze(['before', 'after'])
export const ATTENDANCE_PHOTO_CONTENT_TYPES = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
])
export const ATTENDANCE_SIGNED_URL_TTL_SECONDS = 300

export class AttendancePhotoValidationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AttendancePhotoValidationError'
    this.code = code
  }
}

const MIME_BY_EXTENSION = Object.freeze({
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif',
})

export function normalizeAttendancePhotoPhase(value) {
  if (!ATTENDANCE_PHOTO_PHASES.includes(value)) {
    throw new AttendancePhotoValidationError('ATTENDANCE_PHOTO_PHASE_INVALID', '照片阶段无效')
  }
  return value
}

export function validateAttendancePhotoFile(file) {
  const originalFileName = String(file?.name ?? '').trim()
  const extension = originalFileName.split('.').pop()?.toLowerCase() || ''
  const expectedType = MIME_BY_EXTENSION[extension]
  const suppliedType = String(file?.type ?? '').toLowerCase()
  const contentType = !suppliedType && ['heic', 'heif'].includes(extension)
    ? expectedType
    : suppliedType
  if (!originalFileName || [...originalFileName].length > 255 || /[\u0000-\u001f\u007f]/u.test(originalFileName)) {
    throw new AttendancePhotoValidationError('ATTENDANCE_PHOTO_NAME_INVALID', '照片文件名无效')
  }
  if (!Number.isInteger(file?.size) || file.size < 1 || file.size > MAX_ATTENDANCE_PHOTO_BYTES) {
    throw new AttendancePhotoValidationError('ATTENDANCE_PHOTO_SIZE_INVALID', '照片大小必须在 1 字节至 20 MiB 之间')
  }
  if (!ATTENDANCE_PHOTO_CONTENT_TYPES.includes(contentType) || expectedType !== contentType) {
    throw new AttendancePhotoValidationError('ATTENDANCE_PHOTO_TYPE_INVALID', '只允许 JPEG、PNG、WEBP、HEIC 或 HEIF 照片')
  }
  const timestamp = Number(file.lastModified)
  return {
    originalFileName,
    contentType,
    sizeBytes: file.size,
    capturedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null,
  }
}
```

- [ ] **Step 5: Run focused tests GREEN**

Run:

```bash
node --test src/features/attendance/attendanceDomain.test.js src/features/attendance/attendancePhotoDomain.test.js
```

Expected: all domain and photo cases pass.

- [ ] **Step 6: Commit Task 1 only**

```bash
git add src/features/attendance/attendanceDomain.js src/features/attendance/attendanceDomain.test.js src/features/attendance/attendancePhotoDomain.js src/features/attendance/attendancePhotoDomain.test.js
git commit -m "feat: add attendance domain rules"
```

---

### Task 2: Fresh browser geolocation with cancellable safe errors

**Files:**
- Create: `src/features/attendance/attendanceLocationService.js`
- Create: `src/features/attendance/attendanceLocationService.test.js`

**Interfaces:**
- Consumes: `normalizeAttendanceLocation(value)` from Task 1.
- Produces: `AttendanceLocationError`, `createBrowserGeolocationAdapter({ geolocation })`, `createAttendanceLocationService({ adapter })`, singleton `attendanceLocationService`, and `getCurrentLocation({ signal }): Promise<{ latitude, longitude, accuracyMeters, deviceRecordedAt }>`.

- [ ] **Step 1: Write the failing location adapter tests**

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AttendanceLocationError,
  createAttendanceLocationService,
  createBrowserGeolocationAdapter,
} from './attendanceLocationService.js'

test('every request calls browser geolocation with fresh high-accuracy options', async () => {
  const calls = []
  const geolocation = { getCurrentPosition(success, failure, options) {
    calls.push({ failure, options })
    success({
      coords: { latitude: 35.681236, longitude: 139.767125, accuracy: 12 },
      timestamp: Date.parse('2026-07-15T08:00:00Z'),
    })
  } }
  const service = createAttendanceLocationService({ adapter: createBrowserGeolocationAdapter({ geolocation }) })
  await service.getCurrentLocation()
  await service.getCurrentLocation()
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].options, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
})

test('permission, unavailable, timeout and invalid positions fail closed', async () => {
  for (const [browserCode, expectedCode] of [
    [1, 'GEOLOCATION_PERMISSION_DENIED'],
    [2, 'GEOLOCATION_UNAVAILABLE'],
    [3, 'GEOLOCATION_TIMEOUT'],
  ]) {
    const adapter = createBrowserGeolocationAdapter({
      geolocation: { getCurrentPosition(success, failure) { failure({ code: browserCode }) } },
    })
    await assert.rejects(
      () => createAttendanceLocationService({ adapter }).getCurrentLocation(),
      (error) => error instanceof AttendanceLocationError && error.code === expectedCode,
    )
  }
  const invalid = createBrowserGeolocationAdapter({
    geolocation: { getCurrentPosition(success) {
      success({ coords: { latitude: 91, longitude: 139, accuracy: 0 }, timestamp: 0 })
    } },
  })
  await assert.rejects(
    () => createAttendanceLocationService({ adapter: invalid }).getCurrentLocation(),
    (error) => error.code === 'GEOLOCATION_INVALID',
  )
})

test('abort rejects and ignores a late success callback', async () => {
  let succeed
  const controller = new AbortController()
  const service = createAttendanceLocationService({ adapter: createBrowserGeolocationAdapter({
    geolocation: { getCurrentPosition(success) { succeed = success } },
  }) })
  const pending = service.getCurrentLocation({ signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, (error) => error.code === 'GEOLOCATION_ABORTED')
  succeed({ coords: { latitude: 35, longitude: 139, accuracy: 10 }, timestamp: Date.now() })
})
```

- [ ] **Step 2: Run the location test RED**

Run:

```bash
node --test src/features/attendance/attendanceLocationService.test.js
```

Expected: FAIL because `attendanceLocationService.js` does not exist.

- [ ] **Step 3: Implement a no-cache adapter and service**

```js
import { normalizeAttendanceLocation } from './attendanceDomain.js'

export class AttendanceLocationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AttendanceLocationError'
    this.code = code
  }
}

const ERROR_MESSAGES = Object.freeze({
  GEOLOCATION_UNSUPPORTED: '当前设备不支持定位',
  GEOLOCATION_PERMISSION_DENIED: '定位权限已被拒绝，请在浏览器设置中允许定位',
  GEOLOCATION_UNAVAILABLE: '暂时无法取得位置，请移动到开阔区域后重试',
  GEOLOCATION_TIMEOUT: '定位超时，请重新获取位置',
  GEOLOCATION_INVALID: '设备返回了无效位置，请重新定位',
  GEOLOCATION_ABORTED: '本次定位已取消',
})

function locationError(code) {
  return new AttendanceLocationError(code, ERROR_MESSAGES[code])
}

export function createBrowserGeolocationAdapter({ geolocation = globalThis.navigator?.geolocation } = {}) {
  return Object.freeze({
    getCurrentPosition({ signal } = {}) {
      if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
        return Promise.reject(locationError('GEOLOCATION_UNSUPPORTED'))
      }
      return new Promise((resolve, reject) => {
        let settled = false
        const finish = (callback, value) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          callback(value)
        }
        const onAbort = () => finish(reject, locationError('GEOLOCATION_ABORTED'))
        if (signal?.aborted) return onAbort()
        signal?.addEventListener('abort', onAbort, { once: true })
        geolocation.getCurrentPosition(
          (position) => finish(resolve, position),
          (error) => finish(reject, locationError({
            1: 'GEOLOCATION_PERMISSION_DENIED',
            2: 'GEOLOCATION_UNAVAILABLE',
            3: 'GEOLOCATION_TIMEOUT',
          }[error?.code] || 'GEOLOCATION_UNAVAILABLE')),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        )
      })
    },
  })
}

export function createAttendanceLocationService({ adapter = createBrowserGeolocationAdapter() } = {}) {
  return Object.freeze({
    async getCurrentLocation({ signal } = {}) {
      let position
      try {
        position = await adapter.getCurrentPosition({ signal })
        const timestamp = Number(position?.timestamp)
        return normalizeAttendanceLocation({
          latitude: position?.coords?.latitude,
          longitude: position?.coords?.longitude,
          accuracyMeters: position?.coords?.accuracy,
          deviceRecordedAt: Number.isFinite(timestamp) && timestamp > 0
            ? new Date(timestamp).toISOString()
            : null,
        })
      } catch (error) {
        if (error instanceof AttendanceLocationError) throw error
        throw locationError('GEOLOCATION_INVALID')
      }
    },
  })
}

export const attendanceLocationService = createAttendanceLocationService()
```

- [ ] **Step 4: Run the location tests GREEN**

Run:

```bash
node --test src/features/attendance/attendanceLocationService.test.js
```

Expected: all tests pass; two calls produce two browser calls.

- [ ] **Step 5: Commit Task 2 only**

```bash
git add src/features/attendance/attendanceLocationService.js src/features/attendance/attendanceLocationService.test.js
git commit -m "feat: add fresh attendance geolocation"
```

---

### Task 3: Secure attendance RPC client

**Files:**
- Create: `src/services/attendanceService.js`
- Create: `src/services/attendanceService.test.js`

**Interfaces:**
- Consumes: Task 1 input normalizers and `supabase`, `isSupabaseConfigured` from `src/lib/supabaseClient.js`.
- Produces: `AttendanceServiceError`, `createAttendanceService(client, { configured })`, singleton `attendanceService`.
- Produces methods: `listAttendanceProjects()`, `getMyTodayAttendance()`, `clockIn({ projectId, requestId, location, abnormalReason })`, `upsertWorkPoint({ sessionId, ordinal, areaName, workDescription, completionNote })`, `reservePhoto({ workPointId, phase, originalFileName, contentType, sizeBytes, checksumSha256, capturedAt })`, `finalizePhoto({ photoId })`, `abandonPhoto({ photoId })`, `clockOut({ sessionId, requestId, location, abnormalReason })`, and `listAttendanceRecords({ workDate, projectId, employeeProfileId, beforeOpenedAt, beforeSessionId, limit })`.
- Clock methods return `{ session, event }`; today returns `{ workDate, viewerAccess, activeSession, completedSessions, pendingPhotoReservations }`; record list returns `{ access, filterOptions, items, nextCursor }`.

- [ ] **Step 1: Write failing RPC-name, exact-argument and error tests**

Use a recording RPC client and assert all nine calls. The clock assertion is security-critical:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { AttendanceServiceError, createAttendanceService } from './attendanceService.js'

const source = await readFile(new URL('./attendanceService.js', import.meta.url), 'utf8').catch(() => '')

function responseFor(name, args = {}) {
  if (name === 'list_attendance_projects_secure') return []
  if (name === 'get_my_today_attendance_secure') return {
    workDate: '2026-07-15', viewerAccess: { scope: 'own', canViewScopedRecords: false },
    activeSession: null, completedSessions: [], pendingPhotoReservations: [],
  }
  if (name === 'list_attendance_records_secure') return {
    access: { scope: 'own' }, filterOptions: { projects: [], employees: [] }, items: [], nextCursor: null,
  }
  if (name === 'reserve_attendance_photo_secure') return {
    photoId: '74000000-0000-4000-8000-000000000001', workPointId: '73000000-0000-4000-8000-000000000001',
    phase: 'before', bucketId: 'erp-attendance-photos',
    objectPath: 'a/b/c/d/before', originalFileName: 'a.jpg', contentType: 'image/jpeg',
    sizeBytes: 1, uploadStatus: 'pending', capturedAt: null, createdAt: '2026-07-15T00:00:00Z',
  }
  if (name.includes('photo')) return { ...responseFor('reserve_attendance_photo_secure'), uploadStatus: name.startsWith('finalize') ? 'active' : 'cleanup_pending' }
  if (name.includes('work_point')) return {
    workPointId: '73000000-0000-4000-8000-000000000001', sessionId: '71000000-0000-4000-8000-000000000001',
    ordinal: 1, areaName: '北侧', workDescription: '施工', completionNote: '',
    createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
    photos: { before: null, after: null },
  }
  const eventType = name.startsWith('clock_out') ? 'clock_out' : 'clock_in'
  const event = {
    eventId: eventType === 'clock_out'
      ? '72000000-0000-4000-8000-000000000002'
      : '72000000-0000-4000-8000-000000000001',
    requestId: args.p_request_id,
    eventType,
    serverRecordedAt: '2026-07-15T08:00:00Z',
    deviceRecordedAt: args.p_device_recorded_at,
    latitude: args.p_latitude,
    longitude: args.p_longitude,
    accuracyMeters: args.p_accuracy_meters,
    distanceMeters: 10,
    radiusMeters: 300,
    result: 'normal',
    abnormalReason: null,
  }
  const clockInEvent = eventType === 'clock_in' ? event : {
    ...event,
    eventId: '72000000-0000-4000-8000-000000000001',
    requestId: '70000000-0000-4000-8000-000000000001',
    eventType: 'clock_in',
  }
  return {
    session: {
      sessionId: '71000000-0000-4000-8000-000000000001',
      employeeProfileId: '52000000-0000-4000-8000-000000000001',
      employeeNumberSnapshot: 'SW-5101',
      employeeNameSnapshot: '普通员工',
      projectId: 'P001',
      projectNameSnapshot: '东京站现场',
      projectAddressSnapshot: '東京都 千代田区 1-1',
      projectLatitudeSnapshot: 35.681236,
      projectLongitudeSnapshot: 139.767125,
      attendanceRadiusMetersSnapshot: 300,
      workDate: '2026-07-15',
      status: eventType === 'clock_out' ? 'closed' : 'open',
      openedAt: '2026-07-15T08:00:00Z',
      closedAt: eventType === 'clock_out' ? '2026-07-15T17:00:00Z' : null,
      clockInEvent,
      clockOutEvent: eventType === 'clock_out' ? event : null,
      workPoints: [],
    },
    event,
  }
}

test('clock calls send device facts but no trusted server fields', async () => {
  const calls = []
  const service = createAttendanceService({ rpc: async (name, args) => {
    calls.push([name, args])
    return { data: responseFor(name, args), error: null }
  } }, { configured: true })
  const location = { latitude: 35, longitude: 139, accuracyMeters: 10, deviceRecordedAt: '2026-07-15T00:00:00Z' }
  const clockInRequestId = '70000000-0000-4000-8000-000000000001'
  const clockOutRequestId = '70000000-0000-4000-8000-000000000002'
  await service.clockIn({ projectId: 'P001', requestId: clockInRequestId, location, abnormalReason: null })
  await service.clockOut({ sessionId: '71000000-0000-4000-8000-000000000001', requestId: clockOutRequestId, location, abnormalReason: ' 交通管制 ' })
  assert.deepEqual(calls[0], ['clock_in_project_secure', {
    p_project_id: 'P001', p_request_id: clockInRequestId, p_latitude: 35, p_longitude: 139,
    p_accuracy_meters: 10, p_device_recorded_at: '2026-07-15T00:00:00Z', p_abnormal_reason: null,
  }])
  assert.equal(calls[1][0], 'clock_out_project_secure')
  assert.equal(calls[1][1].p_session_id, '71000000-0000-4000-8000-000000000001')
  for (const forbidden of [
    'employeeId', 'employeeName', 'workDate', 'distanceMeters', 'result',
    'radiusMeters', 'projectId', 'projectLatitude', 'p_employee_id',
    'p_employee_name', 'p_work_date', 'p_distance_meters', 'p_result',
    'p_radius_meters', 'p_project_id', 'p_project_latitude',
  ]) {
    assert.equal(Object.hasOwn(calls[1][1], forbidden), false)
  }
})

test('attendance service is RPC-only and fails closed', async () => {
  assert.doesNotMatch(source, /\.from\(|localStorage|sessionStorage|indexedDB|baseRecordService|console\./)
  const service = createAttendanceService({ rpc: async () => ({ data: null, error: { status: 401 } }) }, { configured: true })
  await assert.rejects(() => service.listAttendanceProjects(), (error) =>
    error instanceof AttendanceServiceError && error.code === 'AUTH_INVALID')
  const offline = createAttendanceService(null, { configured: false })
  await assert.rejects(() => offline.getMyTodayAttendance(), (error) => error.code === 'ATTENDANCE_NOT_CONFIGURED')
})
```

Add this exact remaining-method test:

```js
test('all non-clock methods use exact secure RPC names and arguments', async () => {
  const calls = []
  const service = createAttendanceService({ rpc: async (name, args) => {
    calls.push([name, args])
    return { data: responseFor(name, args), error: null }
  } }, { configured: true })
  await service.listAttendanceProjects()
  await service.getMyTodayAttendance()
  await service.upsertWorkPoint({
    sessionId: '71000000-0000-4000-8000-000000000001', ordinal: 1,
    areaName: ' 北侧 ', workDescription: ' 施工 ', completionNote: '',
  })
  const metadata = {
    workPointId: '73000000-0000-4000-8000-000000000001', phase: 'before',
    originalFileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 1,
    checksumSha256: null, capturedAt: null,
  }
  await service.reservePhoto(metadata)
  await service.finalizePhoto({ photoId: '74000000-0000-4000-8000-000000000001' })
  await service.abandonPhoto({ photoId: '74000000-0000-4000-8000-000000000001' })
  await service.listAttendanceRecords({
    workDate: '2026-07-15', projectId: 'P001',
    employeeProfileId: '52000000-0000-4000-8000-000000000001',
    beforeOpenedAt: null, beforeSessionId: null, limit: 50,
  })
  assert.deepEqual(calls.map(([name]) => name), [
    'list_attendance_projects_secure', 'get_my_today_attendance_secure',
    'upsert_attendance_work_point_secure', 'reserve_attendance_photo_secure',
    'finalize_attendance_photo_secure', 'abandon_attendance_photo_secure',
    'list_attendance_records_secure',
  ])
  assert.deepEqual(calls[2][1], {
    p_session_id: '71000000-0000-4000-8000-000000000001', p_ordinal: 1,
    p_area_name: '北侧', p_work_description: '施工', p_completion_note: '',
  })
  assert.deepEqual(calls[3][1], {
    p_work_point_id: metadata.workPointId, p_phase: 'before',
    p_original_file_name: 'a.jpg', p_content_type: 'image/jpeg', p_size_bytes: 1,
    p_checksum_sha256: null, p_captured_at: null,
  })
})

test('known hints are safe and malformed DTOs fail closed', async () => {
  const known = createAttendanceService({ rpc: async () => ({
    data: null, error: { status: 400, hint: 'ATTENDANCE_COMPLETE_WORK_POINT_REQUIRED', message: 'private detail' },
  }) }, { configured: true })
  await assert.rejects(() => known.getMyTodayAttendance(), (error) =>
    error.code === 'ATTENDANCE_COMPLETE_WORK_POINT_REQUIRED' && !error.message.includes('private'))
  const malformed = createAttendanceService({ rpc: async () => ({
    data: { workDate: '2026-07-15', viewerAccess: { scope: 'root', canViewScopedRecords: true }, activeSession: null, completedSessions: [], pendingPhotoReservations: [] },
    error: null,
  }) }, { configured: true })
  await assert.rejects(() => malformed.getMyTodayAttendance(), (error) => error.code === 'ATTENDANCE_INVALID_RESPONSE')
})
```

- [ ] **Step 2: Run service tests RED**

Run:

```bash
node --test src/services/attendanceService.test.js
```

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement the RPC-only service factory**

Use a stable error whitelist and never show the database message:

```js
import { normalizeAbnormalReason, normalizeAttendanceLocation, normalizeAttendanceWorkPointInput } from '../features/attendance/attendanceDomain.js'
import { normalizeAttendancePhotoPhase } from '../features/attendance/attendancePhotoDomain.js'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'

const SAFE_ERRORS = Object.freeze({
  ATTENDANCE_OPEN_SESSION_EXISTS: '请先完成当前项目的下班打卡',
  ATTENDANCE_SESSION_CLOSED: '该项目场次已经结束',
  ATTENDANCE_ABNORMAL_REASON_REQUIRED: '当前位置超出打卡范围，请填写异常原因',
  ATTENDANCE_COMPLETE_WORK_POINT_REQUIRED: '至少完成一个含前后照片的工作点位后才能下班',
  ATTENDANCE_WORK_POINT_LIMIT_REACHED: '一个场次最多建立七个工作点位',
  ATTENDANCE_BEFORE_PHOTO_REQUIRED: '请先上传开工前照片',
  ATTENDANCE_PHOTO_NOT_PENDING: '照片预约状态已变化，请刷新后重试',
  ATTENDANCE_REQUEST_CONFLICT: '该打卡请求编号已被其他操作使用',
})

export class AttendanceServiceError extends Error {
  constructor(code, message, { authInvalid = false } = {}) {
    super(message)
    this.name = 'AttendanceServiceError'
    this.code = code
    this.authInvalid = authInvalid
  }
}

function normalizeServiceError(error) {
  const status = Number(error?.status)
  const pgCode = String(error?.code ?? '').toUpperCase()
  const hint = String(error?.hint ?? '').toUpperCase()
  if (status === 401 || ['PGRST301', 'JWT_EXPIRED'].includes(pgCode)) {
    return new AttendanceServiceError('AUTH_INVALID', '登录状态无效，请重新登录', { authInvalid: true })
  }
  if (SAFE_ERRORS[hint]) return new AttendanceServiceError(hint, SAFE_ERRORS[hint])
  if (status === 403 || pgCode === '42501') {
    return new AttendanceServiceError('ATTENDANCE_ACCESS_DENIED', '没有权限执行此操作')
  }
  return new AttendanceServiceError('ATTENDANCE_SERVICE_UNAVAILABLE', '考勤服务暂不可用，请稍后重试')
}

export function createAttendanceService(client = supabase, { configured = isSupabaseConfigured } = {}) {
  const ensureConfigured = () => {
    if (!configured || !client || typeof client.rpc !== 'function') {
      throw new AttendanceServiceError('ATTENDANCE_NOT_CONFIGURED', '云端考勤服务未配置')
    }
  }
  const call = async (name, args = {}) => {
    ensureConfigured()
    let result
    try { result = await client.rpc(name, args) } catch (error) { throw normalizeServiceError(error) }
    if (result?.error) throw normalizeServiceError(result.error)
    return result?.data
  }
  const clockArgs = ({ requestId, location, abnormalReason }) => {
    const position = normalizeAttendanceLocation(location)
    return {
      p_request_id: requestId,
      p_latitude: position.latitude,
      p_longitude: position.longitude,
      p_accuracy_meters: position.accuracyMeters,
      p_device_recorded_at: position.deviceRecordedAt,
      p_abnormal_reason: normalizeAbnormalReason(abnormalReason),
    }
  }
  return Object.freeze({
    async listAttendanceProjects() { return validateProjectList(await call('list_attendance_projects_secure')) },
    async getMyTodayAttendance() { return validateToday(await call('get_my_today_attendance_secure')) },
    async clockIn(input) {
      return validateClockResult(await call('clock_in_project_secure', {
        p_project_id: input.projectId, ...clockArgs(input),
      }), 'clock_in')
    },
    async upsertWorkPoint(input) {
      const point = normalizeAttendanceWorkPointInput(input)
      return validateWorkPoint(await call('upsert_attendance_work_point_secure', {
        p_session_id: input.sessionId, p_ordinal: point.ordinal, p_area_name: point.areaName,
        p_work_description: point.workDescription, p_completion_note: point.completionNote,
      }))
    },
    async reservePhoto(input) {
      return validatePhoto(await call('reserve_attendance_photo_secure', {
        p_work_point_id: input.workPointId, p_phase: normalizeAttendancePhotoPhase(input.phase),
        p_original_file_name: input.originalFileName, p_content_type: input.contentType,
        p_size_bytes: input.sizeBytes, p_checksum_sha256: input.checksumSha256 ?? null,
        p_captured_at: input.capturedAt ?? null,
      }), 'pending')
    },
    async finalizePhoto({ photoId }) {
      return validatePhoto(await call('finalize_attendance_photo_secure', { p_photo_id: photoId }), 'active')
    },
    async abandonPhoto({ photoId }) {
      return validatePhoto(await call('abandon_attendance_photo_secure', { p_photo_id: photoId }), 'cleanup_pending')
    },
    async clockOut(input) {
      return validateClockResult(await call('clock_out_project_secure', {
        p_session_id: input.sessionId, ...clockArgs(input),
      }), 'clock_out')
    },
    async listAttendanceRecords({ workDate, projectId = null, employeeProfileId = null, beforeOpenedAt = null, beforeSessionId = null, limit = 50 }) {
      return validateRecordPage(await call('list_attendance_records_secure', {
        p_work_date: workDate, p_project_id: projectId, p_employee_profile_id: employeeProfileId,
        p_before_opened_at: beforeOpenedAt, p_before_session_id: beforeSessionId, p_limit: limit,
      }))
    },
  })
}

export const attendanceService = createAttendanceService()
```

In the same file, use exact-key validators rather than returning raw RPC objects:

```js
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROJECT_KEYS = ['projectId','projectName','status','address','latitude','longitude','attendanceRadiusMeters','locationConfirmedAt','locationAddressSnapshot']
const EVENT_KEYS = ['eventId','requestId','eventType','serverRecordedAt','deviceRecordedAt','latitude','longitude','accuracyMeters','distanceMeters','radiusMeters','result','abnormalReason']
const PHOTO_KEYS = ['photoId','workPointId','phase','bucketId','objectPath','originalFileName','contentType','sizeBytes','uploadStatus','capturedAt','createdAt']
const POINT_KEYS = ['workPointId','sessionId','ordinal','areaName','workDescription','completionNote','createdAt','updatedAt','photos']
const SESSION_KEYS = ['sessionId','employeeProfileId','employeeNumberSnapshot','employeeNameSnapshot','projectId','projectNameSnapshot','projectAddressSnapshot','projectLatitudeSnapshot','projectLongitudeSnapshot','attendanceRadiusMetersSnapshot','workDate','status','openedAt','closedAt','clockInEvent','clockOutEvent','workPoints']

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) {
    throw new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', '考勤服务返回了无效数据')
  }
  return value
}

function stringValue(value, { nullable = false, uuid = false } = {}) {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !value || (uuid && !UUID.test(value))) {
    throw new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', '考勤服务返回了无效数据')
  }
  return value
}

function finiteNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', '考勤服务返回了无效数据')
  }
  return value
}

function validateEvent(value) {
  const row = exactObject(value, EVENT_KEYS)
  const eventType = stringValue(row.eventType)
  const result = stringValue(row.result)
  if (!['clock_in', 'clock_out'].includes(eventType) || !['normal', 'abnormal'].includes(result)) {
    throw new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', '考勤服务返回了无效数据')
  }
  const abnormalReason = row.abnormalReason === null ? null : stringValue(row.abnormalReason)
  if ((result === 'normal' && abnormalReason !== null) || (result === 'abnormal' && abnormalReason === null)) {
    throw new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', '考勤服务返回了无效数据')
  }
  return {
    eventId: stringValue(row.eventId, { uuid: true }),
    requestId: stringValue(row.requestId, { uuid: true }),
    eventType,
    serverRecordedAt: stringValue(row.serverRecordedAt),
    deviceRecordedAt: row.deviceRecordedAt === null ? null : stringValue(row.deviceRecordedAt),
    latitude: finiteNumber(row.latitude), longitude: finiteNumber(row.longitude),
    accuracyMeters: finiteNumber(row.accuracyMeters), distanceMeters: finiteNumber(row.distanceMeters),
    radiusMeters: finiteNumber(row.radiusMeters), result, abnormalReason,
  }
}

function validatePhoto(value, requiredStatus) {
  const row = exactObject(value, PHOTO_KEYS)
  if (!['before', 'after'].includes(row.phase) ||
      !['pending', 'active', 'superseded', 'cleanup_pending'].includes(row.uploadStatus) ||
      (requiredStatus && row.uploadStatus !== requiredStatus)) {
    throw new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', '考勤服务返回了无效数据')
  }
  return {
    photoId: stringValue(row.photoId, { uuid: true }),
    workPointId: stringValue(row.workPointId, { uuid: true }),
    phase: row.phase,
    bucketId: stringValue(row.bucketId), objectPath: stringValue(row.objectPath),
    originalFileName: stringValue(row.originalFileName), contentType: stringValue(row.contentType),
    sizeBytes: finiteNumber(row.sizeBytes), uploadStatus: row.uploadStatus,
    capturedAt: row.capturedAt === null ? null : stringValue(row.capturedAt),
    createdAt: stringValue(row.createdAt),
  }
}

function validateWorkPoint(value) {
  const row = exactObject(value, POINT_KEYS)
  const photos = exactObject(row.photos, ['before', 'after'])
  return {
    workPointId: stringValue(row.workPointId, { uuid: true }),
    sessionId: stringValue(row.sessionId, { uuid: true }),
    ordinal: finiteNumber(row.ordinal),
    areaName: typeof row.areaName === 'string' ? row.areaName : stringValue(row.areaName),
    workDescription: typeof row.workDescription === 'string' ? row.workDescription : stringValue(row.workDescription),
    completionNote: typeof row.completionNote === 'string' ? row.completionNote : stringValue(row.completionNote),
    createdAt: stringValue(row.createdAt), updatedAt: stringValue(row.updatedAt),
    photos: {
      before: photos.before === null ? null : validatePhoto(photos.before, 'active'),
      after: photos.after === null ? null : validatePhoto(photos.after, 'active'),
    },
  }
}

function validateSession(value) {
  const row = exactObject(value, SESSION_KEYS)
  if (!['open', 'closed'].includes(row.status) || !Array.isArray(row.workPoints)) {
    throw new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', '考勤服务返回了无效数据')
  }
  return {
    sessionId: stringValue(row.sessionId, { uuid: true }),
    employeeProfileId: stringValue(row.employeeProfileId, { uuid: true }),
    employeeNumberSnapshot: stringValue(row.employeeNumberSnapshot), employeeNameSnapshot: stringValue(row.employeeNameSnapshot),
    projectId: stringValue(row.projectId), projectNameSnapshot: stringValue(row.projectNameSnapshot),
    projectAddressSnapshot: stringValue(row.projectAddressSnapshot),
    projectLatitudeSnapshot: finiteNumber(row.projectLatitudeSnapshot), projectLongitudeSnapshot: finiteNumber(row.projectLongitudeSnapshot),
    attendanceRadiusMetersSnapshot: finiteNumber(row.attendanceRadiusMetersSnapshot),
    workDate: stringValue(row.workDate), status: row.status, openedAt: stringValue(row.openedAt),
    closedAt: row.closedAt === null ? null : stringValue(row.closedAt),
    clockInEvent: row.clockInEvent === null ? null : validateEvent(row.clockInEvent),
    clockOutEvent: row.clockOutEvent === null ? null : validateEvent(row.clockOutEvent),
    workPoints: row.workPoints.map(validateWorkPoint),
  }
}

function validateProjectList(value) {
  if (!Array.isArray(value)) throw new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', '考勤服务返回了无效数据')
  return value.map((candidate) => {
    const row = exactObject(candidate, PROJECT_KEYS)
    return {
      projectId: stringValue(row.projectId), projectName: stringValue(row.projectName), status: stringValue(row.status),
      address: stringValue(row.address), latitude: finiteNumber(row.latitude), longitude: finiteNumber(row.longitude),
      attendanceRadiusMeters: finiteNumber(row.attendanceRadiusMeters),
      locationConfirmedAt: stringValue(row.locationConfirmedAt), locationAddressSnapshot: stringValue(row.locationAddressSnapshot),
    }
  })
}

function validateToday(value) {
  const row = exactObject(value, ['workDate','viewerAccess','activeSession','completedSessions','pendingPhotoReservations'])
  const access = exactObject(row.viewerAccess, ['scope','canViewScopedRecords'])
  if (!['own','assigned_projects','all'].includes(access.scope) || typeof access.canViewScopedRecords !== 'boolean' || !Array.isArray(row.completedSessions) || !Array.isArray(row.pendingPhotoReservations)) {
    throw new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', '考勤服务返回了无效数据')
  }
  return {
    workDate: stringValue(row.workDate), viewerAccess: { ...access },
    activeSession: row.activeSession === null ? null : validateSession(row.activeSession),
    completedSessions: row.completedSessions.map(validateSession),
    pendingPhotoReservations: row.pendingPhotoReservations.map((photo) => validatePhoto(photo, 'pending')),
  }
}

function validateClockResult(value, eventType) {
  const row = exactObject(value, ['session','event'])
  const event = validateEvent(row.event)
  if (event.eventType !== eventType) throw new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', '考勤服务返回了无效数据')
  return { session: validateSession(row.session), event }
}

function validateRecordPage(value) {
  const row = exactObject(value, ['access','filterOptions','items','nextCursor'])
  const access = exactObject(row.access, ['scope'])
  const filterOptions = exactObject(row.filterOptions, ['projects','employees'])
  if (!['own','assigned_projects','all'].includes(access.scope) || !Array.isArray(filterOptions.projects) || !Array.isArray(filterOptions.employees) || !Array.isArray(row.items)) {
    throw new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', '考勤服务返回了无效数据')
  }
  const cursor = row.nextCursor === null ? null : exactObject(row.nextCursor, ['openedAt','sessionId'])
  return {
    access: { scope: access.scope },
    filterOptions: {
      projects: filterOptions.projects.map((item) => ({
        projectId: stringValue(exactObject(item, ['projectId','projectName']).projectId),
        projectName: stringValue(item.projectName),
      })),
      employees: filterOptions.employees.map((item) => ({
        employeeProfileId: stringValue(exactObject(item, ['employeeProfileId','employeeNumberSnapshot','employeeNameSnapshot']).employeeProfileId, { uuid: true }),
        employeeNumberSnapshot: stringValue(item.employeeNumberSnapshot), employeeNameSnapshot: stringValue(item.employeeNameSnapshot),
      })),
    },
    items: row.items.map(validateSession),
    nextCursor: cursor === null ? null : {
      openedAt: stringValue(cursor.openedAt), sessionId: stringValue(cursor.sessionId, { uuid: true }),
    },
  }
}
```

Add strict-response mutation tests:

```js
test('DTO validators reject missing, extra, invalid enum and malformed nested fields', async () => {
  const valid = responseFor('clock_in_project_secure', {
    p_request_id: '70000000-0000-4000-8000-000000000001',
    p_latitude: 35, p_longitude: 139, p_accuracy_meters: 10,
    p_device_recorded_at: null,
  })
  const cases = [
    { session: { ...valid.session, projectId: undefined }, event: valid.event },
    { session: { ...valid.session, unknownServerField: 'secret' }, event: valid.event },
    { session: { ...valid.session, status: 'approved' }, event: valid.event },
    { session: valid.session, event: { ...valid.event, result: 'outside' } },
    { session: {
      ...valid.session,
      workPoints: [{
        workPointId: '73000000-0000-4000-8000-000000000001',
        sessionId: valid.session.sessionId, ordinal: 1, areaName: '', workDescription: '', completionNote: '',
        createdAt: valid.session.openedAt, updatedAt: valid.session.openedAt,
        photos: { before: { uploadStatus: 'active' }, after: null },
      }],
    }, event: valid.event },
  ]
  delete cases[0].session.projectId
  for (const data of cases) {
    const service = createAttendanceService({ rpc: async () => ({ data, error: null }) }, { configured: true })
    await assert.rejects(
      () => service.clockIn({
        projectId: 'P001', requestId: valid.event.requestId,
        location: { latitude: 35, longitude: 139, accuracyMeters: 10, deviceRecordedAt: null },
        abnormalReason: null,
      }),
      (error) => error.code === 'ATTENDANCE_INVALID_RESPONSE' && !error.message.includes('secret'),
    )
  }
})
```

- [ ] **Step 4: Run service tests GREEN**

Run:

```bash
node --test src/services/attendanceService.test.js
```

Expected: all nine RPC calls, input boundaries, DTO validation and safe error cases pass.

- [ ] **Step 5: Commit Task 3 only**

```bash
git add src/services/attendanceService.js src/services/attendanceService.test.js
git commit -m "feat: add secure attendance rpc client"
```

---

### Task 4: Private photo transport and retry-safe upload state

**Files:**
- Create: `src/services/attendancePhotoStorage.js`
- Create: `src/services/attendancePhotoStorage.test.js`
- Create: `src/features/attendance/attendancePhotoUploadState.js`
- Create: `src/features/attendance/attendancePhotoUploadState.test.js`

**Interfaces:**
- Consumes: photo constants and `validateAttendancePhotoFile(file)` from Task 1; `supabase` and `isSupabaseConfigured`.
- Produces: `AttendancePhotoStorageError`, `createAttendancePhotoStorage(client, { configured })`, singleton `attendancePhotoStorage`, `uploadReservedPhoto({ reservation, file })`, and `createAttendancePhotoSignedUrl({ photo })`.
- Produces: `createAttendancePhotoUploadState()`, `attendancePhotoUploadReducer(state, action)`, `canRetryAttendancePhotoUpload(state)` with phases `idle`, `selected`, `reserving`, `uploading`, `confirming`, `active`, `failed`, `cleanup_pending`.

- [ ] **Step 1: Write failing Storage adapter tests**

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createAttendancePhotoStorage } from './attendancePhotoStorage.js'

const source = await readFile(new URL('./attendancePhotoStorage.js', import.meta.url), 'utf8').catch(() => '')
const reservation = {
  photoId: '74000000-0000-4000-8000-000000000001',
  bucketId: 'erp-attendance-photos',
  objectPath: 'employee/session/point/photo/before',
  originalFileName: '原始名.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 4,
  uploadStatus: 'pending',
}

test('upload uses only the reserved private path and never overwrites', async () => {
  const calls = []
  const bucket = {
    async upload(...args) { calls.push(['upload', ...args]); return { data: { path: args[0] }, error: null } },
    async createSignedUrl(...args) { calls.push(['signed', ...args]); return { data: { signedUrl: 'https://signed.invalid/photo' }, error: null } },
  }
  const storage = createAttendancePhotoStorage({ storage: { from(name) { calls.push(['from', name]); return bucket } } }, { configured: true })
  const file = { name: '原始名.jpg', type: 'image/jpeg', size: 4 }
  assert.deepEqual(await storage.uploadReservedPhoto({ reservation, file }), {
    bucketId: 'erp-attendance-photos', objectPath: reservation.objectPath, uploaded: true,
  })
  assert.deepEqual(calls[1], ['upload', reservation.objectPath, file, {
    contentType: 'image/jpeg', cacheControl: '0', upsert: false,
  }])
  assert.equal(Object.hasOwn(await storage.uploadReservedPhoto({ reservation, file }), 'uploadStatus'), false)
})

test('signed URLs are only for server-returned active photos and always live 300 seconds', async () => {
  const calls = []
  const storage = createAttendancePhotoStorage({ storage: { from(name) { return {
    async createSignedUrl(path, ttl) { calls.push([name, path, ttl]); return { data: { signedUrl: 'https://signed.invalid/photo' }, error: null } },
  } } } }, { configured: true })
  const url = await storage.createAttendancePhotoSignedUrl({ photo: { ...reservation, uploadStatus: 'active' } })
  assert.equal(url, 'https://signed.invalid/photo')
  assert.deepEqual(calls, [['erp-attendance-photos', reservation.objectPath, 300]])
  await assert.rejects(() => storage.createAttendancePhotoSignedUrl({ photo: reservation }))
})

test('transport source has no public URL, overwrite, update or delete path', () => {
  assert.doesNotMatch(source, /getPublicUrl|upsert:\s*true|\.update\(|\.remove\(|\.delete\(/)
})
```

Add an exact zero-call mismatch test:

```js
test('reservation mismatch and unconfigured storage fail before network I/O', async () => {
  let storageCalls = 0
  const client = { storage: { from() { storageCalls += 1; throw new Error('must not run') } } }
  const storage = createAttendancePhotoStorage(client, { configured: true })
  const file = { name: 'a.jpg', type: 'image/jpeg', size: 4 }
  for (const bad of [
    { ...reservation, bucketId: 'public-bucket' },
    { ...reservation, objectPath: '' },
    { ...reservation, originalFileName: 'other.jpg' },
    { ...reservation, contentType: 'image/png' },
    { ...reservation, sizeBytes: 5 },
    { ...reservation, uploadStatus: 'active' },
  ]) await assert.rejects(() => storage.uploadReservedPhoto({ reservation: bad, file }))
  await assert.rejects(() => createAttendancePhotoStorage(client, { configured: false })
    .uploadReservedPhoto({ reservation, file }))
  assert.equal(storageCalls, 0)
})
```

- [ ] **Step 2: Write failing upload-state reducer tests**

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  attendancePhotoUploadReducer,
  canRetryAttendancePhotoUpload,
  createAttendancePhotoUploadState,
} from './attendancePhotoUploadState.js'

test('upload only becomes active after finalize succeeds', () => {
  const file = { name: 'a.jpg', type: 'image/jpeg', size: 4 }
  const reservation = { photoId: 'photo-1', uploadStatus: 'pending' }
  let state = createAttendancePhotoUploadState()
  state = attendancePhotoUploadReducer(state, { type: 'select', file })
  state = attendancePhotoUploadReducer(state, { type: 'reserve-start' })
  state = attendancePhotoUploadReducer(state, { type: 'reserve-success', reservation })
  state = attendancePhotoUploadReducer(state, { type: 'upload-success' })
  assert.equal(state.phase, 'confirming')
  assert.equal(state.activePhoto, null)
  state = attendancePhotoUploadReducer(state, { type: 'finalize-success', photo: { photoId: 'photo-1', uploadStatus: 'active' } })
  assert.equal(state.phase, 'active')
  assert.equal(state.activePhoto.uploadStatus, 'active')
})

test('uncertain finalize failures keep reservation for finalize-only retry', () => {
  const reservation = { photoId: 'photo-1', uploadStatus: 'pending' }
  const state = attendancePhotoUploadReducer({
    ...createAttendancePhotoUploadState(), phase: 'confirming', reservation,
  }, { type: 'finalize-failure', errorCode: 'ATTENDANCE_SERVICE_UNAVAILABLE' })
  assert.equal(state.phase, 'failed')
  assert.equal(state.failedStage, 'finalize')
  assert.equal(state.reservation, reservation)
  assert.equal(canRetryAttendancePhotoUpload(state), true)
})

test('abandon reaches cleanup_pending and reset does not mutate another state', () => {
  const first = attendancePhotoUploadReducer({
    ...createAttendancePhotoUploadState(), phase: 'failed', failedStage: 'upload',
  }, { type: 'abandon-success' })
  const second = createAttendancePhotoUploadState()
  assert.equal(first.phase, 'cleanup_pending')
  assert.equal(second.phase, 'idle')
})

test('a pending reservation restored after reload is finalize-retryable', () => {
  const reservation = { photoId: 'photo-restored', uploadStatus: 'pending' }
  const state = attendancePhotoUploadReducer(
    createAttendancePhotoUploadState(),
    { type: 'hydrate-pending', reservation },
  )
  assert.equal(state.phase, 'failed')
  assert.equal(state.failedStage, 'finalize')
  assert.equal(state.reservation, reservation)
  assert.equal(canRetryAttendancePhotoUpload(state), true)
})
```

- [ ] **Step 3: Run both tests RED**

Run:

```bash
node --test src/services/attendancePhotoStorage.test.js src/features/attendance/attendancePhotoUploadState.test.js
```

Expected: FAIL because both implementation modules do not exist.

- [ ] **Step 4: Implement the Storage adapter**

```js
import {
  ATTENDANCE_PHOTO_BUCKET,
  ATTENDANCE_SIGNED_URL_TTL_SECONDS,
  validateAttendancePhotoFile,
} from '../features/attendance/attendancePhotoDomain.js'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'

export class AttendancePhotoStorageError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AttendancePhotoStorageError'
    this.code = code
  }
}

const fail = (code, message) => new AttendancePhotoStorageError(code, message)

export function createAttendancePhotoStorage(client = supabase, { configured = isSupabaseConfigured } = {}) {
  const ensureStorage = () => {
    if (!configured || !client?.storage || typeof client.storage.from !== 'function') {
      throw fail('ATTENDANCE_STORAGE_NOT_CONFIGURED', '照片存储服务未配置')
    }
  }
  return Object.freeze({
    async uploadReservedPhoto({ reservation, file }) {
      ensureStorage()
      const metadata = validateAttendancePhotoFile(file)
      if (reservation?.bucketId !== ATTENDANCE_PHOTO_BUCKET ||
          reservation?.uploadStatus !== 'pending' ||
          typeof reservation?.objectPath !== 'string' || !reservation.objectPath ||
          reservation.originalFileName !== metadata.originalFileName ||
          reservation.contentType !== metadata.contentType ||
          reservation.sizeBytes !== metadata.sizeBytes) {
        throw fail('ATTENDANCE_STORAGE_RESERVATION_MISMATCH', '照片与服务器预约不一致')
      }
      let result
      try {
        result = await client.storage.from(reservation.bucketId).upload(
          reservation.objectPath,
          file,
          { contentType: reservation.contentType, cacheControl: '0', upsert: false },
        )
      } catch {
        throw fail('ATTENDANCE_STORAGE_UPLOAD_FAILED', '照片上传失败，请重试')
      }
      if (result?.error) throw fail('ATTENDANCE_STORAGE_UPLOAD_FAILED', '照片上传失败，请重试')
      return { bucketId: reservation.bucketId, objectPath: reservation.objectPath, uploaded: true }
    },
    async createAttendancePhotoSignedUrl({ photo }) {
      ensureStorage()
      if (photo?.bucketId !== ATTENDANCE_PHOTO_BUCKET || photo?.uploadStatus !== 'active' || !photo?.objectPath) {
        throw fail('ATTENDANCE_STORAGE_PHOTO_NOT_ACTIVE', '该照片尚不可查看')
      }
      let result
      try {
        result = await client.storage.from(photo.bucketId)
          .createSignedUrl(photo.objectPath, ATTENDANCE_SIGNED_URL_TTL_SECONDS)
      } catch {
        throw fail('ATTENDANCE_STORAGE_SIGN_FAILED', '暂时无法打开照片')
      }
      if (result?.error || typeof result?.data?.signedUrl !== 'string') {
        throw fail('ATTENDANCE_STORAGE_SIGN_FAILED', '暂时无法打开照片')
      }
      return result.data.signedUrl
    },
  })
}

export const attendancePhotoStorage = createAttendancePhotoStorage()
```

- [ ] **Step 5: Implement the pure upload reducer**

```js
export function createAttendancePhotoUploadState() {
  return {
    phase: 'idle', file: null, reservation: null, activePhoto: null,
    failedStage: null, errorCode: null,
  }
}

export function attendancePhotoUploadReducer(state, action) {
  switch (action.type) {
    case 'hydrate-pending':
      return {
        ...createAttendancePhotoUploadState(), phase: 'failed',
        reservation: action.reservation, failedStage: 'finalize',
        errorCode: 'ATTENDANCE_PHOTO_CONFIRMATION_PENDING',
      }
    case 'select':
      return { ...createAttendancePhotoUploadState(), phase: 'selected', file: action.file }
    case 'reserve-start':
      if (state.phase !== 'selected') return state
      return { ...state, phase: 'reserving', failedStage: null, errorCode: null }
    case 'reserve-success':
      if (state.phase !== 'reserving') return state
      return { ...state, phase: 'uploading', reservation: action.reservation }
    case 'reserve-failure':
      return { ...state, phase: 'failed', failedStage: 'reserve', errorCode: action.errorCode }
    case 'upload-success':
      if (state.phase !== 'uploading') return state
      return { ...state, phase: 'confirming' }
    case 'upload-failure':
      return { ...state, phase: 'failed', failedStage: 'upload', errorCode: action.errorCode }
    case 'finalize-retry':
      if (state.failedStage !== 'finalize' || !state.reservation) return state
      return { ...state, phase: 'confirming', errorCode: null }
    case 'finalize-success':
      return { ...state, phase: 'active', activePhoto: action.photo, file: null, reservation: null, failedStage: null, errorCode: null }
    case 'finalize-failure':
      return { ...state, phase: 'failed', failedStage: 'finalize', errorCode: action.errorCode }
    case 'abandon-start':
      return { ...state, phase: 'failed', failedStage: 'abandon', errorCode: null }
    case 'abandon-success':
      return { ...createAttendancePhotoUploadState(), phase: 'cleanup_pending' }
    case 'abandon-failure':
      return { ...state, phase: 'failed', failedStage: 'abandon', errorCode: action.errorCode }
    case 'reset':
      return createAttendancePhotoUploadState()
    default:
      return state
  }
}

export function canRetryAttendancePhotoUpload(state) {
  return state?.phase === 'failed' && (
    state.failedStage === 'reserve' || state.failedStage === 'upload' ||
    (state.failedStage === 'finalize' && Boolean(state.reservation))
  )
}
```

- [ ] **Step 6: Run both tests GREEN**

Run:

```bash
node --test src/services/attendancePhotoStorage.test.js src/features/attendance/attendancePhotoUploadState.test.js
```

Expected: adapter and reducer tests pass; upload success alone is never `active`.

- [ ] **Step 7: Commit Task 4 only**

```bash
git add src/services/attendancePhotoStorage.js src/services/attendancePhotoStorage.test.js src/features/attendance/attendancePhotoUploadState.js src/features/attendance/attendancePhotoUploadState.test.js
git commit -m "feat: add private attendance photo transport"
```

---

### Task 5: Attendance schema, trusted identity and clock-in transaction

**Files:**
- Create: `supabase/migrations/202607150003_today_attendance.sql`
- Create: `supabase/tests/today_attendance.sql`
- Create: `src/services/attendanceSchema.test.js`

**Interfaces:**
- Consumes: `public.employee_profiles`, `public.projects`, `public.is_current_employee_active()`, `public.set_updated_at()` and the project payload contract from committed migrations through `202607150001_project_core_security.sql`.
- Produces tables: `project_attendance_sessions`, `project_attendance_events`, `project_attendance_work_points`, `project_attendance_photos`.
- Produces private helpers: `current_attendance_employee()`, `is_attendance_project_eligible(text,jsonb)`, `attendance_distance_meters(float8,float8,float8,float8)`, `reject_attendance_event_mutation()`, `attendance_session_json(uuid)`, `current_attendance_viewer_scope(uuid)`.
- Produces public RPCs in this task: `list_attendance_projects_secure()`, `get_my_today_attendance_secure()`, and `clock_in_project_secure(text,uuid,float8,float8,numeric,timestamptz,text)`.

- [ ] **Step 1: Write the failing static schema contract**

Create `attendanceSchema.test.js` before the migration. It must assert exact object names and ensure no browser business-table policy is introduced:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sql = await readFile(
  new URL('../../supabase/migrations/202607150003_today_attendance.sql', import.meta.url),
  'utf8',
).catch(() => '')

const tables = [
  'project_attendance_sessions',
  'project_attendance_events',
  'project_attendance_work_points',
  'project_attendance_photos',
]

test('attendance schema is normalized, constrained and RPC-only', () => {
  for (const table of tables) {
    assert.match(sql, new RegExp(`create table public\\.${table}`, 'i'))
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'))
  }
  assert.match(sql, /project_attendance_one_open_session_idx/i)
  assert.match(sql, /project_attendance_photo_active_phase_idx/i)
  assert.match(sql, /project_attendance_photo_pending_phase_idx/i)
  assert.match(sql, /create trigger reject_attendance_event_mutation/i)
  assert.doesNotMatch(sql, /create policy[^;]+on public\.project_attendance_/is)
})

test('attendance migration closes helpers and grants only secure entry points', () => {
  for (const helper of [
    'current_attendance_employee', 'is_attendance_project_eligible',
    'attendance_distance_meters', 'attendance_session_json',
  ]) assert.match(sql, new RegExp(`revoke all on function private\\.${helper}`, 'i'))
  for (const rpc of [
    'list_attendance_projects_secure',
    'get_my_today_attendance_secure',
    'clock_in_project_secure',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${rpc}`, 'i'))
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}[^;]+to authenticated, service_role`, 'i'))
  }
  assert.doesNotMatch(sql, /module\.projects|module\.labor|labor_records|baseRecordService/i)
})

```

- [ ] **Step 2: Start pgTAP with schema, ACL, identity and project-list assertions**

Create `today_attendance.sql` with a fixed actor matrix: ordinary employee with zero permission keys, unrelated employee, current site assignee, former site assignee, president, SW-000, disabled employee, former employee, and must-change-password employee. Seed eligible and ineligible projects using service role. Begin with:

```sql
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, storage, extensions;
select no_plan();

select has_table('public', 'project_attendance_sessions');
select has_table('public', 'project_attendance_events');
select has_table('public', 'project_attendance_work_points');
select has_table('public', 'project_attendance_photos');
select has_function('public', 'list_attendance_projects_secure', array[]::text[]);
select has_function('public', 'get_my_today_attendance_secure', array[]::text[]);
select has_function(
  'public', 'clock_in_project_secure',
  array['text','uuid','double precision','double precision','numeric','timestamp with time zone','text']
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000001','authenticated','authenticated','attendance-ordinary@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000002','authenticated','authenticated','attendance-disabled@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000003','authenticated','authenticated','attendance-former@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000004','authenticated','authenticated','attendance-password@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000005','authenticated','authenticated','attendance-other@auth.invalid','',now(),'{}','{}',now(),now());

insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password, is_hidden_system_account
) values
  ('62000000-0000-4000-8000-000000000001','SW-6101','61000000-0000-4000-8000-000000000001','零模块普通员工','工程部','小工','在职','active',false,false),
  ('62000000-0000-4000-8000-000000000002','SW-6102','61000000-0000-4000-8000-000000000002','停用员工','工程部','小工','在职','disabled',false,false),
  ('62000000-0000-4000-8000-000000000003','SW-6103','61000000-0000-4000-8000-000000000003','离职员工','工程部','小工','离职','active',false,false),
  ('62000000-0000-4000-8000-000000000004','SW-6104','61000000-0000-4000-8000-000000000004','待改密员工','工程部','小工','在职','active',true,false),
  ('62000000-0000-4000-8000-000000000005','SW-6105','61000000-0000-4000-8000-000000000005','无关员工','工程部','小工','在职','active',false,false);

create or replace function pg_temp.attendance_project_payload(
  p_id text, p_name text, p_status text, p_radius numeric,
  p_confirmed text, p_snapshot text
) returns jsonb language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'projectId', p_id, 'projectName', p_name, 'status', p_status,
    'address', '東京都 千代田区 1-1', 'latitude', 35.681236,
    'longitude', 139.767125, 'attendanceRadiusMeters', p_radius,
    'locationConfirmedAt', p_confirmed,
    'locationAddressSnapshot', p_snapshot,
    'siteAssigneeEmployeeId', ''
  );
$$;

insert into public.projects(record_key, payload, status) values
  ('ATT-ELIGIBLE', pg_temp.attendance_project_payload('ATT-ELIGIBLE','合法现场','进行中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'), 'active'),
  ('ATT-UNCONFIRMED', pg_temp.attendance_project_payload('ATT-UNCONFIRMED','未确认现场','进行中',300,'','東京都 千代田区 1-1'), 'active'),
  ('ATT-WRONG-STATUS', pg_temp.attendance_project_payload('ATT-WRONG-STATUS','报价现场','报价中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'), 'active'),
  ('ATT-BAD-RADIUS', pg_temp.attendance_project_payload('ATT-BAD-RADIUS','错误半径','进行中',0,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'), 'active'),
  ('ATT-DELETED', pg_temp.attendance_project_payload('ATT-DELETED','已删除现场','进行中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'), 'deleted');

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select is(public.has_current_permission('module.projects.view'), false, 'ordinary fixture has zero project view permission');
select results_eq(
  $$ select project->>'projectId' from public.list_attendance_projects_secure() project $$,
  $$ values ('ATT-ELIGIBLE'::text) $$,
  'attendance list ignores project-module permission but hides every ineligible project'
);
reset role;

set local role anon;
select throws_ok(
  $$ select * from public.list_attendance_projects_secure() $$,
  '42501', null, 'anonymous attendance project list is denied'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select throws_ok($$ select * from public.list_attendance_projects_secure() $$, '42501', null, 'disabled employee is denied');
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
select throws_ok($$ select * from public.list_attendance_projects_secure() $$, '42501', null, 'former employee is denied');
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000004', true);
select throws_ok($$ select * from public.list_attendance_projects_secure() $$, '42501', null, 'must-change-password employee is denied');
reset role;

select table_privs_are('public','project_attendance_sessions','authenticated',array[]::text[]);
select table_privs_are('public','project_attendance_events','authenticated',array[]::text[]);
select table_privs_are('public','project_attendance_work_points','authenticated',array[]::text[]);
select table_privs_are('public','project_attendance_photos','authenticated',array[]::text[]);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename like 'project_attendance_%'),
  0,
  'business tables have no browser policies'
);

select * from finish();
rollback;
```

Extend this fixture in later database tasks with current/former现场担当, unrelated employee, president and SW-000 fixed identities; keep all fixture writes inside this rolled-back pgTAP transaction.

- [ ] **Step 3: Run static and pgTAP contracts RED**

Run:

```bash
node --test src/services/attendanceSchema.test.js
npx supabase test db supabase/tests/today_attendance.sql
```

Expected: static test fails because `003` is absent; pgTAP fails on missing tables/functions. Run pgTAP in an isolated worktree that excludes the untracked `202607150002_project_documents.sql`. If Docker or local Supabase is unavailable, record the exact error and keep the integration test marked unverified.

- [ ] **Step 4: Create all four tables, checks, indexes and immutable event trigger**

Begin the migration transaction and add complete DDL. Use named checks so pgTAP can address each invariant:

```sql
begin;

create table public.project_attendance_sessions (
  session_id uuid primary key default gen_random_uuid(),
  employee_profile_id uuid not null references public.employee_profiles(id) on delete restrict,
  employee_number_snapshot text not null,
  employee_name_snapshot text not null,
  project_id text not null references public.projects(record_key) on delete restrict,
  project_name_snapshot text not null,
  project_address_snapshot text not null,
  project_latitude_snapshot double precision not null,
  project_longitude_snapshot double precision not null,
  attendance_radius_meters_snapshot numeric not null,
  work_date date not null,
  status text not null default 'open',
  opened_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_session_employee_number_check check (btrim(employee_number_snapshot) <> ''),
  constraint attendance_session_employee_name_check check (btrim(employee_name_snapshot) <> ''),
  constraint attendance_session_project_name_check check (btrim(project_name_snapshot) <> ''),
  constraint attendance_session_project_address_check check (btrim(project_address_snapshot) <> ''),
  constraint attendance_session_latitude_check check (project_latitude_snapshot between -90 and 90),
  constraint attendance_session_longitude_check check (project_longitude_snapshot between -180 and 180),
  constraint attendance_session_radius_check check (attendance_radius_meters_snapshot > 0),
  constraint attendance_session_status_check check (status in ('open', 'closed')),
  constraint attendance_session_closed_check check (
    (status = 'open' and closed_at is null) or
    (status = 'closed' and closed_at is not null and closed_at >= opened_at)
  )
);

create unique index project_attendance_one_open_session_idx
  on public.project_attendance_sessions(employee_profile_id) where status = 'open';
create index project_attendance_employee_day_idx
  on public.project_attendance_sessions(employee_profile_id, work_date, opened_at desc, session_id);
create index project_attendance_project_day_idx
  on public.project_attendance_sessions(project_id, work_date, opened_at desc, session_id);
create index project_attendance_day_cursor_idx
  on public.project_attendance_sessions(work_date, opened_at desc, session_id);

create table public.project_attendance_events (
  event_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.project_attendance_sessions(session_id) on delete restrict,
  event_type text not null,
  request_id uuid not null unique,
  server_recorded_at timestamptz not null,
  device_recorded_at timestamptz,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters numeric not null,
  distance_meters numeric not null,
  radius_meters numeric not null,
  result text not null,
  abnormal_reason text,
  created_at timestamptz not null default statement_timestamp(),
  constraint attendance_event_session_type_unique unique(session_id, event_type),
  constraint attendance_event_type_check check (event_type in ('clock_in', 'clock_out')),
  constraint attendance_event_latitude_check check (latitude between -90 and 90),
  constraint attendance_event_longitude_check check (longitude between -180 and 180),
  constraint attendance_event_accuracy_check check (accuracy_meters > 0),
  constraint attendance_event_distance_check check (distance_meters >= 0),
  constraint attendance_event_radius_check check (radius_meters > 0),
  constraint attendance_event_result_check check (result in ('normal', 'abnormal')),
  constraint attendance_event_reason_check check (
    (result = 'normal' and abnormal_reason is null) or
    (result = 'abnormal' and abnormal_reason = btrim(abnormal_reason)
      and char_length(abnormal_reason) between 1 and 500)
  )
);

create table public.project_attendance_work_points (
  work_point_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.project_attendance_sessions(session_id) on delete restrict,
  ordinal smallint not null,
  area_name text not null default '',
  work_description text not null default '',
  completion_note text not null default '',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_work_point_session_ordinal_unique unique(session_id, ordinal),
  constraint attendance_work_point_ordinal_check check (ordinal between 1 and 7),
  constraint attendance_work_point_area_check check (area_name = btrim(area_name) and char_length(area_name) <= 100),
  constraint attendance_work_point_description_check check (work_description = btrim(work_description) and char_length(work_description) <= 1000),
  constraint attendance_work_point_completion_check check (completion_note = btrim(completion_note) and char_length(completion_note) <= 1000)
);

create table public.project_attendance_photos (
  photo_id uuid primary key default gen_random_uuid(),
  work_point_id uuid not null references public.project_attendance_work_points(work_point_id) on delete restrict,
  phase text not null,
  bucket_id text not null,
  object_path text not null unique,
  original_file_name text not null,
  content_type text not null,
  size_bytes bigint not null,
  checksum_sha256 text,
  upload_status text not null default 'pending',
  captured_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_photo_phase_check check (phase in ('before', 'after')),
  constraint attendance_photo_bucket_check check (bucket_id = 'erp-attendance-photos'),
  constraint attendance_photo_path_check check (btrim(object_path) <> ''),
  constraint attendance_photo_name_check check (
    original_file_name = btrim(original_file_name) and char_length(original_file_name) between 1 and 255
    and original_file_name !~ '[[:cntrl:]]'
  ),
  constraint attendance_photo_type_check check (content_type in (
    'image/jpeg','image/png','image/webp','image/heic','image/heif'
  )),
  constraint attendance_photo_size_check check (size_bytes between 1 and 20971520),
  constraint attendance_photo_checksum_check check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint attendance_photo_status_check check (upload_status in ('pending','active','superseded','cleanup_pending'))
);

create unique index project_attendance_photo_active_phase_idx
  on public.project_attendance_photos(work_point_id, phase) where upload_status = 'active';
create unique index project_attendance_photo_pending_phase_idx
  on public.project_attendance_photos(work_point_id, phase) where upload_status = 'pending';
create index project_attendance_photo_cleanup_idx
  on public.project_attendance_photos(upload_status, updated_at)
  where upload_status in ('pending','superseded','cleanup_pending');
```

Add timestamp and immutable-event triggers:

```sql
create trigger set_project_attendance_sessions_updated_at
before update on public.project_attendance_sessions
for each row execute function public.set_updated_at();
create trigger set_project_attendance_work_points_updated_at
before update on public.project_attendance_work_points
for each row execute function public.set_updated_at();
create trigger set_project_attendance_photos_updated_at
before update on public.project_attendance_photos
for each row execute function public.set_updated_at();

create or replace function private.reject_attendance_event_mutation()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'attendance events are immutable';
end;
$$;
revoke all on function private.reject_attendance_event_mutation()
  from public, anon, authenticated, service_role;
create trigger reject_attendance_event_mutation
before update or delete on public.project_attendance_events
for each row execute function private.reject_attendance_event_mutation();
```

- [ ] **Step 5: Close direct table access and implement private identity/location helpers**

Apply RLS and ACL to each table without creating any policy on those tables:

```sql
alter table public.project_attendance_sessions enable row level security;
alter table public.project_attendance_events enable row level security;
alter table public.project_attendance_work_points enable row level security;
alter table public.project_attendance_photos enable row level security;

revoke all on table public.project_attendance_sessions from public, anon, authenticated;
revoke all on table public.project_attendance_events from public, anon, authenticated;
revoke all on table public.project_attendance_work_points from public, anon, authenticated;
revoke all on table public.project_attendance_photos from public, anon, authenticated;
grant all on table public.project_attendance_sessions to service_role;
grant all on table public.project_attendance_events to service_role;
grant all on table public.project_attendance_work_points to service_role;
grant all on table public.project_attendance_photos to service_role;
```

Implement `private.current_attendance_employee()` as `STABLE SECURITY DEFINER` with fixed search path and this exact predicate:

```sql
select employee.*
from public.employee_profiles employee
where employee.auth_user_id = auth.uid()
  and employee.employment_status = '在职'
  and employee.account_status = 'active'
  and employee.must_change_password = false
  and employee.deleted_at is null;
```

Raise `42501` when it finds no row. Implement project eligibility inside an exception-safe PL/pgSQL function: envelope `p_record_status <> 'deleted'`, payload object, status `待开工/进行中`, nonblank project name/address/confirmation, finite JSON numbers within coordinate bounds, strictly positive raw radius, and normalized address equality using:

```sql
regexp_replace(btrim(normalize(value, NFKC)), '[[:space:]]+', ' ', 'g')
```

Implement Haversine with Earth radius 6,371,000 and clamp the square-root input to `0..1`:

```sql
create or replace function private.attendance_distance_meters(
  p_latitude_a double precision, p_longitude_a double precision,
  p_latitude_b double precision, p_longitude_b double precision
) returns double precision
language sql immutable strict
set search_path = pg_catalog
as $$
  select 2 * 6371000 * asin(sqrt(least(1::double precision, greatest(0::double precision,
    power(sin(radians(p_latitude_b - p_latitude_a) / 2), 2) +
    cos(radians(p_latitude_a)) * cos(radians(p_latitude_b)) *
    power(sin(radians(p_longitude_b - p_longitude_a) / 2), 2)
  ))));
$$;
```

Revoke every private helper from `public, anon, authenticated, service_role`.

- [ ] **Step 6: Implement the canonical nested session serializer**

`private.attendance_session_json(p_session_id uuid)` must return one DTO and no raw row. Use `jsonb_build_object` with these exact keys:

```text
sessionId, employeeProfileId, employeeNumberSnapshot, employeeNameSnapshot,
projectId, projectNameSnapshot, projectAddressSnapshot,
projectLatitudeSnapshot, projectLongitudeSnapshot,
attendanceRadiusMetersSnapshot, workDate, status, openedAt, closedAt,
clockInEvent, clockOutEvent, workPoints
```

Each event contains exactly:

```text
eventId, requestId, eventType, serverRecordedAt, deviceRecordedAt,
latitude, longitude, accuracyMeters, distanceMeters, radiusMeters,
result, abnormalReason
```

Each point contains exactly:

```text
workPointId, sessionId, ordinal, areaName, workDescription,
completionNote, createdAt, updatedAt, photos
```

`photos` is `{ "before": photo-or-null, "after": photo-or-null }`, and only `upload_status = 'active'` is projected. Photo DTO keys are exactly:

```text
photoId, workPointId, phase, bucketId, objectPath, originalFileName,
contentType, sizeBytes, uploadStatus, capturedAt, createdAt
```

Order points by ordinal, events by type, and use `coalesce(jsonb_agg(projected_value order by ordinal), '[]'::jsonb)`. Revoke serializer execution from every browser/service role.

- [ ] **Step 7: Implement project list and today recovery RPCs**

`list_attendance_projects_secure()` calls `current_attendance_employee()` but does not call `has_current_permission`. Return only exact safe project fields:

```sql
select jsonb_build_object(
  'projectId', project.record_key,
  'projectName', project.payload->>'projectName',
  'status', project.payload->>'status',
  'address', project.payload->>'address',
  'latitude', (project.payload->>'latitude')::double precision,
  'longitude', (project.payload->>'longitude')::double precision,
  'attendanceRadiusMeters', (project.payload->>'attendanceRadiusMeters')::numeric,
  'locationConfirmedAt', project.payload->>'locationConfirmedAt',
  'locationAddressSnapshot', project.payload->>'locationAddressSnapshot'
)
from public.projects project
where private.is_attendance_project_eligible(project.status, project.payload)
order by project.payload->>'projectName', project.record_key;
```

`get_my_today_attendance_secure()` uses one `statement_timestamp()` value and `timezone('Asia/Tokyo', timestamp)::date`. It returns any open session regardless of its work date, completed sessions only for that Tokyo date, and top-level `pendingPhotoReservations` containing only this actor's `pending` photos under the open session. Pending reservations use the exact photo DTO so a reload can retry finalize or abandon; record-manager projections remain active-only. It also returns server-derived:

```json
"viewerAccess": { "scope": "own|assigned_projects|all", "canViewScopedRecords": false }
```

`canViewScopedRecords` is true only for `assigned_projects` or `all`. `all` requires current actor position `社长` or employee number `SW-000`; `assigned_projects` requires a current nondeleted project payload whose `siteAssigneeEmployeeId` equals the actor UUID string.

- [ ] **Step 8: Implement clock-in with idempotency and fixed lock order**

Implement exact signature:

```sql
public.clock_in_project_secure(
  p_project_id text,
  p_request_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_device_recorded_at timestamptz default null,
  p_abnormal_reason text default null
) returns jsonb
```

The transaction body must execute in this order:

1. Resolve current active employee and validate UUID, coordinates, positive accuracy and trimmed reason length.
2. `pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0))`.
3. Look up existing event by request UUID. Return the same `{ session, event }` only when it is the actor's `clock_in` and its session project equals `p_project_id`; any other employee, type or project reuse raises `22023` with hint `ATTENDANCE_REQUEST_CONFLICT`.
4. `pg_advisory_xact_lock(hashtextextended(actor.id::text, 1))`.
5. Refuse any existing open session with hint `ATTENDANCE_OPEN_SESSION_EXISTS`.
6. Lock the project row, call strict project eligibility, and copy its name/address/coordinates/radius snapshot.
7. Set one `server_recorded_at := statement_timestamp()` and derive `work_date := timezone('Asia/Tokyo', server_recorded_at)::date`.
8. Compute server distance. If `distance + accuracy <= radius`, force result `normal` and reason `null`; otherwise require a trimmed 1–500 reason or raise with hint `ATTENDANCE_ABNORMAL_REASON_REQUIRED`.
9. Insert session, then immutable event, then return:

```sql
jsonb_build_object(
  'session', private.attendance_session_json(new_session_id),
  'event', private.attendance_event_json(new_event_id)
)
```

Create `private.attendance_event_json(uuid)` as a private exact-key serializer used by both clock RPCs. Do not accept any employee, work-date, distance, result or snapshot parameter.

- [ ] **Step 9: Revoke defaults and grant only public RPC entry points**

Revoke exact private signatures, including:

```sql
revoke all on function private.current_attendance_employee() from public, anon, authenticated, service_role;
revoke all on function private.is_attendance_project_eligible(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.attendance_distance_meters(double precision, double precision, double precision, double precision) from public, anon, authenticated, service_role;
revoke all on function private.attendance_event_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.attendance_session_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.current_attendance_viewer_scope(uuid) from public, anon, authenticated, service_role;
```

For each public RPC first revoke all four roles, then:

```sql
grant execute on function public.list_attendance_projects_secure() to authenticated, service_role;
grant execute on function public.get_my_today_attendance_secure() to authenticated, service_role;
grant execute on function public.clock_in_project_secure(
  text, uuid, double precision, double precision, numeric, timestamptz, text
) to authenticated, service_role;
```

Keep the migration transaction open for Tasks 6 and 7 only in the plan text; the actual SQL file must be syntactically complete after this task and end with `commit;`. Later tasks insert new definitions before that final `commit;`.

- [ ] **Step 10: Extend pgTAP for trusted clock-in and run GREEN**

Use a temporary result table so repeated calls can be compared without client variables:

```sql
create temporary table attendance_clock_results(
  result_name text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert on attendance_clock_results to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
insert into attendance_clock_results values (
  'boundary_first',
  public.clock_in_project_secure(
    'ATT-ELIGIBLE', '63000000-0000-4000-8000-000000000001',
    35.681236, 139.767125, 300, '2026-01-01T00:00:00Z', null
  )
);
insert into attendance_clock_results values (
  'boundary_retry',
  public.clock_in_project_secure(
    'ATT-ELIGIBLE', '63000000-0000-4000-8000-000000000001',
    35.681236, 139.767125, 300, '2026-01-01T00:00:00Z', null
  )
);
select is(
  (select payload#>>'{event,result}' from attendance_clock_results where result_name = 'boundary_first'),
  'normal',
  'distance zero plus accuracy exactly radius is normal'
);
select is(
  (select payload#>>'{event,eventId}' from attendance_clock_results where result_name = 'boundary_first'),
  (select payload#>>'{event,eventId}' from attendance_clock_results where result_name = 'boundary_retry'),
  'same request returns the same immutable event'
);
select is(
  (select count(*)::integer from public.project_attendance_sessions
   where employee_profile_id = '62000000-0000-4000-8000-000000000001'),
  1,
  'idempotent retry creates one session'
);
reset role;
```

Continue with concrete destructive cases on the second active employee:

```sql
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select is(
  (select (payload#>>'{session,workDate}')::date from attendance_clock_results where result_name = 'boundary_first'),
  (select timezone('Asia/Tokyo', (payload#>>'{event,serverRecordedAt}')::timestamptz)::date
   from attendance_clock_results where result_name = 'boundary_first'),
  'work date comes from server time in Tokyo'
);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000002',
    35.681236,139.767125,10,null,null
  ) $$,
  '55000',null,'a different request cannot create a second open session'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000003',
    91,139.767125,10,null,null
  ) $$,
  '22023',null,'invalid latitude is rejected before writing'
);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000004',
    35.681236,139.767125,300.001,null,null
  ) $$,
  '22023',null,'0.001 beyond the radius requires an abnormal reason'
);
insert into attendance_clock_results values (
  'abnormal_other',
  public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000004',
    35.681236,139.767125,300.001,null,' 入口封闭 '
  )
);
select is(
  (select payload#>>'{event,result}' from attendance_clock_results where result_name = 'abnormal_other'),
  'abnormal','over-radius event is explicitly abnormal'
);
select is(
  (select payload#>>'{event,abnormalReason}' from attendance_clock_results where result_name = 'abnormal_other'),
  '入口封闭','abnormal reason is trimmed'
);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000001',
    35.681236,139.767125,1,null,null
  ) $$,
  '22023',null,'cross-employee request reuse conflicts'
);
reset role;

update public.projects set payload = payload || jsonb_build_object(
  'latitude', 34.0, 'longitude', 135.0, 'attendanceRadiusMeters', 50
) where record_key = 'ATT-ELIGIBLE';
select is(
  (select project_latitude_snapshot from public.project_attendance_sessions
   where employee_profile_id = '62000000-0000-4000-8000-000000000001' and status = 'open'),
  35.681236::double precision,
  'project edits never mutate the session latitude snapshot'
);
select throws_ok(
  $$ update public.project_attendance_events set latitude = 0
     where request_id = '63000000-0000-4000-8000-000000000001' $$,
  '42501',null,'attendance event update is rejected'
);
select throws_ok(
  $$ delete from public.project_attendance_events
     where request_id = '63000000-0000-4000-8000-000000000001' $$,
  '42501',null,'attendance event delete is rejected'
);
update public.projects set payload = payload || jsonb_build_object(
  'latitude', 35.681236, 'longitude', 139.767125, 'attendanceRadiusMeters', 300
) where record_key = 'ATT-ELIGIBLE';
update public.project_attendance_sessions
set status = 'closed', closed_at = statement_timestamp()
where employee_profile_id = '62000000-0000-4000-8000-000000000005' and status = 'open';
```

The clock-in RPC raises the second-open case with SQLSTATE `55000` and stable hint `ATTENDANCE_OPEN_SESSION_EXISTS`; the partial unique index remains the final concurrency backstop.

Run:

```bash
node --test src/services/attendanceSchema.test.js
npx supabase test db supabase/tests/today_attendance.sql
```

Expected: static schema assertions and all Task 5 pgTAP assertions pass in the clean migration sequence.

- [ ] **Step 11: Commit Task 5 only**

```bash
git add supabase/migrations/202607150003_today_attendance.sql supabase/tests/today_attendance.sql src/services/attendanceSchema.test.js
git commit -m "feat: add trusted attendance clock in"
```

---

### Task 6: Work points, private photo lifecycle and clock-out

**Files:**
- Modify: `supabase/migrations/202607150003_today_attendance.sql`
- Modify: `supabase/tests/today_attendance.sql`
- Modify: `src/services/attendanceSchema.test.js`

**Interfaces:**
- Consumes: Task 5 tables, current actor, distance and exact-key serializers.
- Produces public RPCs: `upsert_attendance_work_point_secure(uuid,smallint,text,text,text)`, `reserve_attendance_photo_secure(uuid,text,text,text,bigint,text,timestamptz)`, `finalize_attendance_photo_secure(uuid)`, `abandon_attendance_photo_secure(uuid)`, `clock_out_project_secure(uuid,uuid,float8,float8,numeric,timestamptz,text)`.
- Produces public Storage predicates: `can_current_employee_view_attendance_session(uuid)`, `can_current_employee_upload_attendance_photo(text,text)`, `can_current_employee_view_attendance_photo(text,text)`.
- Produces bucket `erp-attendance-photos` and exact bucket-scoped policies.

- [ ] **Step 1: Add failing pgTAP for point limits and closed-session immutability**

Extend the existing actor/session fixture and assert:

```sql
create or replace function pg_temp.attendance_session_id(p_result_name text)
returns uuid language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select (payload#>>'{session,sessionId}')::uuid
  from attendance_clock_results where result_name = p_result_name;
$$;
grant execute on function pg_temp.attendance_session_id(text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.upsert_attendance_work_point_secure(
    pg_temp.attendance_session_id('boundary_first'), 1, ' 北侧墙面 ', ' 下地施工 ', ''
  ) $$,
  'owner can create the first point in an open session'
);

select is(
  (select area_name from public.project_attendance_work_points
   where session_id = pg_temp.attendance_session_id('boundary_first') and ordinal = 1),
  '北侧墙面',
  'point text is trimmed by the server'
);

select throws_ok(
  $$ select public.upsert_attendance_work_point_secure(
    pg_temp.attendance_session_id('boundary_first'), 8, '第八点', '不可创建', ''
  ) $$,
  '22023', null,
  'ordinal eight is rejected'
);

select throws_ok(
  $$ select public.upsert_attendance_work_point_secure(
    pg_temp.attendance_session_id('boundary_first'), 2, repeat('区', 101), '施工', ''
  ) $$,
  '22023', null,
  '101-character area is rejected'
);
select throws_ok(
  $$ select public.upsert_attendance_work_point_secure(
    pg_temp.attendance_session_id('boundary_first'), 2, '区域', repeat('工', 1001), ''
  ) $$,
  '22023', null,
  '1001-character description is rejected'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$ select public.upsert_attendance_work_point_secure(
    pg_temp.attendance_session_id('boundary_first'), 2, '区域', '施工', ''
  ) $$,
  '42501', null,
  'another employee cannot mutate the point'
);
reset role;

insert into public.project_attendance_sessions(
  session_id,employee_profile_id,employee_number_snapshot,employee_name_snapshot,
  project_id,project_name_snapshot,project_address_snapshot,
  project_latitude_snapshot,project_longitude_snapshot,
  attendance_radius_meters_snapshot,work_date,status,opened_at,closed_at
) values (
  '71000000-0000-4000-8000-000000000099','62000000-0000-4000-8000-000000000001',
  'SW-6101','零模块普通员工','ATT-ELIGIBLE','合法现场','東京都 千代田区 1-1',
  35.681236,139.767125,300,'2026-07-14','closed','2026-07-14T08:00:00Z','2026-07-14T17:00:00Z'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.upsert_attendance_work_point_secure(
    '71000000-0000-4000-8000-000000000099', 1, '区域', '施工', ''
  ) $$,
  '55000', null,
  'closed session is immutable'
);
reset role;
```

Then prove the seven-row/update invariant on the other employee's separate open fixture:

```sql
insert into public.project_attendance_sessions(
  session_id,employee_profile_id,employee_number_snapshot,employee_name_snapshot,
  project_id,project_name_snapshot,project_address_snapshot,
  project_latitude_snapshot,project_longitude_snapshot,
  attendance_radius_meters_snapshot,work_date,status,opened_at
) values (
  '71000000-0000-4000-8000-000000000098','62000000-0000-4000-8000-000000000005',
  'SW-6105','无关员工','ATT-ELIGIBLE','合法现场','東京都 千代田区 1-1',
  35.681236,139.767125,300,'2026-07-15','open','2026-07-15T08:00:00Z'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select lives_ok(
  $$ select public.upsert_attendance_work_point_secure(
    '71000000-0000-4000-8000-000000000098', ordinal::smallint,
    '点位' || ordinal, '施工' || ordinal, ''
  ) from generate_series(1, 7) ordinal $$,
  'ordinals one through seven coexist'
);
select is(
  (select count(*)::integer from public.project_attendance_work_points
   where session_id = '71000000-0000-4000-8000-000000000098'),
  7,
  'one session contains seven rows'
);
select lives_ok(
  $$ select public.upsert_attendance_work_point_secure(
    '71000000-0000-4000-8000-000000000098', 1, '更新点位', '更新施工', ''
  ) $$,
  'saving the same ordinal updates its row'
);
select is(
  (select count(*)::integer from public.project_attendance_work_points
   where session_id = '71000000-0000-4000-8000-000000000098'),
  7,
  'upsert never creates an eighth row'
);
reset role;
```

- [ ] **Step 2: Add failing pgTAP for reservation, Storage and replacement**

Use direct service-role insertion into `storage.objects` only to emulate the Storage gateway after policy checks. Assert all of these separately:

1. Reserve produces bucket `erp-attendance-photos` and path matching `^[uuid]/[uuid]/[uuid]/[uuid]/(before|after)$` without names or original filename.
2. Size 1 and 20 MiB work; 0 and 20 MiB + 1 fail.
3. Only the five exact MIME strings work; filename controls and a 65-character/uppercase checksum fail.
4. `after` reservation fails until `before` is active.
5. Owner may insert the one exact pending bucket/path; guessed path, other employee and closed session fail the Storage predicate.
6. Finalize fails if no object exists or metadata size/MIME differs.
7. Replacing an active phase makes the old row `superseded` and the new row `active` in one transaction.
8. Abandon changes only an owned, open-session `pending` row to `cleanup_pending`.
9. A closed session rejects reserve, finalize and abandon.
10. View predicate permits only `active` photos and applies owner/current担当/社长/SW-000 scope.

Extend `attendanceSchema.test.js` in the same RED step:

```js
test('attendance photo RPCs and Storage rules are bucket-scoped', () => {
  for (const rpc of [
    'upsert_attendance_work_point_secure', 'reserve_attendance_photo_secure',
    'finalize_attendance_photo_secure', 'abandon_attendance_photo_secure',
    'clock_out_project_secure',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${rpc}`, 'i'))
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}[^;]+to authenticated, service_role`, 'i'))
  }
  assert.match(sql, /'erp-attendance-photos'/)
  assert.match(sql, /20971520/)
  assert.match(sql, /attendance_photos_insert_guard/i)
  assert.match(sql, /attendance_photos_select_guard/i)
  assert.match(sql, /attendance_photos_update_deny/i)
  assert.match(sql, /attendance_photos_delete_deny/i)
  assert.doesNotMatch(sql, /delete from pg_policies|drop policy if exists (?!attendance_photos_)/i)
})
```

Use executable reservation/finalize assertions around point 1:

```sql
create temporary table attendance_photo_results(
  result_name text primary key, payload jsonb not null
) on commit drop;
grant select, insert on attendance_photo_results to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    (select work_point_id from public.project_attendance_work_points
     where session_id = pg_temp.attendance_session_id('boundary_first') and ordinal = 1),
    'after','after.jpg','image/jpeg',1,null,null
  ) $$,
  '55000',null,'after cannot be reserved before an active before photo'
);
insert into attendance_photo_results values (
  'before_pending',
  public.reserve_attendance_photo_secure(
    (select work_point_id from public.project_attendance_work_points
     where session_id = pg_temp.attendance_session_id('boundary_first') and ordinal = 1),
    'before','原始.jpg','image/jpeg',1,null,'2026-07-15T08:00:00Z'
  )
);
select is(
  (select payload->>'bucketId' from attendance_photo_results where result_name = 'before_pending'),
  'erp-attendance-photos','reservation uses the private attendance bucket'
);
select matches(
  (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending'),
  '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+/before$',
  'reservation path contains only server UUID segments and phase'
);
select is(
  public.get_my_today_attendance_secure()#>>'{pendingPhotoReservations,0,photoId}',
  (select payload->>'photoId' from attendance_photo_results where result_name = 'before_pending'),
  'page reload recovers the owner pending reservation for retry or abandon'
);
select is(
  public.can_current_employee_upload_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending')
  ),
  true,'owner can upload the exact pending object'
);
select is(
  public.can_current_employee_upload_attendance_photo(
    'erp-attendance-photos','guessed/path'
  ),
  false,'guessed path is denied'
);
reset role;

insert into storage.objects(bucket_id,name,metadata)
select
  payload->>'bucketId', payload->>'objectPath',
  jsonb_build_object('size',1,'mimetype','image/jpeg')
from attendance_photo_results where result_name = 'before_pending';

set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
insert into attendance_photo_results values (
  'before_active',
  public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid from attendance_photo_results where result_name = 'before_pending')
  )
);
select is(
  (select payload->>'uploadStatus' from attendance_photo_results where result_name = 'before_active'),
  'active','finalize makes the uploaded before photo active'
);
select lives_ok(
  $$ insert into attendance_photo_results values (
    'after_pending', public.reserve_attendance_photo_secure(
    (select work_point_id from public.project_attendance_work_points
     where session_id = pg_temp.attendance_session_id('boundary_first') and ordinal = 1),
    'after','after.jpg','image/jpeg',20971520,null,null
  )) $$,
  'after reservation accepts the exact 20 MiB boundary after before is active'
);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    (select work_point_id from public.project_attendance_work_points
     where session_id = pg_temp.attendance_session_id('boundary_first') and ordinal = 1),
    'before','too-large.jpg','image/jpeg',20971521,null,null
  ) $$,
  '22023',null,'20 MiB plus one byte is rejected'
);
reset role;
```

Complete the after photo, replace before atomically, then abandon an uploaded pending after replacement:

```sql
insert into storage.objects(bucket_id,name,metadata)
select payload->>'bucketId',payload->>'objectPath',
  jsonb_build_object('size',20971520,'mimetype','image/jpeg')
from attendance_photo_results where result_name = 'after_pending';
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
insert into attendance_photo_results values (
  'after_active',
  public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid from attendance_photo_results where result_name = 'after_pending')
  )
);
insert into attendance_photo_results values (
  'before_replacement_pending',
  public.reserve_attendance_photo_secure(
    (select work_point_id from public.project_attendance_work_points
     where session_id = pg_temp.attendance_session_id('boundary_first') and ordinal = 1),
    'before','replacement.jpg','image/jpeg',1,null,null
  )
);
reset role;
insert into storage.objects(bucket_id,name,metadata)
select payload->>'bucketId',payload->>'objectPath',jsonb_build_object('size',1,'mimetype','image/jpeg')
from attendance_photo_results where result_name = 'before_replacement_pending';
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
insert into attendance_photo_results values (
  'before_replacement_active',
  public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid from attendance_photo_results where result_name = 'before_replacement_pending')
  )
);
select is(
  (select count(*)::integer from public.project_attendance_photos photo
   join public.project_attendance_work_points point on point.work_point_id = photo.work_point_id
   where point.session_id = pg_temp.attendance_session_id('boundary_first')
     and photo.phase = 'before' and photo.upload_status = 'active'),
  1,'replacement leaves one active before photo'
);
select is(
  (select count(*)::integer from public.project_attendance_photos photo
   join public.project_attendance_work_points point on point.work_point_id = photo.work_point_id
   where point.session_id = pg_temp.attendance_session_id('boundary_first')
     and photo.phase = 'before' and photo.upload_status = 'superseded'),
  1,'replacement supersedes the prior active before photo'
);
insert into attendance_photo_results values (
  'after_abandon_pending',
  public.reserve_attendance_photo_secure(
    (select work_point_id from public.project_attendance_work_points
     where session_id = pg_temp.attendance_session_id('boundary_first') and ordinal = 1),
    'after','abandon.jpg','image/jpeg',1,null,null
  )
);
reset role;
insert into storage.objects(bucket_id,name,metadata)
select payload->>'bucketId',payload->>'objectPath',jsonb_build_object('size',1,'mimetype','image/jpeg')
from attendance_photo_results where result_name = 'after_abandon_pending';
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select is(
  public.abandon_attendance_photo_secure(
    (select (payload->>'photoId')::uuid from attendance_photo_results where result_name = 'after_abandon_pending')
  )->>'uploadStatus',
  'cleanup_pending','abandon records cleanup state'
);
reset role;
select is(
  (select count(*)::integer from storage.objects
   where bucket_id = 'erp-attendance-photos'
     and name = (select payload->>'objectPath' from attendance_photo_results where result_name = 'after_abandon_pending')),
  1,'abandon never deletes the Storage object in SQL'
);
```

- [ ] **Step 3: Add failing pgTAP for the exact clock-out rule**

First prove pending photos do not complete the other employee's open session:

```sql
insert into public.project_attendance_photos(
  photo_id,work_point_id,phase,bucket_id,object_path,original_file_name,
  content_type,size_bytes,upload_status
) values
  ('74000000-0000-4000-8000-000000000091',
   (select work_point_id from public.project_attendance_work_points where session_id = '71000000-0000-4000-8000-000000000098' and ordinal = 1),
   'before','erp-attendance-photos','pending/session98/before','before.jpg','image/jpeg',1,'pending'),
  ('74000000-0000-4000-8000-000000000092',
   (select work_point_id from public.project_attendance_work_points where session_id = '71000000-0000-4000-8000-000000000098' and ordinal = 1),
   'after','erp-attendance-photos','pending/session98/after','after.jpg','image/jpeg',1,'pending');
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000005',true);
select throws_ok(
  $$ select public.clock_out_project_secure(
    '71000000-0000-4000-8000-000000000098',
    '75000000-0000-4000-8000-000000000001',
    35.681236,139.767125,1,null,null
  ) $$,
  '55000',null,'pending photos do not satisfy the complete-point requirement'
);
reset role;
```

Use the ordinary employee's session, which has active before/after on point 1, add an incomplete point 2, change project master location, and close at the original snapshot:

```sql
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select public.upsert_attendance_work_point_secure(
  pg_temp.attendance_session_id('boundary_first'),2,'未完成区域','',''
);
reset role;
update public.projects set payload = payload || jsonb_build_object(
  'latitude',34.0,'longitude',135.0,'attendanceRadiusMeters',50
) where record_key = 'ATT-ELIGIBLE';

create temporary table attendance_clock_out_results(
  result_name text primary key,payload jsonb not null
) on commit drop;
grant select,insert on attendance_clock_out_results to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
insert into attendance_clock_out_results values (
  'first',public.clock_out_project_secure(
    pg_temp.attendance_session_id('boundary_first'),
    '75000000-0000-4000-8000-000000000002',
    35.681236,139.767125,300,null,null
  )
);
insert into attendance_clock_out_results values (
  'retry',public.clock_out_project_secure(
    pg_temp.attendance_session_id('boundary_first'),
    '75000000-0000-4000-8000-000000000002',
    35.681236,139.767125,300,null,null
  )
);
select is(
  (select payload#>>'{session,status}' from attendance_clock_out_results where result_name = 'first'),
  'closed','one complete point closes the session despite incomplete point two'
);
select is(
  (select payload#>>'{event,result}' from attendance_clock_out_results where result_name = 'first'),
  'normal','clock-out uses the original session snapshot and equality boundary'
);
select is(
  (select payload#>>'{event,eventId}' from attendance_clock_out_results where result_name = 'first'),
  (select payload#>>'{event,eventId}' from attendance_clock_out_results where result_name = 'retry'),
  'clock-out request retry returns the same event'
);
select throws_ok(
  $$ select public.clock_out_project_secure(
    pg_temp.attendance_session_id('boundary_first'),
    '75000000-0000-4000-8000-000000000003',
    35.681236,139.767125,1,null,null
  ) $$,
  '55000',null,'a closed session cannot receive a different second clock-out event'
);
reset role;
```

Prove the closed employee can immediately start a different project on the same Tokyo work date:

```sql
insert into public.projects(record_key,payload,status) values (
  'ATT-SECOND',
  pg_temp.attendance_project_payload(
    'ATT-SECOND','第二现场','进行中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'
  ),
  'active'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
insert into attendance_clock_results values (
  'second_project',
  public.clock_in_project_secure(
    'ATT-SECOND','75000000-0000-4000-8000-000000000005',
    35.681236,139.767125,1,null,null
  )
);
select is(
  (select payload#>>'{session,projectId}' from attendance_clock_results where result_name = 'second_project'),
  'ATT-SECOND','employee can open a different project after closing the first'
);
select is(
  (select payload#>>'{session,workDate}' from attendance_clock_results where result_name = 'second_project'),
  (select payload#>>'{session,workDate}' from attendance_clock_results where result_name = 'boundary_first'),
  'sequential projects share the same Tokyo work date'
);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-SECOND','63000000-0000-4000-8000-000000000001',
    35.681236,139.767125,1,null,null
  ) $$,
  '22023',null,'a clock-in request cannot be reused for another project'
);
select throws_ok(
  $$ select public.clock_out_project_secure(
    (select (payload#>>'{session,sessionId}')::uuid from attendance_clock_results where result_name = 'second_project'),
    '75000000-0000-4000-8000-000000000002',
    35.681236,139.767125,1,null,null
  ) $$,
  '22023',null,'a clock-out request cannot be reused for another session'
);
reset role;
```

Finally seed an independent complete open session for a third active employee and prove the out-of-range reason path:

```sql
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000012',
  'authenticated','authenticated','attendance-abnormal@auth.invalid','',now(),'{}','{}',now(),now()
);
insert into public.employee_profiles(
  id,employee_number,auth_user_id,name,department,position,
  employment_status,account_status,must_change_password,is_hidden_system_account
) values (
  '62000000-0000-4000-8000-000000000012','SW-6112','61000000-0000-4000-8000-000000000012',
  '异常下班员工','工程部','小工','在职','active',false,false
);
insert into public.project_attendance_sessions(
  session_id,employee_profile_id,employee_number_snapshot,employee_name_snapshot,
  project_id,project_name_snapshot,project_address_snapshot,
  project_latitude_snapshot,project_longitude_snapshot,
  attendance_radius_meters_snapshot,work_date,status,opened_at
) values (
  '71000000-0000-4000-8000-000000000097','62000000-0000-4000-8000-000000000012',
  'SW-6112','异常下班员工','ATT-ELIGIBLE','合法现场','東京都 千代田区 1-1',
  35.681236,139.767125,300,'2026-07-15','open','2026-07-15T08:00:00Z'
);
insert into public.project_attendance_work_points(
  work_point_id,session_id,ordinal,area_name,work_description,completion_note
) values (
  '73000000-0000-4000-8000-000000000097','71000000-0000-4000-8000-000000000097',1,
  '完整点位','完成施工',''
);
insert into public.project_attendance_photos(
  photo_id,work_point_id,phase,bucket_id,object_path,original_file_name,
  content_type,size_bytes,upload_status
) values
  ('74000000-0000-4000-8000-000000000097','73000000-0000-4000-8000-000000000097','before','erp-attendance-photos','fixture/session97/before','before.jpg','image/jpeg',1,'active'),
  ('74000000-0000-4000-8000-000000000098','73000000-0000-4000-8000-000000000097','after','erp-attendance-photos','fixture/session97/after','after.jpg','image/jpeg',1,'active');
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000012',true);
select throws_ok(
  $$ select public.clock_out_project_secure(
    '71000000-0000-4000-8000-000000000097','75000000-0000-4000-8000-000000000004',
    35.681236,139.767125,300.001,null,null
  ) $$,
  '22023',null,'out-of-range clock-out requires an abnormal reason'
);
select is(
  public.clock_out_project_secure(
    '71000000-0000-4000-8000-000000000097','75000000-0000-4000-8000-000000000004',
    35.681236,139.767125,300.001,null,' 临时封路 '
  )#>>'{event,abnormalReason}',
  '临时封路','out-of-range clock-out stores a trimmed reason'
);
reset role;
```

- [ ] **Step 4: Run the expanded database tests RED**

Run:

```bash
node --test src/services/attendanceSchema.test.js
npx supabase test db supabase/tests/today_attendance.sql
```

Expected: Task 5 assertions remain green; new static and pgTAP point/photo/clock-out assertions fail on missing RPCs and policies.

- [ ] **Step 5: Implement owner-only point upsert**

Use this exact signature and owner/open lock:

```sql
create or replace function public.upsert_attendance_work_point_secure(
  p_session_id uuid,
  p_ordinal smallint,
  p_area_name text,
  p_work_description text,
  p_completion_note text default ''
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  session_row public.project_attendance_sessions%rowtype;
  point_id uuid;
  area_value text := btrim(coalesce(p_area_name, ''));
  description_value text := btrim(coalesce(p_work_description, ''));
  completion_value text := btrim(coalesce(p_completion_note, ''));
begin
  actor := private.current_attendance_employee();
  if p_ordinal not between 1 and 7 or char_length(area_value) > 100
    or char_length(description_value) > 1000 or char_length(completion_value) > 1000
  then
    raise exception using errcode = '22023', message = 'invalid attendance work point';
  end if;
  select * into session_row from public.project_attendance_sessions
  where session_id = p_session_id for update;
  if not found or session_row.employee_profile_id <> actor.id then
    raise exception using errcode = '42501', message = 'attendance session owner required';
  end if;
  if session_row.status <> 'open' then
    raise exception using errcode = '55000', message = 'attendance session closed', hint = 'ATTENDANCE_SESSION_CLOSED';
  end if;
  insert into public.project_attendance_work_points(
    session_id, ordinal, area_name, work_description, completion_note
  ) values (
    p_session_id, p_ordinal, area_value, description_value, completion_value
  ) on conflict (session_id, ordinal) do update set
    area_name = excluded.area_name,
    work_description = excluded.work_description,
    completion_note = excluded.completion_note
  returning work_point_id into point_id;
  return private.attendance_work_point_json(point_id);
end;
$$;
```

Add private exact-key serializers; the point serializer projects only active before/after photos:

```sql
create or replace function private.attendance_photo_json(p_photo_id uuid)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'photoId', photo.photo_id,
    'workPointId', photo.work_point_id,
    'phase', photo.phase,
    'bucketId', photo.bucket_id,
    'objectPath', photo.object_path,
    'originalFileName', photo.original_file_name,
    'contentType', photo.content_type,
    'sizeBytes', photo.size_bytes,
    'uploadStatus', photo.upload_status,
    'capturedAt', photo.captured_at,
    'createdAt', photo.created_at
  )
  from public.project_attendance_photos photo
  where photo.photo_id = p_photo_id;
$$;

create or replace function private.attendance_work_point_json(p_work_point_id uuid)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'workPointId', point.work_point_id,
    'sessionId', point.session_id,
    'ordinal', point.ordinal,
    'areaName', point.area_name,
    'workDescription', point.work_description,
    'completionNote', point.completion_note,
    'createdAt', point.created_at,
    'updatedAt', point.updated_at,
    'photos', jsonb_build_object(
      'before', (
        select private.attendance_photo_json(photo.photo_id)
        from public.project_attendance_photos photo
        where photo.work_point_id = point.work_point_id
          and photo.phase = 'before' and photo.upload_status = 'active'
        limit 1
      ),
      'after', (
        select private.attendance_photo_json(photo.photo_id)
        from public.project_attendance_photos photo
        where photo.work_point_id = point.work_point_id
          and photo.phase = 'after' and photo.upload_status = 'active'
        limit 1
      )
    )
  )
  from public.project_attendance_work_points point
  where point.work_point_id = p_work_point_id;
$$;

revoke all on function private.attendance_photo_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.attendance_work_point_json(uuid) from public, anon, authenticated, service_role;
```

- [ ] **Step 6: Create/update the private bucket without touching other buckets**

```sql
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'erp-attendance-photos',
  'erp-attendance-photos',
  false,
  20971520,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
```

Do not change table grants or policies for any other bucket.

- [ ] **Step 7: Implement photo reservation with random server path**

Validate exact MIME/size/name/checksum, read parent IDs without locks, then lock parent session followed by work point, require actor ownership and `open`, require active before before reserving after, and reject an existing pending row. Generate a new UUID and construct only:

```sql
object_path_value := actor.id::text || '/' || session_row.session_id::text || '/' ||
  point_row.work_point_id::text || '/' || photo_id_value::text || '/' || p_phase;
```

Insert `pending` metadata and return `private.attendance_photo_json(photo_id_value)`. Never use the original file name, employee name, project name, client object path or client employee ID in the key.

Exact function signature:

```sql
public.reserve_attendance_photo_secure(
  p_work_point_id uuid,
  p_phase text,
  p_original_file_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_checksum_sha256 text default null,
  p_captured_at timestamptz default null
) returns jsonb
```

- [ ] **Step 8: Implement finalize and abandon state transitions**

`finalize_attendance_photo_secure(p_photo_id uuid)` must:

1. Read parent IDs without locks, then lock in the global order `session -> work point -> pending photo`; require the session to be open and owned.
2. Select exact `storage.objects` row by `bucket_id` and `name`.
3. Compare `(metadata->>'size')::bigint` and `coalesce(metadata->>'mimetype', metadata->>'contentType')` to reservation values; invalid/missing metadata fails without changing photo status.
4. Lock any old active row for the same point/phase.
5. Update old active to `superseded`, then pending to `active` in one transaction.
6. Return the active photo DTO.

`abandon_attendance_photo_secure(p_photo_id uuid)` uses the same `session -> work point -> photo` lock order, accepts only an owned open-session pending row, updates it to `cleanup_pending`, and returns its DTO. It never deletes `storage.objects`. Storage metadata does not provide a trustworthy SHA-256, so the optional client checksum remains diagnostic and must not be described as server-verified.

- [ ] **Step 9: Implement minimal Storage authorization predicates**

`can_current_employee_view_attendance_session(p_session_id uuid)` returns true only when current active actor is:

- session owner;
- current `projects.payload->>'siteAssigneeEmployeeId' = actor.id::text` for that session project;
- position `社长`;
- employee number `SW-000`.

`can_current_employee_upload_attendance_photo(bucket,path)` requires exact attendance bucket/path, a `pending` reservation, parent session `open`, and owner actor. `can_current_employee_view_attendance_photo(bucket,path)` requires an `active` photo and the session-view predicate. All three are `STABLE SECURITY DEFINER`, fixed search path, boolean-only, revoked from `public, anon`, and granted only to `authenticated, service_role`.

- [ ] **Step 10: Add bucket-scoped permissive and restrictive policies**

Drop only these exact names before recreating them:

```sql
drop policy if exists attendance_photos_insert on storage.objects;
drop policy if exists attendance_photos_insert_guard on storage.objects;
drop policy if exists attendance_photos_select on storage.objects;
drop policy if exists attendance_photos_select_guard on storage.objects;
drop policy if exists attendance_photos_update_deny on storage.objects;
drop policy if exists attendance_photos_delete_deny on storage.objects;
```

Then create:

```sql
create policy attendance_photos_insert on storage.objects
  for insert to authenticated
  with check (public.can_current_employee_upload_attendance_photo(bucket_id, name));
create policy attendance_photos_insert_guard on storage.objects as restrictive
  for insert to authenticated
  with check (
    bucket_id <> 'erp-attendance-photos' or
    public.can_current_employee_upload_attendance_photo(bucket_id, name)
  );
create policy attendance_photos_select on storage.objects
  for select to authenticated
  using (public.can_current_employee_view_attendance_photo(bucket_id, name));
create policy attendance_photos_select_guard on storage.objects as restrictive
  for select to authenticated
  using (
    bucket_id <> 'erp-attendance-photos' or
    public.can_current_employee_view_attendance_photo(bucket_id, name)
  );
create policy attendance_photos_update_deny on storage.objects as restrictive
  for update to authenticated
  using (bucket_id <> 'erp-attendance-photos')
  with check (bucket_id <> 'erp-attendance-photos');
create policy attendance_photos_delete_deny on storage.objects as restrictive
  for delete to authenticated
  using (bucket_id <> 'erp-attendance-photos');
```

The restrictive guards ensure a future broad policy cannot expose or overwrite this bucket while remaining neutral for other buckets.

- [ ] **Step 11: Implement trusted clock-out**

Use exact signature:

```sql
public.clock_out_project_secure(
  p_session_id uuid,
  p_request_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_device_recorded_at timestamptz default null,
  p_abnormal_reason text default null
) returns jsonb
```

Lock request UUID, actor UUID, then session row. Resolve an existing request before testing `closed`, so a retry after the successful close returns the same event only when employee, `clock_out` type and `p_session_id` all match. Reject request conflict across employee/type/session. Require owner and `open`. Test completeness with an existential query, not an all-points count:

```sql
select exists (
  select 1
  from public.project_attendance_work_points point
  where point.session_id = session_row.session_id
    and btrim(point.area_name) <> ''
    and btrim(point.work_description) <> ''
    and exists (
      select 1 from public.project_attendance_photos photo
      where photo.work_point_id = point.work_point_id
        and photo.phase = 'before' and photo.upload_status = 'active'
    )
    and exists (
      select 1 from public.project_attendance_photos photo
      where photo.work_point_id = point.work_point_id
        and photo.phase = 'after' and photo.upload_status = 'active'
    )
) into has_complete_point;
```

If false, raise hint `ATTENDANCE_COMPLETE_WORK_POINT_REQUIRED`. Calculate distance only from session snapshot, apply the same normal/abnormal reason rule, insert the immutable event, update session `status='closed'` and `closed_at=server_recorded_at`, and return the canonical session/event pair.

- [ ] **Step 12: Close RPC grants and run pgTAP GREEN**

Revoke all Task 6 RPCs from all default roles, grant execute only to `authenticated, service_role`, update the static test for exact signatures/policy names, then run:

```bash
node --test src/services/attendanceSchema.test.js
npx supabase test db supabase/tests/today_attendance.sql
```

Expected: all schema, ownership, seven-point, photo transition, Storage predicate and one-complete-point clock-out cases pass.

- [ ] **Step 13: Commit Task 6 only**

```bash
git add supabase/migrations/202607150003_today_attendance.sql supabase/tests/today_attendance.sql src/services/attendanceSchema.test.js
git commit -m "feat: add attendance logs photos and clock out"
```

---

### Task 7: Server-authorized record viewer and full database/Storage verification

**Files:**
- Modify: `supabase/migrations/202607150003_today_attendance.sql`
- Modify: `supabase/tests/today_attendance.sql`
- Modify: `src/services/attendanceSchema.test.js`
- Create: `supabase/tests/today_attendance_storage_http.mjs`
- Create: `supabase/functions/attendance-photo-cleanup/handler.js`
- Create: `supabase/functions/attendance-photo-cleanup/handler.test.js`
- Create: `supabase/functions/attendance-photo-cleanup/index.ts`

**Interfaces:**
- Consumes: canonical session projection and current live project `siteAssigneeEmployeeId`.
- Produces: `list_attendance_records_secure(date,text,uuid,timestamptz,uuid,integer) -> jsonb` with `{ access, filterOptions, items, nextCursor }`.
- Produces a disposable-environment HTTP verifier for real Storage gateway upload/read/update/delete behavior.
- Produces service-role-only `claim_attendance_photo_cleanup_secure(integer)` and `complete_attendance_photo_cleanup_secure(uuid)`, plus an authenticated scheduled cleanup handler that never selects or deletes `active` photos.

Before pgTAP changes, extend `attendanceSchema.test.js`:

```js
test('record viewer is an authenticated RPC with live project-assignee checks', () => {
  assert.match(sql, /create or replace function public\.list_attendance_records_secure\s*\(/i)
  assert.match(sql, /projects[\s\S]*siteAssigneeEmployeeId/i)
  assert.match(sql, /revoke all on function public\.list_attendance_records_secure/i)
  assert.match(sql, /grant execute on function public\.list_attendance_records_secure[^;]+to authenticated, service_role/i)
})
```

- [ ] **Step 1: Write failing pgTAP for the live authorization matrix**

With one historical session on project A and one on project B, create fixed actors/current assignment, then query only through the public RPC:

```sql
create or replace function pg_temp.add_attendance_actor(
  p_user_id uuid, p_employee_id uuid, p_number text, p_name text,
  p_position text, p_account_status text default 'active'
) returns void language plpgsql security definer
set search_path = pg_catalog, public, auth as $$
begin
  insert into auth.users(
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',p_user_id,'authenticated','authenticated',
    p_number || '@attendance.invalid','',now(),'{}','{}',now(),now()
  );
  insert into public.employee_profiles(
    id,employee_number,auth_user_id,name,department,position,
    employment_status,account_status,must_change_password,is_hidden_system_account
  ) values (
    p_employee_id,p_number,p_user_id,p_name,'工程部',p_position,
    '在职',p_account_status,false,false
  );
end;
$$;

select pg_temp.add_attendance_actor('61000000-0000-4000-8000-000000000006','62000000-0000-4000-8000-000000000006','SW-6106','当前现场担当','职长');
select pg_temp.add_attendance_actor('61000000-0000-4000-8000-000000000007','62000000-0000-4000-8000-000000000007','SW-6107','原现场担当','职长');
select pg_temp.add_attendance_actor('61000000-0000-4000-8000-000000000008','62000000-0000-4000-8000-000000000008','SW-6108','有效社长','社长');
select pg_temp.add_attendance_actor('61000000-0000-4000-8000-000000000009','62000000-0000-4000-8000-000000000009','SW-6109','停用社长','社长','disabled');
select pg_temp.add_attendance_actor('61000000-0000-4000-8000-000000000011','62000000-0000-4000-8000-000000000011','SW-6111','无场次员工','小工');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000010',
  'authenticated','authenticated','attendance-sw000@auth.invalid','',now(),'{}','{}',now(),now()
);
update public.employee_profiles set
  auth_user_id = '61000000-0000-4000-8000-000000000010',
  employment_status = '在职', account_status = 'active', must_change_password = false,
  deleted_at = null
where employee_number = 'SW-000';

update public.projects set payload = jsonb_set(
  payload, '{siteAssigneeEmployeeId}', '"62000000-0000-4000-8000-000000000006"'::jsonb
) where record_key = 'ATT-ELIGIBLE';
insert into public.projects(record_key,payload,status) values (
  'ATT-PROJECT-B',
  pg_temp.attendance_project_payload(
    'ATT-PROJECT-B','项目 B','进行中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'
  ) || jsonb_build_object('siteAssigneeEmployeeId',''),
  'active'
);

insert into public.project_attendance_sessions(
  session_id,employee_profile_id,employee_number_snapshot,employee_name_snapshot,
  project_id,project_name_snapshot,project_address_snapshot,
  project_latitude_snapshot,project_longitude_snapshot,
  attendance_radius_meters_snapshot,work_date,status,opened_at,closed_at
) values
  ('71000000-0000-4000-8000-000000000201','62000000-0000-4000-8000-000000000001','SW-6101','零模块普通员工','ATT-ELIGIBLE','合法现场','東京都 千代田区 1-1',35.681236,139.767125,300,'2026-07-15','closed','2026-07-15T08:00:00Z','2026-07-15T09:00:00Z'),
  ('71000000-0000-4000-8000-000000000202','62000000-0000-4000-8000-000000000001','SW-6101','零模块普通员工','ATT-PROJECT-B','项目 B','東京都 千代田区 1-1',35.681236,139.767125,300,'2026-07-15','closed','2026-07-15T10:00:00Z','2026-07-15T11:00:00Z'),
  ('71000000-0000-4000-8000-000000000203','62000000-0000-4000-8000-000000000005','SW-6105','无关员工','ATT-ELIGIBLE','合法现场','東京都 千代田区 1-1',35.681236,139.767125,300,'2026-07-15','closed','2026-07-15T12:00:00Z','2026-07-15T13:00:00Z');

create or replace function pg_temp.visible_attendance_session_ids(p_date date)
returns setof text language sql stable security invoker set search_path = pg_catalog, public as $$
  select item->>'sessionId'
  from jsonb_array_elements(
    public.list_attendance_records_secure(p_date,null,null,null,null,50)->'items'
  ) item
  where item->>'projectId' in ('ATT-ELIGIBLE','ATT-PROJECT-B')
  order by item->>'sessionId';
$$;
grant execute on function pg_temp.visible_attendance_session_ids(date) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select results_eq(
  $$ select * from pg_temp.visible_attendance_session_ids('2026-07-15') $$,
  $$ values ('71000000-0000-4000-8000-000000000201'),
            ('71000000-0000-4000-8000-000000000202') $$,
  'owner sees both own projects and not another employee session'
);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000006',true);
select results_eq(
  $$ select * from pg_temp.visible_attendance_session_ids('2026-07-15') $$,
  $$ values ('71000000-0000-4000-8000-000000000201'),
            ('71000000-0000-4000-8000-000000000203') $$,
  'current site assignee sees all project-A employee sessions only'
);
reset role;

update public.projects set payload = jsonb_set(
  payload, '{siteAssigneeEmployeeId}', '"62000000-0000-4000-8000-000000000007"'::jsonb
) where record_key = 'ATT-ELIGIBLE';
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000006',true);
select is_empty(
  $$ select * from pg_temp.visible_attendance_session_ids('2026-07-15') $$,
  'former assignee loses project history immediately'
);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000007',true);
select results_eq(
  $$ select * from pg_temp.visible_attendance_session_ids('2026-07-15') $$,
  $$ values ('71000000-0000-4000-8000-000000000201'),
            ('71000000-0000-4000-8000-000000000203') $$,
  'new assignee gains project history immediately'
);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000008',true);
select is((select count(*)::integer from pg_temp.visible_attendance_session_ids('2026-07-15')),3,'active president sees all');
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000010',true);
select is((select count(*)::integer from pg_temp.visible_attendance_session_ids('2026-07-15')),3,'SW-000 sees all');
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000011',true);
select is_empty($$ select * from pg_temp.visible_attendance_session_ids('2026-07-15') $$,'unrelated employee sees no foreign sessions');
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000009',true);
select throws_ok(
  $$ select public.list_attendance_records_secure('2026-07-15',null,null,null,null,50) $$,
  '42501',null,'disabled president is denied'
);
reset role;
```

Prove filters narrow the authorized set:

```sql
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000008',true);
select results_eq(
  $$ select item->>'sessionId' from jsonb_array_elements(
    public.list_attendance_records_secure('2026-07-15','ATT-ELIGIBLE',null,null,null,50)->'items'
  ) item order by 1 $$,
  $$ values ('71000000-0000-4000-8000-000000000201'),
            ('71000000-0000-4000-8000-000000000203') $$,
  'project filter narrows president-authorized sessions'
);
select results_eq(
  $$ select item->>'sessionId' from jsonb_array_elements(
    public.list_attendance_records_secure(
      '2026-07-15',null,'62000000-0000-4000-8000-000000000001',null,null,50
    )->'items'
  ) item order by 1 $$,
  $$ values ('71000000-0000-4000-8000-000000000201'),
            ('71000000-0000-4000-8000-000000000202') $$,
  'employee filter narrows president-authorized sessions'
);
select is_empty(
  $$ select item from jsonb_array_elements(
    public.list_attendance_records_secure('2026-07-14',null,null,null,null,50)->'items'
  ) item $$,
  'date filter cannot broaden into another date'
);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select is_empty(
  $$ select item from jsonb_array_elements(
    public.list_attendance_records_secure(
      '2026-07-15',null,'62000000-0000-4000-8000-000000000005',null,null,50
    )->'items'
  ) item $$,
  'employee filter cannot reveal a foreign session to an owner-scope actor'
);
reset role;
```

- [ ] **Step 2: Write failing pgTAP for pagination and safe filter options**

Seed 103 authorized sessions with duplicate `opened_at` values and assert:

- default limit is 50 and maximum accepted limit is 100;
- limit 0/101 fails;
- only one cursor half supplied fails;
- walking `nextCursor.openedAt + nextCursor.sessionId` returns every authorized session exactly once in `(opened_at desc, session_id desc)` order;
- `filterOptions.projects` and `filterOptions.employees` contain only values visible under the caller's scope for the selected date;
- projected photos include bucket/path only for `active`, never pending/superseded/cleanup_pending;
- no signed URL, auth token, Storage metadata or database-only status leaks into the response.

Use an isolated pagination project so prior fixtures do not change counts:

```sql
insert into public.projects(record_key,payload,status) values (
  'ATT-PAGE',
  pg_temp.attendance_project_payload(
    'ATT-PAGE','分页项目','进行中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'
  ),
  'active'
);
insert into public.project_attendance_sessions(
  session_id,employee_profile_id,employee_number_snapshot,employee_name_snapshot,
  project_id,project_name_snapshot,project_address_snapshot,
  project_latitude_snapshot,project_longitude_snapshot,
  attendance_radius_meters_snapshot,work_date,status,opened_at,closed_at
)
select
  ('76000000-0000-4000-8000-' || lpad(number::text,12,'0'))::uuid,
  '62000000-0000-4000-8000-000000000001','SW-6101','零模块普通员工',
  'ATT-PAGE','分页项目','東京都 千代田区 1-1',35.681236,139.767125,300,
  '2026-07-15','closed',
  '2026-07-15T06:00:00Z'::timestamptz + ((number / 2)::text || ' seconds')::interval,
  '2026-07-15T06:30:00Z'::timestamptz + ((number / 2)::text || ' seconds')::interval
from generate_series(1,103) number;

create temporary table attendance_page_results(
  page_name text primary key,payload jsonb not null
) on commit drop;
grant select,insert on attendance_page_results to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
insert into attendance_page_results values (
  'first',public.list_attendance_records_secure('2026-07-15','ATT-PAGE',null,null,null,100)
);
insert into attendance_page_results values (
  'second',public.list_attendance_records_secure(
    '2026-07-15','ATT-PAGE',null,
    (select (payload#>>'{nextCursor,openedAt}')::timestamptz from attendance_page_results where page_name = 'first'),
    (select (payload#>>'{nextCursor,sessionId}')::uuid from attendance_page_results where page_name = 'first'),
    100
  )
);
select is(
  (select jsonb_array_length(payload->'items') from attendance_page_results where page_name = 'first'),
  100,'first keyset page honors limit 100'
);
select is(
  (select jsonb_array_length(payload->'items') from attendance_page_results where page_name = 'second'),
  3,'second keyset page returns the final three rows'
);
select is(
  (select count(distinct item->>'sessionId')::integer
   from attendance_page_results page
   cross join lateral jsonb_array_elements(page.payload->'items') item),
  103,'keyset walk returns every session exactly once'
);
select throws_ok(
  $$ select public.list_attendance_records_secure('2026-07-15','ATT-PAGE',null,null,null,0) $$,
  '22023',null,'limit zero is rejected'
);
select throws_ok(
  $$ select public.list_attendance_records_secure('2026-07-15','ATT-PAGE',null,null,null,101) $$,
  '22023',null,'limit 101 is rejected'
);
select throws_ok(
  $$ select public.list_attendance_records_secure(
    '2026-07-15','ATT-PAGE',null,'2026-07-15T06:00:00Z',null,50
  ) $$,
  '22023',null,'half a cursor is rejected'
);
reset role;
```

- [ ] **Step 3: Run viewer pgTAP RED**

Run:

```bash
node --test src/services/attendanceSchema.test.js
npx supabase test db supabase/tests/today_attendance.sql
```

Expected: all earlier assertions pass; the new static and pgTAP viewer assertions fail on the missing list RPC.

- [ ] **Step 4: Implement exact live-scope record listing**

Use this signature:

```sql
create or replace function public.list_attendance_records_secure(
  p_work_date date default null,
  p_project_id text default null,
  p_employee_profile_id uuid default null,
  p_before_opened_at timestamptz default null,
  p_before_session_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
```

Resolve actor and scope server-side. Validate `p_limit between 1 and 100` and that cursor fields are both null or both non-null. Default date with:

```sql
selected_date := coalesce(p_work_date, timezone('Asia/Tokyo', statement_timestamp())::date);
```

The authorization predicate for every candidate session is exactly:

```sql
session.employee_profile_id = actor.id
or actor.position = '社长'
or actor.employee_number = 'SW-000'
or exists (
  select 1 from public.projects project
  where project.record_key = session.project_id
    and project.status <> 'deleted'
    and project.payload->>'siteAssigneeEmployeeId' = actor.id::text
)
```

Apply date and optional filters after that predicate. Apply keyset cursor:

```sql
p_before_opened_at is null
or (session.opened_at, session.session_id) < (p_before_opened_at, p_before_session_id)
```

Read `p_limit + 1` authorized rows, return only `p_limit`, and set `nextCursor` from the last returned item only when an extra row exists. Build filter options from the same authorization/date predicate without applying the project/employee selection: projects are exactly `{ projectId, projectName }`, employees are exactly `{ employeeProfileId, employeeNumberSnapshot, employeeNameSnapshot }`. Return access exactly `{ scope }` from the same private helper used by `get_my_today_attendance_secure()`.

- [ ] **Step 5: Grant the final browser record RPC**

```sql
revoke all on function public.list_attendance_records_secure(
  date, text, uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_attendance_records_secure(
  date, text, uuid, timestamptz, uuid, integer
) to authenticated, service_role;
```

Keep the migration transaction open until the service-role cleanup functions in Step 7, then end with exactly one `commit;`.

- [ ] **Step 6: Write failing cleanup SQL and handler tests**

Extend the static schema test:

```js
test('photo cleanup is service-role-only and cannot target active rows', () => {
  for (const rpc of ['claim_attendance_photo_cleanup_secure','complete_attendance_photo_cleanup_secure']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${rpc}`, 'i'))
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}[^;]+to service_role`, 'i'))
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${rpc}[^;]+to authenticated`, 'i'))
  }
  assert.match(sql, /upload_status\s+in\s*\(\s*'pending'\s*,\s*'superseded'\s*,\s*'cleanup_pending'/i)
  assert.match(sql, /complete_attendance_photo_cleanup_secure[\s\S]*delete from public\.project_attendance_photos[\s\S]*upload_status\s*=\s*'cleanup_pending'/i)
})
```

Add pgTAP rows on separate fixture points and assert exact claim behavior:

```sql
insert into public.project_attendance_work_points(
  work_point_id,session_id,ordinal,area_name,work_description,completion_note
) values
  ('73000000-0000-4000-8000-000000000702','71000000-0000-4000-8000-000000000097',2,'清理2','测试',''),
  ('73000000-0000-4000-8000-000000000703','71000000-0000-4000-8000-000000000097',3,'清理3','测试',''),
  ('73000000-0000-4000-8000-000000000704','71000000-0000-4000-8000-000000000097',4,'清理4','测试',''),
  ('73000000-0000-4000-8000-000000000705','71000000-0000-4000-8000-000000000097',5,'清理5','测试',''),
  ('73000000-0000-4000-8000-000000000706','71000000-0000-4000-8000-000000000097',6,'清理6','测试','');
insert into public.project_attendance_photos(
  photo_id,work_point_id,phase,bucket_id,object_path,original_file_name,
  content_type,size_bytes,upload_status,updated_at
) values
  ('74000000-0000-4000-8000-000000000702','73000000-0000-4000-8000-000000000702','before','erp-attendance-photos','cleanup/old-pending','old-pending.jpg','image/jpeg',1,'pending',statement_timestamp()-interval '2 days'),
  ('74000000-0000-4000-8000-000000000703','73000000-0000-4000-8000-000000000703','before','erp-attendance-photos','cleanup/old-superseded','old-superseded.jpg','image/jpeg',1,'superseded',statement_timestamp()-interval '2 days'),
  ('74000000-0000-4000-8000-000000000704','73000000-0000-4000-8000-000000000704','before','erp-attendance-photos','cleanup/old-cleanup','old-cleanup.jpg','image/jpeg',1,'cleanup_pending',statement_timestamp()-interval '2 days'),
  ('74000000-0000-4000-8000-000000000705','73000000-0000-4000-8000-000000000705','before','erp-attendance-photos','cleanup/old-active','old-active.jpg','image/jpeg',1,'active',statement_timestamp()-interval '2 days'),
  ('74000000-0000-4000-8000-000000000706','73000000-0000-4000-8000-000000000706','before','erp-attendance-photos','cleanup/recent-pending','recent-pending.jpg','image/jpeg',1,'pending',statement_timestamp());

set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select throws_ok(
  $$ select * from public.claim_attendance_photo_cleanup_secure(100) $$,
  '42501',null,'browser cannot claim cleanup work'
);
reset role;

create temporary table attendance_cleanup_claims(payload jsonb) on commit drop;
grant select,insert on attendance_cleanup_claims to service_role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
insert into attendance_cleanup_claims select * from public.claim_attendance_photo_cleanup_secure(100);
select results_eq(
  $$ select payload->>'photoId' from attendance_cleanup_claims order by 1 $$,
  $$ values ('74000000-0000-4000-8000-000000000702'),
            ('74000000-0000-4000-8000-000000000703'),
            ('74000000-0000-4000-8000-000000000704') $$,
  'claim returns only stale non-active photos'
);
select is(
  (select upload_status from public.project_attendance_photos where photo_id = '74000000-0000-4000-8000-000000000705'),
  'active','claim never changes active photo'
);
select is(
  (select upload_status from public.project_attendance_photos where photo_id = '74000000-0000-4000-8000-000000000706'),
  'pending','claim leaves recent pending photo untouched'
);
select is(
  public.complete_attendance_photo_cleanup_secure('74000000-0000-4000-8000-000000000702'),
  true,'complete deletes a claimed cleanup metadata row'
);
select is(
  public.complete_attendance_photo_cleanup_secure('74000000-0000-4000-8000-000000000705'),
  false,'complete cannot delete active metadata'
);
select is(
  (select count(*)::integer from public.project_attendance_photos where photo_id = '74000000-0000-4000-8000-000000000705'),
  1,'active photo remains after cleanup completion attempt'
);
reset role;
```

Create `handler.test.js`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import { createAttendancePhotoCleanupHandler } from './handler.js'

function request(token = '') {
  return new Request('https://edge.invalid/attendance-photo-cleanup', {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

test('cleanup handler rejects missing or wrong scheduler secret before admin creation', async () => {
  let adminCreated = false
  const handler = createAttendancePhotoCleanupHandler({
    cleanupSecret: 'expected',
    createAdminClient() { adminCreated = true; throw new Error('must not run') },
  })
  assert.equal((await handler(request())).status, 401)
  assert.equal((await handler(request('wrong'))).status, 401)
  assert.equal(adminCreated, false)
})

test('successful removal completes only the claimed metadata row', async () => {
  const calls = []
  const candidate = {
    photoId: '74000000-0000-4000-8000-000000000701',
    bucketId: 'erp-attendance-photos',
    objectPath: 'employee/session/point/photo/before',
  }
  const admin = {
    async rpc(name, args) {
      calls.push(['rpc', name, args])
      return name === 'claim_attendance_photo_cleanup_secure'
        ? { data: [candidate], error: null }
        : { data: true, error: null }
    },
    storage: { from(bucket) { return { async remove(paths) {
      calls.push(['remove', bucket, paths]); return { data: paths, error: null }
    } } } },
  }
  const handler = createAttendancePhotoCleanupHandler({
    cleanupSecret: 'expected', createAdminClient: () => admin,
  })
  const response = await handler(request('expected'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { claimed: 1, deleted: 1, failed: 0 })
  assert.deepEqual(calls, [
    ['rpc','claim_attendance_photo_cleanup_secure',{ p_limit: 100 }],
    ['remove','erp-attendance-photos',[candidate.objectPath]],
    ['rpc','complete_attendance_photo_cleanup_secure',{ p_photo_id: candidate.photoId }],
  ])
})

test('Storage failure leaves cleanup metadata for a later retry', async () => {
  const rpcNames = []
  const admin = {
    async rpc(name) {
      rpcNames.push(name)
      return name === 'claim_attendance_photo_cleanup_secure'
        ? { data: [{
          photoId: '74000000-0000-4000-8000-000000000702',
          bucketId: 'erp-attendance-photos', objectPath: 'safe/path',
        }], error: null }
        : { data: true, error: null }
    },
    storage: { from() { return { async remove() { return { data: null, error: { code: 'storage_failure' } } } } } },
  }
  const handler = createAttendancePhotoCleanupHandler({ cleanupSecret: 'expected', createAdminClient: () => admin })
  const response = await handler(request('expected'))
  assert.deepEqual(await response.json(), { claimed: 1, deleted: 0, failed: 1 })
  assert.deepEqual(rpcNames, ['claim_attendance_photo_cleanup_secure'])
})
```

- [ ] **Step 7: Implement atomic cleanup claim/complete RPCs and handler**

Add service-role-only SQL before the migration's final commit:

```sql
create or replace function public.claim_attendance_photo_cleanup_secure(
  p_limit integer default 100
) returns setof jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'cleanup limit out of range';
  end if;
  return query
  with candidates as (
    select photo.photo_id
    from public.project_attendance_photos photo
    where photo.upload_status in ('pending','superseded','cleanup_pending')
      and photo.updated_at < statement_timestamp() - interval '24 hours'
    order by photo.updated_at, photo.photo_id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.project_attendance_photos photo
    set upload_status = 'cleanup_pending', updated_at = statement_timestamp()
    from candidates
    where photo.photo_id = candidates.photo_id
      and photo.upload_status in ('pending','superseded','cleanup_pending')
    returning photo.photo_id, photo.bucket_id, photo.object_path
  )
  select jsonb_build_object(
    'photoId', claimed.photo_id,
    'bucketId', claimed.bucket_id,
    'objectPath', claimed.object_path
  ) from claimed;
end;
$$;

create or replace function public.complete_attendance_photo_cleanup_secure(
  p_photo_id uuid
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare deleted_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  delete from public.project_attendance_photos
  where photo_id = p_photo_id and upload_status = 'cleanup_pending'
  returning photo_id into deleted_id;
  return deleted_id is not null;
end;
$$;

revoke all on function public.claim_attendance_photo_cleanup_secure(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_attendance_photo_cleanup_secure(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_attendance_photo_cleanup_secure(integer) to service_role;
grant execute on function public.complete_attendance_photo_cleanup_secure(uuid) to service_role;

commit;
```

Implement `handler.js` as a dependency-injected safe orchestrator:

```js
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
})

function validCandidate(value) {
  return Boolean(
    value && typeof value.photoId === 'string' &&
    value.bucketId === 'erp-attendance-photos' &&
    typeof value.objectPath === 'string' && value.objectPath,
  )
}

export function createAttendancePhotoCleanupHandler({
  cleanupSecret,
  createAdminClient,
  claimLimit = 100,
}) {
  return async function attendancePhotoCleanupHandler(request) {
    if (request.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED' })
    if (!cleanupSecret || request.headers.get('authorization') !== `Bearer ${cleanupSecret}`) {
      return json(401, { code: 'UNAUTHORIZED' })
    }
    try {
      const admin = createAdminClient()
      const claim = await admin.rpc('claim_attendance_photo_cleanup_secure', { p_limit: claimLimit })
      if (claim.error || !Array.isArray(claim.data)) return json(503, { code: 'CLEANUP_UNAVAILABLE' })
      let deleted = 0
      let failed = 0
      for (const candidate of claim.data) {
        if (!validCandidate(candidate)) { failed += 1; continue }
        const removal = await admin.storage.from(candidate.bucketId).remove([candidate.objectPath])
        if (removal.error) { failed += 1; continue }
        const completion = await admin.rpc('complete_attendance_photo_cleanup_secure', {
          p_photo_id: candidate.photoId,
        })
        if (completion.error || completion.data !== true) failed += 1
        else deleted += 1
      }
      return json(200, { claimed: claim.data.length, deleted, failed })
    } catch {
      return json(503, { code: 'CLEANUP_UNAVAILABLE' })
    }
  }
}
```

Implement `index.ts` without logging request or object data:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2.110.0'
import { createAttendancePhotoCleanupHandler } from './handler.js'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const cleanupSecret = Deno.env.get('ATTENDANCE_CLEANUP_SECRET') ?? ''

const handler = createAttendancePhotoCleanupHandler({
  cleanupSecret,
  createAdminClient: () => createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }),
})

Deno.serve(handler)
```

Do not add logging of request headers, candidate paths, employee IDs, service-role credentials or raw provider errors.

- [ ] **Step 8: Run cleanup tests GREEN**

Run:

```bash
node --test supabase/functions/attendance-photo-cleanup/handler.test.js src/services/attendanceSchema.test.js
npx supabase test db supabase/tests/today_attendance.sql
```

Expected: handler tests, service-role-only catalog checks and active-exclusion pgTAP assertions pass.

- [ ] **Step 9: Write a real Storage gateway verifier for a disposable local project**

`today_attendance_storage_http.mjs` accepts these required environment variables and never prints them:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
ATTENDANCE_OWNER_EMAIL
ATTENDANCE_OWNER_PASSWORD
ATTENDANCE_OTHER_EMAIL
ATTENDANCE_OTHER_PASSWORD
```

Use `createClient`, `createAttendanceService`, and `createAttendancePhotoStorage`. The script must:

```js
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

import { validateAttendancePhotoFile } from '../../src/features/attendance/attendancePhotoDomain.js'
import { createAttendancePhotoStorage } from '../../src/services/attendancePhotoStorage.js'
import { createAttendanceService } from '../../src/services/attendanceService.js'

const required = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY',
  'ATTENDANCE_OWNER_EMAIL', 'ATTENDANCE_OWNER_PASSWORD',
  'ATTENDANCE_OTHER_EMAIL', 'ATTENDANCE_OTHER_PASSWORD',
]
for (const key of required) {
  if (!process.env[key]) throw new Error(`missing required environment variable: ${key}`)
}

const ownerClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
const otherClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
const ownerLogin = await ownerClient.auth.signInWithPassword({
  email: process.env.ATTENDANCE_OWNER_EMAIL,
  password: process.env.ATTENDANCE_OWNER_PASSWORD,
})
const otherLogin = await otherClient.auth.signInWithPassword({
  email: process.env.ATTENDANCE_OTHER_EMAIL,
  password: process.env.ATTENDANCE_OTHER_PASSWORD,
})
assert.equal(ownerLogin.error, null)
assert.equal(otherLogin.error, null)

const service = createAttendanceService(ownerClient, { configured: true })
const ownerStorage = createAttendancePhotoStorage(ownerClient, { configured: true })
const otherStorage = createAttendancePhotoStorage(otherClient, { configured: true })
const projects = await service.listAttendanceProjects()
assert.ok(projects.length > 0, 'disposable fixture needs one eligible project')
const project = projects[0]
const location = {
  latitude: project.latitude,
  longitude: project.longitude,
  accuracyMeters: 1,
  deviceRecordedAt: new Date().toISOString(),
}
const existing = await service.getMyTodayAttendance()
assert.equal(existing.activeSession, null, 'owner fixture must begin without an open session')
const clockIn = await service.clockIn({
  projectId: project.projectId,
  requestId: randomUUID(),
  location,
  abnormalReason: null,
})
const point = await service.upsertWorkPoint({
  sessionId: clockIn.session.sessionId,
  ordinal: 1,
  areaName: 'Storage HTTP 验证点位',
  workDescription: '验证私有照片上传与读取门禁',
  completionNote: '',
})

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=',
  'base64',
)
function pngFile(name) {
  const blob = new Blob([pngBytes], { type: 'image/png' })
  Object.defineProperties(blob, {
    name: { value: name },
    lastModified: { value: Date.now() },
  })
  return blob
}

async function uploadPhase(phase) {
  const file = pngFile(`${phase}.png`)
  const metadata = validateAttendancePhotoFile(file)
  const reservation = await service.reservePhoto({
    workPointId: point.workPointId,
    phase,
    ...metadata,
    checksumSha256: null,
  })
  await ownerStorage.uploadReservedPhoto({ reservation, file })
  return service.finalizePhoto({ photoId: reservation.photoId })
}

const oversizeReservation = await service.reservePhoto({
  workPointId: point.workPointId,
  phase: 'before',
  originalFileName: 'oversize.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 20 * 1024 * 1024,
  checksumSha256: null,
  capturedAt: null,
})
const oversizeAttempt = await ownerClient.storage.from(oversizeReservation.bucketId).upload(
  oversizeReservation.objectPath,
  new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/jpeg' }),
  { contentType: 'image/jpeg', cacheControl: '0', upsert: false },
)
assert.ok(oversizeAttempt.error, 'Storage gateway must reject 20 MiB plus one byte')
await service.abandonPhoto({ photoId: oversizeReservation.photoId })

const mimeReservation = await service.reservePhoto({
  workPointId: point.workPointId,
  phase: 'before',
  originalFileName: 'mime.jpg',
  contentType: 'image/jpeg',
  sizeBytes: pngBytes.length,
  checksumSha256: null,
  capturedAt: null,
})
const mimeAttempt = await ownerClient.storage.from(mimeReservation.bucketId).upload(
  mimeReservation.objectPath,
  new Blob([pngBytes], { type: 'application/pdf' }),
  { contentType: 'application/pdf', cacheControl: '0', upsert: false },
)
assert.ok(mimeAttempt.error, 'Storage gateway must reject a disallowed MIME')
await service.abandonPhoto({ photoId: mimeReservation.photoId })

const guessed = await ownerClient.storage.from('erp-attendance-photos').upload(
  `${ownerLogin.data.user.id}/${randomUUID()}/${randomUUID()}/${randomUUID()}/before`,
  pngFile('guessed.png'),
  { contentType: 'image/png', cacheControl: '0', upsert: false },
)
assert.ok(guessed.error, 'unreserved path must be denied')

const before = await uploadPhase('before')
const after = await uploadPhase('after')
const updateAttempt = await ownerClient.storage.from(before.bucketId).update(
  before.objectPath,
  pngFile('overwrite.png'),
  { contentType: 'image/png', cacheControl: '0', upsert: false },
)
assert.ok(updateAttempt.error, 'active object update must be denied')
const deleteAttempt = await ownerClient.storage.from(before.bucketId).remove([before.objectPath])
assert.ok(deleteAttempt.error, 'active object delete must be denied')
const ownerSignedUrl = await ownerStorage.createAttendancePhotoSignedUrl({ photo: before })
assert.match(ownerSignedUrl, /^https?:\/\//)
await assert.rejects(() => otherStorage.createAttendancePhotoSignedUrl({ photo: before }))
const publicReadAttempt = await fetch(
  `${process.env.SUPABASE_URL}/storage/v1/object/public/${before.bucketId}/${before.objectPath}`,
)
assert.equal(publicReadAttempt.ok, false, 'private attendance object has no permanent public read')
const clockOutResult = await service.clockOut({
  sessionId: clockIn.session.sessionId,
  requestId: randomUUID(),
  location: { ...location, deviceRecordedAt: new Date().toISOString() },
  abnormalReason: null,
})
assert.equal(clockOutResult.session.status, 'closed')
assert.equal(after.uploadStatus, 'active')
const concurrentClockIns = await Promise.allSettled([
  service.clockIn({ projectId: project.projectId, requestId: randomUUID(), location, abnormalReason: null }),
  service.clockIn({ projectId: project.projectId, requestId: randomUUID(), location, abnormalReason: null }),
])
assert.equal(concurrentClockIns.filter((result) => result.status === 'fulfilled').length, 1)
assert.equal(concurrentClockIns.filter((result) => result.status === 'rejected').length, 1)
const raceToday = await service.getMyTodayAttendance()
assert.ok(raceToday.activeSession, 'concurrent requests leave exactly one recoverable open session')

process.stdout.write(JSON.stringify({
  standardUpload: before.uploadStatus === 'active' && after.uploadStatus === 'active',
  oversizeDenied: Boolean(oversizeAttempt.error),
  mimeDenied: Boolean(mimeAttempt.error),
  guessedPathDenied: Boolean(guessed.error),
  updateDenied: Boolean(updateAttempt.error),
  deleteDenied: Boolean(deleteAttempt.error),
  ownerSignedRead: ownerSignedUrl.startsWith('http'),
  unrelatedReadDenied: true,
  publicReadDenied: !publicReadAttempt.ok,
  clockOut: clockOutResult.session.status === 'closed',
  concurrencySingleOpen: Boolean(raceToday.activeSession),
}) + '\n')
```

Run this verifier only against a disposable local/test Supabase instance because it intentionally creates a closed attendance record. The second account must be an unrelated ordinary employee, not the project's current现场担当, a president or SW-000.

- [ ] **Step 10: Run static, pgTAP, HTTP and full pgTAP GREEN**

Run:

```bash
node --test src/services/attendanceSchema.test.js
node --test supabase/functions/attendance-photo-cleanup/handler.test.js
npx supabase db reset
npx supabase test db supabase/tests/today_attendance.sql
npx supabase test db
node supabase/tests/today_attendance_storage_http.mjs
```

Expected: all commands exit 0, the HTTP verifier prints eleven true booleans, and other bucket policies remain unchanged. If the incomplete untracked `002` or missing disposable credentials prevent a command, report that exact item as unverified; static contracts are not a substitute for pgTAP, real concurrency or the Storage gateway.

- [ ] **Step 11: Commit Task 7 only**

```bash
git add supabase/migrations/202607150003_today_attendance.sql supabase/tests/today_attendance.sql src/services/attendanceSchema.test.js supabase/tests/today_attendance_storage_http.mjs supabase/functions/attendance-photo-cleanup/handler.js supabase/functions/attendance-photo-cleanup/handler.test.js supabase/functions/attendance-photo-cleanup/index.ts
git commit -m "feat: secure attendance records and cleanup"
```

---

### Task 8: Reusable attendance interaction components

**Files:**
- Create: `src/features/attendance/attendanceLocationAttempt.js`
- Create: `src/features/attendance/attendanceLocationAttempt.test.js`
- Create: `src/features/attendance/AttendanceProjectPicker.jsx`
- Create: `src/features/attendance/AttendanceLocationAction.jsx`
- Create: `src/features/attendance/AttendanceWorkPointCard.jsx`
- Create: `src/features/attendance/ActiveAttendanceSession.jsx`
- Create: `src/features/attendance/TodayAttendanceHistory.jsx`
- Create: `src/features/attendance/todayAttendancePageContract.test.js`

**Interfaces:**
- Consumes: Tasks 1–4 domain, location and upload state interfaces.
- Produces: pure location-attempt reducer; controlled UI components with no database or browser persistence.
- `AttendanceLocationAction` consumes `action`, `targetLocation`, `locationService`, `createRequestId`, `onSubmit`, `onSuccess`, and `disabled`.
- `AttendanceWorkPointCard` consumes `point`, `ordinal`, `readOnly`, `saveState`, `photoStates`, `onChange`, `onSave`, `onSelectPhoto`, `onRetryFinalize`, `onAbandonPhoto`, and `onOpenPhoto`.

- [ ] **Step 1: Write failing location-attempt state tests**

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  attendanceLocationAttemptReducer,
  buildAttendanceSubmission,
  createAttendanceLocationAttempt,
} from './attendanceLocationAttempt.js'

test('network retry retains the same request id and measured position', () => {
  const location = { latitude: 35, longitude: 139, accuracyMeters: 10, deviceRecordedAt: null }
  let state = attendanceLocationAttemptReducer(createAttendanceLocationAttempt(), { type: 'locate-start' })
  state = attendanceLocationAttemptReducer(state, {
    type: 'locate-success', requestId: 'request-1', location,
    preview: { result: 'normal', distanceMeters: 10, accuracyMeters: 10, radiusMeters: 300 },
  })
  state = attendanceLocationAttemptReducer(state, { type: 'submit-start' })
  state = attendanceLocationAttemptReducer(state, { type: 'submit-failure', errorCode: 'ATTENDANCE_SERVICE_UNAVAILABLE' })
  state = attendanceLocationAttemptReducer(state, { type: 'retry-submit' })
  assert.deepEqual(buildAttendanceSubmission(state), {
    requestId: 'request-1', location, abnormalReason: null,
  })
})

test('abnormal reason reuses the measurement and validates before submit', () => {
  const location = { latitude: 35, longitude: 139, accuracyMeters: 50, deviceRecordedAt: null }
  let state = attendanceLocationAttemptReducer(createAttendanceLocationAttempt(), {
    type: 'locate-success', requestId: 'request-2', location,
    preview: { result: 'abnormal', distanceMeters: 300, accuracyMeters: 50, radiusMeters: 300 },
  })
  assert.equal(state.phase, 'reason_required')
  state = attendanceLocationAttemptReducer(state, { type: 'reason-change', value: ' 现场入口封闭 ' })
  assert.deepEqual(buildAttendanceSubmission(state), {
    requestId: 'request-2', location, abnormalReason: '现场入口封闭',
  })
})

test('restart clears the old request so a new click must locate again', () => {
  const state = attendanceLocationAttemptReducer({
    ...createAttendanceLocationAttempt(), requestId: 'old', phase: 'failed',
  }, { type: 'restart' })
  assert.deepEqual(state, createAttendanceLocationAttempt())
})

test('server reason-required state survives the submitting phase', () => {
  const location = { latitude: 35, longitude: 139, accuracyMeters: 10, deviceRecordedAt: null }
  let state = attendanceLocationAttemptReducer(createAttendanceLocationAttempt(), {
    type: 'locate-success', requestId: 'request-3', location,
    preview: { result: 'normal', distanceMeters: 10, accuracyMeters: 10, radiusMeters: 300 },
  })
  state = attendanceLocationAttemptReducer(state, { type: 'reason-required', errorCode: 'ATTENDANCE_ABNORMAL_REASON_REQUIRED' })
  state = attendanceLocationAttemptReducer(state, { type: 'reason-change', value: '服务端判定超界' })
  state = attendanceLocationAttemptReducer(state, { type: 'submit-start' })
  assert.equal(buildAttendanceSubmission(state).abnormalReason, '服务端判定超界')
})
```

- [ ] **Step 2: Write failing component source contracts**

`todayAttendancePageContract.test.js` reads all component source files and asserts:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(name) {
  return readFile(new URL(name, import.meta.url), 'utf8').catch(() => '')
}

const [picker, location, point, active, history] = await Promise.all([
  source('./AttendanceProjectPicker.jsx'),
  source('./AttendanceLocationAction.jsx'),
  source('./AttendanceWorkPointCard.jsx'),
  source('./ActiveAttendanceSession.jsx'),
  source('./TodayAttendanceHistory.jsx'),
])

test('project picker and location action expose the confirmed employee flow', () => {
  assert.match(picker, /项目名称/)
  assert.match(picker, /请联系办公室完善项目定位/)
  assert.match(location, /打卡上班|打卡下班/)
  assert.match(location, /异常原因/)
  assert.match(location, /客户端预览|定位预览/)
  assert.match(location, /getCurrentLocation/)
  assert.match(location, /createRequestId/)
})

test('point card requires before then after and has camera capture', () => {
  assert.match(point, /工作区域|点位名称/)
  assert.match(point, /工作内容/)
  assert.match(point, /开工前照片/)
  assert.match(point, /完工照片/)
  assert.match(point, /capture="environment"/)
  assert.match(point, /accept="image\/jpeg,image\/png,image\/webp,image\/heic,image\/heif"/)
  assert.doesNotMatch(point + active + history, /资料未完整/)
})

test('active session caps points and closed history is presentation-only', () => {
  assert.match(active, /MAX_ATTENDANCE_WORK_POINTS/)
  assert.match(active, /canClockOut/)
  assert.match(history, /今日已完成/)
  assert.doesNotMatch(history, /onChange|onSave|onSelectPhoto/)
})
```

- [ ] **Step 3: Run reducer and contract tests RED**

Run:

```bash
node --test src/features/attendance/attendanceLocationAttempt.test.js src/features/attendance/todayAttendancePageContract.test.js
```

Expected: FAIL because reducer and components are absent.

- [ ] **Step 4: Implement the pure location-attempt reducer**

```js
import { normalizeAbnormalReason } from './attendanceDomain.js'

export function createAttendanceLocationAttempt() {
  return {
    phase: 'idle', requestId: null, location: null, preview: null,
    abnormalReason: '', requiresReason: false, errorCode: null,
  }
}

export function attendanceLocationAttemptReducer(state, action) {
  switch (action.type) {
    case 'locate-start':
      return { ...createAttendanceLocationAttempt(), phase: 'locating' }
    case 'locate-success':
      return {
        ...state,
        phase: action.preview.result === 'abnormal' ? 'reason_required' : 'ready',
        requestId: action.requestId,
        location: action.location,
        preview: action.preview,
        requiresReason: action.preview.result === 'abnormal',
        errorCode: null,
      }
    case 'locate-failure':
      return { ...state, phase: 'failed', errorCode: action.errorCode }
    case 'reason-change':
      return { ...state, abnormalReason: action.value }
    case 'reason-required':
      return { ...state, phase: 'reason_required', requiresReason: true, errorCode: action.errorCode }
    case 'submit-start':
    case 'retry-submit':
      return state.requestId && state.location ? { ...state, phase: 'submitting', errorCode: null } : state
    case 'submit-failure':
      return { ...state, phase: 'failed', errorCode: action.errorCode }
    case 'submit-success':
      return { ...state, phase: 'succeeded', errorCode: null }
    case 'restart':
      return createAttendanceLocationAttempt()
    default:
      return state
  }
}

export function buildAttendanceSubmission(state) {
  if (!state?.requestId || !state?.location) throw new TypeError('attendance location attempt is incomplete')
  return {
    requestId: state.requestId,
    location: state.location,
    abnormalReason: state.requiresReason
      ? normalizeAbnormalReason(state.abnormalReason, { required: true })
      : null,
  }
}
```

- [ ] **Step 5: Implement project picker and location action**

`AttendanceProjectPicker` renders a labeled `<select>` with project name, address and radius; it receives already server-filtered projects and still filters with `isAttendanceProjectEligible` as fail-closed defense. It disables during open session and renders exactly “暂无可打卡项目，请联系办公室完善项目定位。” when empty.

`AttendanceLocationAction` uses `useReducer(attendanceLocationAttemptReducer, createAttendanceLocationAttempt())`. Its new-action handler must always do:

```js
dispatch({ type: 'locate-start' })
const location = await locationService.getCurrentLocation({ signal: controller.signal })
const requestId = createRequestId()
const preview = previewAttendanceLocation({ center: targetLocation, location })
dispatch({ type: 'locate-success', requestId, location, preview })
if (preview.result === 'normal') await submitAttempt({ requestId, location, abnormalReason: null })
```

When preview is abnormal, show the 1–500 reason textarea before calling `onSubmit`. If the server returns `ATTENDANCE_ABNORMAL_REASON_REQUIRED`, switch to `reason_required` and retain request/location even if client preview said normal. Other retryable submission failures retain request/location; “重试提交” calls `buildAttendanceSubmission` without geolocation. “重新定位” dispatches restart and begins a new geolocation/request. Unmount aborts the current controller. Only `onSuccess(serverResult)` clears the attempt.

- [ ] **Step 6: Implement work-point, active-session and history components**

`AttendanceWorkPointCard` is controlled and must:

- trim/validate through Task 1 before `onSave`;
- keep photo inputs disabled until the point has a server `workPointId`;
- keep after input disabled until `point.photos.before.uploadStatus === 'active'`;
- accept only the five exact MIME strings and use `capture="environment"`;
- show independent before/after phases from Task 4 (`reserving`, `uploading`, `confirming`, `failed`, `active`);
- expose “重试确认” only for failed finalize with retained reservation;
- expose “放弃本次上传” for a retained pending reservation so a missing/failed object never blocks a replacement forever;
- disable all inputs/actions when `readOnly` or session is closed;
- render active photos through `onOpenPhoto(photo)` and never persist signed URLs.

`ActiveAttendanceSession` sorts points by ordinal, offers the next ordinal only while count `< 7`, passes `readOnly={session.status !== 'open'}`, and enables the clock-out action from `canClockOut(session.workPoints)` only. It does not require every point and contains no incomplete-status badge.

`TodayAttendanceHistory` renders the server's `completedSessions` as closed cards with project, clock-in/out times and normal/abnormal labels; it exposes no mutation callback.

- [ ] **Step 7: Run focused UI foundation tests GREEN**

Run:

```bash
node --test src/features/attendance/attendanceLocationAttempt.test.js src/features/attendance/todayAttendancePageContract.test.js
```

Expected: reducer semantics and all component contracts pass.

- [ ] **Step 8: Commit Task 8 only**

```bash
git add src/features/attendance/attendanceLocationAttempt.js src/features/attendance/attendanceLocationAttempt.test.js src/features/attendance/AttendanceProjectPicker.jsx src/features/attendance/AttendanceLocationAction.jsx src/features/attendance/AttendanceWorkPointCard.jsx src/features/attendance/ActiveAttendanceSession.jsx src/features/attendance/TodayAttendanceHistory.jsx src/features/attendance/todayAttendancePageContract.test.js
git commit -m "feat: add attendance interaction components"
```

---

### Task 9: Today attendance page orchestration and scoped record viewer

**Files:**
- Create: `src/features/attendance/TodayAttendancePage.jsx`
- Create: `src/features/attendance/AttendanceRecordViewer.jsx`
- Create: `src/features/attendance/todayAttendance.css`
- Modify: `src/features/attendance/todayAttendancePageContract.test.js`

**Interfaces:**
- Consumes: Tasks 1–4 services/state, Task 8 controlled components, and server `viewerAccess`/record scope.
- Produces default page signature:

```js
export default function TodayAttendancePage({
  currentUser,
  service = attendanceService,
  photoStorage = attendancePhotoStorage,
  locationService = attendanceLocationService,
  createRequestId = () => globalThis.crypto.randomUUID(),
  onAuthInvalid,
  onBack,
})
```

- Produces `AttendanceRecordViewer({ access, workDate, service, onAuthInvalid, onOpenPhoto })`; it never derives access from a client-side position string.

- [ ] **Step 1: Extend the page contract RED**

Read `TodayAttendancePage.jsx` and `AttendanceRecordViewer.jsx`, then add:

```js
test('page restores attendance independently from the project module', () => {
  assert.match(page, /listAttendanceProjects\(\)/)
  assert.match(page, /getMyTodayAttendance\(\)/)
  assert.match(page, /Promise\.all/)
  assert.match(page, /pendingPhotoReservations[\s\S]*hydrate-pending/)
  assert.doesNotMatch(page, /projectService|listProjects\(|baseRecordService|localStorage|sessionStorage|indexedDB/)
})

test('photo flow is reserve then upload then finalize with explicit abandon/retry paths', () => {
  assert.match(page, /reservePhoto[\s\S]*uploadReservedPhoto[\s\S]*finalizePhoto/)
  assert.match(page, /abandonPhoto/)
  assert.match(page, /finalize-retry|onRetryFinalize/)
  assert.doesNotMatch(page, /getPublicUrl|upsert:\s*true/)
})

test('management viewer trusts server access and filters date project employee', () => {
  assert.match(page, /viewerAccess/)
  assert.match(viewer, /listAttendanceRecords/)
  assert.match(viewer, /workDate/)
  assert.match(viewer, /projectId/)
  assert.match(viewer, /employeeProfileId/)
  assert.doesNotMatch(viewer, /position\s*===|employeeNumber\s*===|SW-000|社长/)
})
```

Initialize `page` and `viewer` in the test's `Promise.all` source reads.

- [ ] **Step 2: Run the page contract RED**

Run:

```bash
node --test src/features/attendance/todayAttendancePageContract.test.js
```

Expected: existing component assertions pass; new page/viewer assertions fail because files are absent.

- [ ] **Step 3: Implement authoritative initial load and refresh**

In `TodayAttendancePage`, hold only in-memory UI state. Initial effect:

```js
const loadPage = useCallback(async () => {
  setLoadState({ loading: true, error: '' })
  try {
    const [projectRows, todayPayload] = await Promise.all([
      service.listAttendanceProjects(),
      service.getMyTodayAttendance(),
    ])
    setProjects(projectRows.filter(isAttendanceProjectEligible))
    setToday(todayPayload)
    setPhotoStates(Object.fromEntries(
      todayPayload.pendingPhotoReservations.map((reservation) => [
        `${reservation.workPointId}:${reservation.phase}`,
        attendancePhotoUploadReducer(
          createAttendancePhotoUploadState(),
          { type: 'hydrate-pending', reservation },
        ),
      ]),
    ))
    setSelectedProjectId((current) =>
      todayPayload.activeSession ? '' :
        projectRows.some((project) => project.projectId === current) ? current : '',
    )
    setLoadState({ loading: false, error: '' })
  } catch (error) {
    if (error?.authInvalid) onAuthInvalid?.()
    setLoadState({ loading: false, error: error?.message || '今日打卡加载失败，请重试' })
  }
}, [service, onAuthInvalid])

useEffect(() => { void loadPage() }, [loadPage])
```

Use a separate `refreshToday()` after every successful mutation so server DTO replaces local business truth. Never manufacture session/event IDs or mark an upload active locally before finalize returns.

- [ ] **Step 4: Implement clock-in/out coordination**

When there is no active session, render picker and:

```jsx
<AttendanceLocationAction
  action="clock_in"
  targetLocation={selectedProject}
  locationService={locationService}
  createRequestId={createRequestId}
  disabled={!selectedProject}
  onSubmit={(attempt) => service.clockIn({
    projectId: selectedProject.projectId,
    ...attempt,
  })}
  onSuccess={refreshToday}
/>
```

For an active session, construct target from its immutable snapshot:

```js
const clockOutTarget = {
  latitude: session.projectLatitudeSnapshot,
  longitude: session.projectLongitudeSnapshot,
  attendanceRadiusMeters: session.attendanceRadiusMetersSnapshot,
}
```

Pass `onSubmit={(attempt) => service.clockOut({ sessionId: session.sessionId, ...attempt })}`. The component calls fresh geolocation for the new down-clock action. Do not send `projectId` on clock-out. Disable down-clock only when `canClockOut(session.workPoints)` is false or another mutation is running; explanatory copy is “至少完成一个含开工前和完工照片的点位后可打卡下班。”

- [ ] **Step 5: Implement point save and independent photo orchestration**

Point save calls only:

```js
await service.upsertWorkPoint({
  sessionId: today.activeSession.sessionId,
  ordinal: draft.ordinal,
  areaName: draft.areaName,
  workDescription: draft.workDescription,
  completionNote: draft.completionNote,
})
await refreshToday()
```

Keep each draft in keyed React state until both `upsertWorkPoint` and `refreshToday` succeed; an RPC/network failure displays the safe error and leaves area, work description and completion note unchanged for retry.

Use a keyed state map `${workPointId}:${phase}` and Task 4 reducer. The new-file path is exactly:

```js
const metadata = validateAttendancePhotoFile(file)
dispatchPhoto(key, { type: 'select', file })
dispatchPhoto(key, { type: 'reserve-start' })
let reservation
let failedStage = 'reserve'
try {
  reservation = await service.reservePhoto({ workPointId, phase, ...metadata, checksumSha256: null })
  dispatchPhoto(key, { type: 'reserve-success', reservation })
  failedStage = 'upload'
  await photoStorage.uploadReservedPhoto({ reservation, file })
  dispatchPhoto(key, { type: 'upload-success' })
  failedStage = 'finalize'
  const activePhoto = await service.finalizePhoto({ photoId: reservation.photoId })
  dispatchPhoto(key, { type: 'finalize-success', photo: activePhoto })
  await refreshToday()
} catch (error) {
  if (reservation && failedStage === 'upload') {
    dispatchPhoto(key, { type: 'upload-failure', errorCode: error.code })
    try {
      await service.abandonPhoto({ photoId: reservation.photoId })
      dispatchPhoto(key, { type: 'abandon-success' })
    } catch (abandonError) {
      dispatchPhoto(key, { type: 'abandon-failure', errorCode: abandonError.code })
    }
  } else if (reservation && failedStage === 'finalize') {
    dispatchPhoto(key, { type: 'finalize-failure', errorCode: error.code })
  } else {
    dispatchPhoto(key, { type: 'reserve-failure', errorCode: error.code })
  }
}
```

The local `failedStage` variable records the awaited boundary without depending on asynchronous React state. A finalize retry, including a reservation restored by `getMyTodayAttendance`, uses the retained `reservation.photoId` and calls only `service.finalizePhoto`, then refreshes; it does not upload bytes again or abandon an uncertain finalize. “放弃本次上传” calls `service.abandonPhoto({ photoId })`, dispatches `abandon-success`, and refreshes so the same phase can be reserved again.

- [ ] **Step 6: Implement signed-photo preview without persistence**

On a photo click, call `photoStorage.createAttendancePhotoSignedUrl({ photo })`, store the URL only in component state, render an accessible modal with project/point/phase alt text, and clear the URL on close/unmount. Never write URL to records, browser storage, logs, or query parameters.

- [ ] **Step 7: Implement server-scoped record viewer**

`AttendanceRecordViewer` receives `access` from `today.viewerAccess` and renders only when `access.canViewScopedRecords` is true. Default filter date is the server `workDate`. Search calls:

```js
service.listAttendanceRecords({
  workDate: filters.workDate,
  projectId: filters.projectId || null,
  employeeProfileId: filters.employeeProfileId || null,
  beforeOpenedAt: cursor?.openedAt || null,
  beforeSessionId: cursor?.sessionId || null,
  limit: 50,
})
```

Replace filter options and items only with the server response. “加载更多” appends the next page using `nextCursor`; changing a filter resets cursor/items. Cards show employee/project, in/out result, abnormal reason, points and active photos. Viewer actions are only search, pagination and photo preview; it exposes no edit, approval, reject or correction control.

- [ ] **Step 8: Assemble accessible page markup and minimal scoped CSS**

Use the existing visual semantics without importing private `PageShell` from `App.jsx`:

```jsx
<main className="app-shell page-shell attendance-page">
  <header className="page-header attendance-page-header">
    <button className="back-button" type="button" onClick={onBack}>返回首页</button>
    <div><p className="eyebrow dark-text">项目定位・现场日志</p><h1>今日打卡</h1></div>
  </header>
  <nav className="attendance-view-tabs" aria-label="今日打卡视图">
    <button type="button" aria-current={view === 'mine' ? 'page' : undefined} onClick={() => setView('mine')}>我的今日打卡</button>
    {today.viewerAccess.canViewScopedRecords && (
      <button type="button" aria-current={view === 'records' ? 'page' : undefined} onClick={() => setView('records')}>权限范围记录</button>
    )}
  </nav>
  <section aria-live="polite">
    {view === 'records' ? recordViewer : myAttendanceContent}
  </section>
</main>
```

Import `./todayAttendance.css`. Create a valid minimal file containing `.attendance-page`, `.attendance-view-tabs`, `.attendance-session-card`, `.attendance-work-point-grid`, `.attendance-photo-grid`, `.attendance-location-result`, `.attendance-error`, `.attendance-photo-modal` and focus-visible rules; Task 11 performs responsive visual refinement.

- [ ] **Step 9: Run page contracts and build GREEN**

Run:

```bash
node --test src/features/attendance/todayAttendancePageContract.test.js
npm run build
```

Expected: page contracts pass and Vite resolves every component/style import with no JSX errors.

- [ ] **Step 10: Commit Task 9 only**

```bash
git add src/features/attendance/TodayAttendancePage.jsx src/features/attendance/AttendanceRecordViewer.jsx src/features/attendance/todayAttendance.css src/features/attendance/todayAttendancePageContract.test.js
git commit -m "feat: add today attendance page"
```

---

### Task 10: AuthGate, App, desktop menu and home-card integration

**Files:**
- Create: `src/features/attendance/todayAttendanceAppIntegration.test.js`
- Modify: `src/auth/AuthGate.jsx`
- Modify: `src/auth/frontendAuthContract.test.js`
- Modify: `src/DesktopAdminShell.jsx`
- Modify: `src/desktopAdminShell.test.js`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `TodayAttendancePage` from Task 9 and existing `canAccessModule`/`isSuperAdmin` helpers.
- Produces first-level view key `todayAttendance`, always visible to an authenticated active employee.
- Preserves internal tool interfaces: `ToolManagementPage`, `returns`, `ToolReturnSection`, `toolReturnRecords`, `setToolReturnRecords` and all tool return history/statistics.

- [ ] **Step 1: Write the failing cross-app integration contract**

Create `todayAttendanceAppIntegration.test.js`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function read(path) {
  return readFile(new URL(path, import.meta.url), 'utf8').catch(() => '')
}

const [app, shell, auth] = await Promise.all([
  read('../../App.jsx'),
  read('../../DesktopAdminShell.jsx'),
  read('../../auth/AuthGate.jsx'),
])

test('today attendance replaces only the first-level return-tool entry', () => {
  assert.match(shell, /view:\s*'toolBorrow'[\s\S]*?view:\s*'todayAttendance'/)
  assert.match(shell, /view:\s*'todayAttendance'[\s\S]*?label:\s*'今日打卡'[\s\S]*?code:\s*'勤'[\s\S]*?alwaysAvailable:\s*true/)
  assert.doesNotMatch(shell, /view:\s*'toolReturn'/)
  assert.match(app, /title:\s*'今日打卡'[\s\S]*?view:\s*'todayAttendance'[\s\S]*?alwaysAvailable:\s*true/)
  assert.doesNotMatch(app, /title:\s*'还工具'[\s\S]*?view:\s*'toolReturn'/)
})

test('tool borrow route still contains the full return workflow', () => {
  assert.match(app, /currentView === 'toolBorrow'/)
  assert.doesNotMatch(app, /currentView === 'toolBorrow'\s*\|\|\s*currentView === 'toolReturn'/)
  assert.match(app, /initialSection="borrow"/)
  assert.match(app, /ToolReturnSection/)
  assert.match(app, /toolReturnRecords/)
  assert.match(app, /setToolReturnRecords/)
  assert.match(app, /id:\s*'returns'|section\s*===\s*'returns'/)
})

test('zero-module employees enter the app and project loading no longer blocks attendance', () => {
  assert.match(auth, /mustChangePassword[\s\S]*?'password-change'[\s\S]*?'authenticated'/)
  assert.doesNotMatch(auth, /hasBusinessPermissions\(currentUser\)/)
  assert.match(app, /canViewProjects[\s\S]*?if \(!canViewProjects\)[\s\S]*?setStoredProjects\(\[\]\)/)
  assert.match(app, /if \(currentView === 'todayAttendance'\)[\s\S]*?<TodayAttendancePage/)
  assert.doesNotMatch(app, /<TodayAttendancePage[\s\S]*?projects=/)
})
```

- [ ] **Step 2: Update existing contracts to the new expected behavior**

In `frontendAuthContract.test.js`, replace the zero-permission blocking test with:

```js
test('valid zero-module employees still mount business UI for always-available attendance', () => {
  assert.match(
    authGateSource,
    /status:\s*currentUser\.mustChangePassword\s*\?\s*'password-change'\s*:\s*'authenticated'/,
  )
  assert.doesNotMatch(authGateSource, /hasBusinessPermissions\(currentUser\)/)
  assert.match(authGateSource, /status !== 'authenticated'/)
  assert.match(authGateSource, /children\(\{[\s\S]*currentUser:/)
})
```

In `desktopAdminShell.test.js`, replace `['toolReturn', '还工具']` with `['todayAttendance', '今日打卡']`; assert the menu entry has `code:'勤'`, `alwaysAvailable:true`, and no `view:'toolReturn'`. Change the desktop-shell route count from 12 to 13. Add assertions that App still contains the internal returns section and `ToolReturnSection`.

- [ ] **Step 3: Run integration contracts RED**

Run:

```bash
node --test src/features/attendance/todayAttendanceAppIntegration.test.js src/auth/frontendAuthContract.test.js src/desktopAdminShell.test.js
```

Expected: tests fail on the old no-permission gate, old menu/card and missing route.

- [ ] **Step 4: Let valid zero-module employees through AuthGate**

Preserve all local demo-mode additions. Change only the post-profile state selection to:

```js
setGate({
  status: currentUser.mustChangePassword ? 'password-change' : 'authenticated',
  currentUser,
  passwordMode: currentUser.mustChangePassword ? 'forced' : null,
})
```

Remove `hasBusinessPermissions`, `NoPermissionsPage`, the optional-password callbacks that only return to `no-permissions`, and the `gate.status === 'no-permissions'` render branch. Keep configuration error, startup/session validation, forced password change, terminal logout and local demo behavior unchanged.

Before and after patching, inspect:

```bash
git diff -- src/auth/AuthGate.jsx
```

The pre-existing `localDemoMode`, `localDemoCredentials`, `localDemoUser`, demo initial state/effect/login branches must remain byte-for-byte unchanged in the working tree.

- [ ] **Step 5: Replace the desktop menu entry in place**

In `DesktopAdminShell.jsx`, replace exactly:

```js
{ view: 'toolReturn', label: '还工具', code: '还', permissionName: '工具管理' },
```

with:

```js
{ view: 'todayAttendance', label: '今日打卡', code: '勤', alwaysAvailable: true },
```

Change visibility to:

```js
item.view === 'home' ||
item.alwaysAvailable === true ||
isSuperAdmin(currentUser) ||
canAccessModule(currentUser, item.permissionName)
```

- [ ] **Step 6: Stop unauthorized project startup reads**

Immediately before the existing project-load effect in `AuthenticatedApp`, derive:

```js
const canViewProjects = canAccessModule(currentUser, '工程项目')
```

Change the effect:

```js
useEffect(() => {
  let active = true
  if (!canViewProjects) {
    setStoredProjects([])
    return () => { active = false }
  }
  projectService.listProjects()
    .then((rows) => { if (active) setStoredProjects(rows) })
    .catch((error) => { if (active) setPersistenceFailure(error) })
  return () => { active = false }
}, [canViewProjects])
```

This guard changes only the legacy project list. `TodayAttendancePage` always loads its own safe project list RPC.

- [ ] **Step 7: Add route and replace the home card**

Import:

```js
import TodayAttendancePage from './features/attendance/TodayAttendancePage.jsx'
```

Add a desktop-shell route near the project route:

```jsx
if (currentView === 'todayAttendance') {
  return renderInDesktopShell(
    <TodayAttendancePage
      currentUser={currentUser}
      onAuthInvalid={onLogout}
      onBack={() => setCurrentView('home')}
    />,
  )
}
```

Change the tool route to only `currentView === 'toolBorrow'` and pass `initialSection="borrow"`, leaving every return record prop intact.

Replace the home `还工具` card in place:

```js
{
  title: '今日打卡',
  code: '勤',
  color: 'green',
  count: '进入',
  label: '定位打卡・现场日志',
  view: 'todayAttendance',
  alwaysAvailable: true,
},
```

Change home visibility to:

```js
const visibleModules = modules.filter((module) =>
  module.alwaysAvailable === true ||
  canAccessModule(currentUser, module.permissionName || module.title),
)
```

The home module grid is also the mobile entry; do not add a duplicate mobile route.

- [ ] **Step 8: Run focused integration tests GREEN**

Run:

```bash
node --test src/features/attendance/todayAttendanceAppIntegration.test.js src/auth/frontendAuthContract.test.js src/desktopAdminShell.test.js
```

Expected: all new navigation/access tests pass, first-level `toolReturn` is absent, and internal return workflow assertions pass.

- [ ] **Step 9: Verify dirty-file preservation and commit only task hunks**

Run:

```bash
git diff -- src/auth/AuthGate.jsx src/styles.css src/features/projects/ProjectPage.jsx
git diff -- src/App.jsx src/DesktopAdminShell.jsx src/auth/frontendAuthContract.test.js src/desktopAdminShell.test.js src/features/attendance/todayAttendanceAppIntegration.test.js
```

Confirm no project page/style hunk changed and all pre-existing AuthGate demo hunks remain. In the current dirty worktree, use interactive hunk staging only for the new AuthGate access changes, declining every pre-existing demo hunk:

```bash
git add src/App.jsx src/DesktopAdminShell.jsx src/auth/frontendAuthContract.test.js src/desktopAdminShell.test.js src/features/attendance/todayAttendanceAppIntegration.test.js
git add -p src/auth/AuthGate.jsx
git diff --cached -- src/auth/AuthGate.jsx
git commit -m "feat: replace return tool entry with attendance"
```

The cached AuthGate diff must contain only removal of the no-permission gate and the authenticated status change; it must not contain `localDemoMode`, credentials or demo user data.

---

### Task 11: Responsive polish, operations guide and end-to-end verification

**Files:**
- Modify: `src/features/attendance/todayAttendance.css`
- Modify: `src/features/attendance/todayAttendancePageContract.test.js`
- Create: `docs/today-attendance-operations.md`

**Interfaces:**
- Consumes: complete feature from Tasks 1–10.
- Produces: responsive desktop/mobile presentation, deploy/verification runbook and fresh completion evidence.

- [ ] **Step 1: Write failing scoped-CSS contract**

Extend `todayAttendancePageContract.test.js` source reads with `todayAttendance.css` and assert:

```js
test('attendance styles are scoped, responsive and touch accessible', () => {
  assert.match(css, /\.attendance-page/)
  assert.match(css, /\.attendance-work-point-grid/)
  assert.match(css, /\.attendance-photo-grid/)
  assert.match(css, /\.attendance-photo-modal/)
  assert.match(css, /min-height:\s*44px/)
  assert.match(css, /@media\s*\(max-width:\s*680px\)/)
  assert.match(css, /grid-template-columns:\s*1fr/)
  assert.match(css, /:focus-visible/)
  assert.doesNotMatch(css, /资料未完整/)
})
```

- [ ] **Step 2: Run the CSS contract RED**

Run:

```bash
node --test src/features/attendance/todayAttendancePageContract.test.js
```

Expected: functional page assertions pass; one or more responsive/touch CSS assertions fail.

- [ ] **Step 3: Finish scoped black-gold responsive styles**

Keep every new selector under `.attendance-*`; do not edit `src/styles.css`. Implement these layout rules:

```css
.attendance-page {
  --attendance-gold: #cfa85b;
  --attendance-gold-soft: #f3d18b;
  --attendance-ink: #15130f;
  --attendance-panel: #fffdf7;
  display: grid;
  gap: 20px;
}

.attendance-view-tabs,
.attendance-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.attendance-view-tabs button,
.attendance-action-row button,
.attendance-photo-action,
.attendance-project-select {
  min-height: 44px;
}

.attendance-session-card,
.attendance-work-point-card,
.attendance-record-card {
  border: 1px solid rgba(139, 101, 35, 0.32);
  border-radius: 16px;
  background: var(--attendance-panel);
  box-shadow: 0 10px 28px rgba(36, 27, 13, 0.08);
}

.attendance-work-point-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.attendance-photo-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.attendance-location-result[data-result='normal'] { border-color: #3b7a57; }
.attendance-location-result[data-result='abnormal'] { border-color: #b85b3a; }
.attendance-error { color: #9c2f26; }

.attendance-page :focus-visible {
  outline: 3px solid var(--attendance-gold);
  outline-offset: 3px;
}

.attendance-photo-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.82);
}

.attendance-photo-modal img {
  max-width: min(94vw, 1100px);
  max-height: 82vh;
  object-fit: contain;
}

@media (max-width: 680px) {
  .attendance-work-point-grid,
  .attendance-photo-grid,
  .attendance-record-filters {
    grid-template-columns: 1fr;
  }

  .attendance-action-row,
  .attendance-action-row button,
  .attendance-view-tabs button {
    width: 100%;
  }

  .attendance-photo-modal { padding: 12px; }
}
```

Use `padding: 18px` on session/point/record cards, `gap: 12px` inside forms, `opacity: .55` plus `cursor: not-allowed` on disabled controls, `aria-busy`-paired pulse only on loading text, and rounded status chips with green for normal and rust for abnormal; keep the exact layout/interaction invariants above.

- [ ] **Step 4: Write the operations guide**

Create `docs/today-attendance-operations.md` with these concrete sections:

1. Dependencies and deploy order: employee auth → committed project core `001` → finalized project documents `002` if present → attendance `003`; never apply `003` ahead of a still-changing earlier migration number.
2. Bucket settings: private, 20 MiB, five MIME types, 300-second signed read; no browser UPDATE/DELETE.
3. Required verification commands from this task.
4. Role matrix: owner/current担当/president/SW-000/unrelated/inactive.
5. Safe service-role monitoring queries counting `pending`, `superseded`, `cleanup_pending` by age without exposing object path or employee name.
6. Incident handling: disable the public RPC grants or page entry to stop new writes, preserve immutable events, do not edit/delete rows, and restore service only after pgTAP/HTTP matrix passes.
7. Privacy: coordinates, reasons and photos are employee/project records; do not paste them into logs or support tickets.
8. Cleanup operation: deploy `attendance-photo-cleanup` only with a scheduler secret and service-role secret, run it against a disposable environment first, and schedule it separately from this non-production implementation plan; no browser cleanup path.
9. Explicit first-release boundary: no abnormal approval/correction and no wage/labor synchronization.

- [ ] **Step 5: Run fresh focused and full automated verification**

First invoke `superpowers:verification-before-completion`. Then run from the attendance implementation worktree:

```bash
node --test src/features/attendance/attendanceDomain.test.js src/features/attendance/attendancePhotoDomain.test.js src/features/attendance/attendanceLocationService.test.js src/features/attendance/attendanceLocationAttempt.test.js src/features/attendance/attendancePhotoUploadState.test.js src/services/attendanceService.test.js src/services/attendancePhotoStorage.test.js src/services/attendanceSchema.test.js src/features/attendance/todayAttendancePageContract.test.js src/features/attendance/todayAttendanceAppIntegration.test.js src/auth/frontendAuthContract.test.js src/desktopAdminShell.test.js supabase/functions/attendance-photo-cleanup/handler.test.js
npm test
npm run build
```

Expected: focused tests pass, the clean-worktree full Node suite passes, and Vite production build exits 0. If the shared dirty worktree's untracked project-document tests still fail, report them separately and do not attribute them to attendance; the attendance worktree must still prove a clean full suite.

- [ ] **Step 6: Run fresh database and Storage verification**

From the isolated migration sequence without the unfinished untracked `002`:

```bash
npx supabase db reset
npx supabase test db supabase/tests/today_attendance.sql
npx supabase test db
node supabase/tests/today_attendance_storage_http.mjs
```

Expected: reset and every pgTAP suite pass; HTTP verifier reports all booleans true. Missing Docker/credentials or the unresolved earlier migration must be reported as an explicit unverified item, never converted into a success claim.

- [ ] **Step 7: Verify browser behavior at desktop and mobile widths**

Invoke `browser:control-in-app-browser` before controlling the local browser. Start the app with the approved dev command, open the local URL, and verify at widths 1440×900 and 390×844:

- zero-module active employee reaches Home and sees “今日打卡” in the old “还工具” position;
- desktop sidebar and mobile home card both open the same page;
- “借工具” opens with借用 active and still exposes internal “归还工具”;
- no first-level “还工具” remains;
- project picker shows only confirmed 待开工/进行中 projects;
- geolocation loading, permission denial and retry are understandable;
- abnormal reason cannot submit blank or 501 characters;
- point 1 can save before/after; after remains disabled before active before photo;
- one complete point enables down-clock even when point 2 is incomplete, with no “资料未完整” label;
- adding stops at seven points;
- closed session fields/photos are read-only;
- manager tab appears only when server `viewerAccess.canViewScopedRecords` is true;
- keyboard focus, modal close and 44px touch targets are usable.

Capture screenshots for both widths and inspect them; do not claim a role/location path tested if no matching account or real browser permission was available.

- [ ] **Step 8: Review diffs, request code review and commit Task 11**

Run:

```bash
git diff --check
git status --short
git diff -- src/styles.css src/features/projects/ProjectPage.jsx supabase/migrations/202607150002_project_documents.sql supabase/tests/project_documents.sql
```

Expected: no whitespace errors; none of the protected unrelated files gained attendance changes. Invoke `superpowers:requesting-code-review`, address only verified in-scope findings, rerun affected tests, then:

```bash
git add src/features/attendance/todayAttendance.css src/features/attendance/todayAttendancePageContract.test.js docs/today-attendance-operations.md
git commit -m "docs: verify today attendance operations"
```

- [ ] **Step 9: Final evidence checklist**

Report exact command outputs/counts for focused Node tests, clean full Node suite, build, db reset, attendance pgTAP, full pgTAP, Storage HTTP/concurrent clock-in verifier, desktop browser, mobile browser and role matrix. Separately list any unavailable dependency or unrelated dirty-tree failure. Confirm all of the following from fresh evidence:

- one first-level tool entry plus internal return workflow;
- today attendance always available to a valid zero-module employee;
- dedicated RPC-only domain, no labor/local fallback;
- normal/abnormal server location rule and valid-location requirement;
- sequential multi-project sessions and one-open invariant;
- seven-point maximum, fourteen-active-photo maximum and one-complete-point down-clock rule;
- no incomplete label;
- owner/current担当/president/SW-000 read matrix;
- immutable events, private Storage and no overwrite/delete;
- service-role cleanup claim excludes active photos and failed object deletion remains retryable;
- protected unrelated user changes remain unstaged and intact.

---

## Execution Notes

- Before Task 1, invoke `superpowers:using-git-worktrees` and verify whether the existing `employee-auth-worktree` already satisfies isolation; preserve its user-owned dirty files. For database reset/pgTAP only, use a clean secondary worktree/checkout that omits the untracked `202607150002_project_documents.sql` prototype.
- Execute tasks in order because later database/UI tasks consume exact DTOs and signatures from earlier tasks.
- Tasks 1 and 2 can be reviewed independently; Tasks 3 and 4 can be developed in parallel after Task 1; Tasks 5–7 are sequential edits to one migration and must not run concurrently.
- Task 8 can start after Tasks 1–4; Task 9 requires Task 8; Task 10 requires Task 9; Task 11 is the completion gate.
- At every reviewer boundary, compare actual exports/RPC signatures/DTO keys against the **Interfaces** block before proceeding.
- Never stage the existing project-document prototype or unrelated project-page/styles changes as part of an attendance commit.
