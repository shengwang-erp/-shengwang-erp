# 今日打卡、现场日志与工具入口精简设计

**日期：** 2026-07-15
**目标工作树：** `/Users/yu/Documents/kaobeierp/employee-auth-worktree`
**状态：** 用户已确认页面流程、定位规则、照片规则、查看权限与验收边界

## 1. 目标

本设计完成以下三项互相关联的调整：

1. 删除重复的一级“还工具”入口，在原位置新增“今日打卡”。
2. 保留“借工具”页面内部的归还工具能力、归还历史和相关统计，确保工具借还闭环不受影响。
3. 新建独立于“人工记录”的员工自助打卡与现场日志域，支持项目定位、同日多现场、异常打卡原因、最多七个工作点位及前后照片留存。

“今日打卡”是正式云端业务能力，不复用浏览器本机存储，也不把定位打卡混入包含工资和成本语义的 `labor_records`。

## 2. 现有实现与改动边界

### 2.1 工具入口

当前桌面一级菜单的 `toolBorrow` 和 `toolReturn` 都进入同一个 `ToolManagementPage`，只是在首次进入时分别打开“临时借用”和“归还工具”标签，因此一级“还工具”属于重复入口。

本次改动：

- 从桌面一级菜单移除 `toolReturn / 还工具`；
- 从首页和移动端模块卡片移除独立“还工具”入口；
- 在原位置新增 `todayAttendance / 今日打卡`，菜单字标使用“勤”；
- `toolBorrow / 借工具` 继续进入完整的工具管理页；
- 工具页内部继续保留“归还工具”标签、`ToolReturnSection`、`tool_return_records`、归还历史和统计依赖；
- 不删除、不迁移、不重写已有工具借用或归还数据。

### 2.2 项目定位

项目模型已经保存以下打卡基础信息：

- `address`
- `latitude`
- `longitude`
- `attendanceRadiusMeters`
- `locationConfirmedAt`
- `locationAddressSnapshot`

“今日打卡”只允许选择状态为 `待开工` 或 `进行中`，且上述地址、坐标、半径和确认状态均有效的项目。缺少有效定位的项目不出现在员工选择列表中，并提示由办公室先完善项目定位。

### 2.3 与人工记录的关系

现有“人工记录”继续承担办公室排班、工时、工资快照和项目人工成本分摊，不承担员工本人定位打卡。第一版不自动从打卡场次生成或修改 `labor_records`，避免把考勤事实与工资结算规则隐式绑定。

## 3. 已确认的业务规则

### 3.1 页面访问与项目选择

- “今日打卡”对所有已登录且账号有效的在职员工开放，不依赖员工是否拥有“人工记录”模块权限。
- 页面默认展示员工本人的当前场次和当天已完成场次。
- 员工先选择一个符合定位条件的项目，再执行上班打卡。
- 任一员工同一时刻最多存在一个未结束场次。
- 员工必须先结束当前项目场次，才能为另一个项目打卡上班。
- 同一员工同一天可以按顺序完成多个项目场次；每个项目分别保存上班、日志和下班记录。
- 工作日期由服务器按 `Asia/Tokyo` 时区计算，不能由客户端指定。

### 3.2 上班与下班定位

- 每次点击“打卡上班”或“打卡下班”都重新请求浏览器高精度定位，不复用缓存位置。
- 定位请求保存纬度、经度、浏览器提供的米级精度和设备时间；设备时间只用于诊断。
- 员工身份、项目定位、项目半径、项目快照、服务器时间和距离判定均由服务器取得或计算。
- 服务器使用地表距离公式计算员工位置到项目中心点的距离。
- 只有 `实际距离 + 定位精度 <= 项目打卡半径` 时判定为正常打卡。
- 不满足正常条件时，员工可以填写原因并保存为“异常打卡”。异常原因去除首尾空白后必须为 1–500 个字符。
- 异常记录保存实际位置、定位精度、实际距离、项目半径和员工填写的原因。
- 定位权限被拒绝、定位超时或没有有效坐标时，不允许通过填写原因绕过定位；员工必须取得有效位置后才能提交打卡。
- 上班和下班各自使用唯一请求编号，重复点击或网络重试不得生成重复事件。
- 上下班事件成功保存后不可由普通员工修改或删除。

### 3.3 现场日志与工作点位

- 一个项目场次最多包含七个工作点位。
- 每个点位提供：
  - 工作区域或点位名称；
  - 工作内容文字说明；
  - 一张开工前照片；
  - 一张完工照片；
  - 可选的完成补充说明。
- 工作区域或点位名称去除首尾空白后最多 100 个字符；工作内容说明和完成补充说明各最多 1000 个字符。
- 同一个点位同一照片阶段最多保留一张当前有效照片；替换操作只允许在下班前进行，且不会覆盖既有 Storage 对象。
- 同一点位必须先完成开工前照片，才能预约完工照片。
- 当七个点位全部使用时，单个场次最多保存十四张当前有效照片。
- 下班打卡只要求至少一个点位同时具备非空区域名称、非空工作内容说明、开工前照片和完工照片。
- 未使用其余点位不需要补齐。
- 已建立但未补齐的其他点位不阻止下班，不显示“资料未完整”或其他特殊状态标签；其中已经保存的文字和照片继续正常保留。
- 场次关闭后，工作点位、说明和照片对普通员工全部只读。

### 3.4 查看权限

- 普通员工只能查看自己的打卡场次、事件、点位和照片；只能在自己的未关闭场次中编辑点位与照片。
- 项目当前 `siteAssigneeEmployeeId` 对应的现场担当可以查看该项目全部员工的场次、点位和照片，但不能修改其他员工记录。
- `position === '社长'` 的有效员工可以查看全部记录。
- `employeeNumber === 'SW-000'` 的系统管理员可以查看全部记录。
- 上述权限必须由数据库根据规范员工身份和当前项目数据执行，不能依赖客户端隐藏按钮。
- 现场担当变更后，查看权限跟随项目当前现场担当；员工本人和社长、系统管理员的历史访问不受项目担当变更影响。
- 本期不增加异常打卡审批、驳回或人工改卡流程；异常记录仅作为明确标记和管理查看信息。

## 4. 页面与组件设计

### 4.1 页面结构

`TodayAttendancePage` 由以下独立单元组成：

1. `AttendanceProjectPicker`：展示可打卡项目、地址、定位状态和打卡半径。
2. `AttendanceLocationAction`：获取当前位置，展示定位进度、距离结果和异常原因输入，并提交上班或下班事件。
3. `ActiveAttendanceSession`：显示当前项目、上班时间、打卡结果和现场日志进度。
4. `AttendanceWorkPointCard`：管理单个点位的区域、文字、开工前照片和完工照片。
5. `TodayAttendanceHistory`：显示员工当天已经完成的其他项目场次。
6. `AttendanceRecordViewer`：仅对现场担当、社长和系统管理员展示其权限范围内的员工记录。

这些单元通过明确的服务接口读写，不把数据库、定位、文件上传和页面状态全部堆入现有大型 `App.jsx`。

### 4.2 员工主流程

1. 进入“今日打卡”。
2. 页面恢复服务器上已有的未结束场次；若没有，展示项目选择。
3. 员工选择项目并点击“打卡上班”。
4. 页面取得实时位置并显示距离结果。
5. 正常范围直接提交；非正常范围要求填写原因后提交异常打卡。
6. 上班成功后，员工建立一至七个工作点位，并逐步保存文字和照片。
7. 至少一个点位满足完整条件后，员工可以点击“打卡下班”。
8. 页面再次取得实时位置并重复正常或异常判定流程。
9. 下班成功后场次变为只读，并回到可选择下一个项目的状态。

上班时从项目主数据复制定位快照；该场次后续的下班距离计算也使用同一份快照。项目在工作期间改名、移动定位点或调整半径不会改变该场次的判定基准。

### 4.3 管理查看

有管理查看范围的用户可以在同一页面切换“我的今日打卡”和“权限范围记录”。管理视图支持按日期、项目和员工筛选，默认只加载当天记录，不在初始页面一次性读取全部历史照片。

## 5. 数据模型

本功能使用规范化表，不把高频定位、权限字段和照片元数据埋入通用 JSONB 信封。

### 5.1 `project_attendance_sessions`

每行代表一个员工在一个项目的连续工作场次，至少包含：

```text
session_id uuid primary key
employee_profile_id uuid not null
employee_number_snapshot text not null
employee_name_snapshot text not null
project_id text not null
project_name_snapshot text not null
project_address_snapshot text not null
project_latitude_snapshot double precision not null
project_longitude_snapshot double precision not null
attendance_radius_meters_snapshot numeric not null
work_date date not null
status text check in ('open', 'closed')
opened_at timestamptz not null
closed_at timestamptz
created_at timestamptz not null
updated_at timestamptz not null
```

数据库用部分唯一索引保证每个员工最多一个 `status = 'open'` 的场次。项目之后改名、移动或调整半径，不覆盖历史场次快照。

`employee_profile_id` 外键指向规范员工目录，`project_id` 外键指向项目 `record_key`，均使用 `ON DELETE RESTRICT`。数据库同时校验经纬度范围、半径大于零，以及 `open/closed` 与 `closed_at` 是否一致。

### 5.2 `project_attendance_events`

每行代表一次不可变的上班或下班打卡：

```text
event_id uuid primary key
session_id uuid not null
event_type text check in ('clock_in', 'clock_out')
request_id uuid not null unique
server_recorded_at timestamptz not null
device_recorded_at timestamptz
latitude double precision not null
longitude double precision not null
accuracy_meters numeric not null
distance_meters numeric not null
radius_meters numeric not null
result text check in ('normal', 'abnormal')
abnormal_reason text
created_at timestamptz not null
```

约束保证每个场次最多一个上班事件和一个下班事件；正常事件没有异常原因，异常事件必须具有非空原因。

`session_id` 使用 `ON DELETE RESTRICT` 外键。数据库拒绝非法经纬度、负数距离、非正数精度或半径，并限制异常原因为 500 个字符。`device_recorded_at` 来自设备，仅作诊断，不能参与工资、工时或打卡先后顺序判定。

### 5.3 `project_attendance_work_points`

```text
work_point_id uuid primary key
session_id uuid not null
ordinal smallint not null check between 1 and 7
area_name text not null default ''
work_description text not null default ''
completion_note text not null default ''
created_at timestamptz not null
updated_at timestamptz not null
unique(session_id, ordinal)
```

表中不保存面向用户的“资料未完整”状态。下班 RPC 只查询是否至少存在一个满足完整条件的点位。

`session_id` 使用 `ON DELETE RESTRICT` 外键；数据库执行序号 1–7、区域名称 100 字符、工作说明和完成说明各 1000 字符的上限。一个完整点位必须同时具有非空区域名称、非空工作说明、一张 `active` 开工前照片和一张 `active` 完工照片。

### 5.4 `project_attendance_photos`

```text
photo_id uuid primary key
work_point_id uuid not null
phase text check in ('before', 'after')
bucket_id text not null
object_path text not null unique
original_file_name text not null
content_type text not null
size_bytes bigint not null
checksum_sha256 text
upload_status text check in ('pending', 'active', 'superseded', 'cleanup_pending')
captured_at timestamptz
created_at timestamptz not null
```

`upload_status` 仅用于上传一致性和清理，不渲染成“资料未完整”标签。部分唯一索引保证每个点位、每个阶段最多一张 `active` 照片；替换时允许新 `pending` 照片与旧 `active` 照片暂时并存，完成后在同一事务中把旧照片改为 `superseded`、新照片改为 `active`。只有 `active` 照片计入点位完整性。

`work_point_id` 使用 `ON DELETE RESTRICT` 外键。`captured_at` 可以保存设备提供的拍摄时间，但与设备打卡时间相同，仅供参考；可信的上传时间始终使用服务器 `created_at`。

## 6. 服务器 API 与数据流

新增安全 RPC，具体职责如下：

- `list_attendance_projects_secure()`：返回当前员工可选择的有效定位项目，不返回未确认项目。
- `get_my_today_attendance_secure()`：恢复当前员工未结束场次和当天已完成场次。
- `clock_in_project_secure(...)`：绑定当前登录员工，锁定开放场次约束，读取项目定位，计算距离并创建场次与上班事件。
- `upsert_attendance_work_point_secure(...)`：只允许当前员工修改自己的开放场次，执行七点位上限和文本长度校验。
- `reserve_attendance_photo_secure(...)`：创建不可覆盖的待上传元数据和随机对象路径。
- `finalize_attendance_photo_secure(...)`：核对私有 Storage 对象的大小和类型后，将照片标记为有效。
- `abandon_attendance_photo_secure(...)`：把放弃或无法完成的上传登记为 `cleanup_pending`，由受控清理流程处理对象。
- `clock_out_project_secure(...)`：使用场次的项目定位快照再次计算定位结果，检查至少一个完整点位，原子写入下班事件并关闭场次。
- `list_attendance_records_secure(...)`：按本人、当前现场担当或全局管理身份返回授权记录。

所有写入 RPC：

- 从 `auth.uid()` 解析当前规范员工；
- 拒绝匿名、停用、离职或会话无效账号；
- 忽略客户端提交的员工姓名、员工编号、服务器时间、项目快照、距离和结果字段；
- 使用事务和行锁防止双击、双设备和并发重复场次；
- 使用幂等请求编号安全处理网络重试；
- 只返回调用者有权看到的最小字段集合。

## 7. 照片存储

新增私有 bucket `erp-attendance-photos`：

- `public = false`；
- 单对象上限 `20 MiB`；
- 允许 `image/jpeg`、`image/png`、`image/webp`、`image/heic`、`image/heif`；
- 对象路径使用员工规范 UUID、场次 UUID、点位 UUID、照片 UUID 和阶段，不包含员工姓名、项目名称或原文件名；
- 上传使用 `upsert: false`，禁止覆盖既有对象；
- 浏览器先预约精确对象路径，再上传，再调用完成 RPC；
- Storage INSERT 策略只允许当前员工向自己开放场次中已预约的精确路径上传；
- Storage SELECT 策略与场次读取权限一致；
- 查看照片时生成五分钟有效的签名 URL，不保存永久公开 URL；
- 普通员工无 Storage UPDATE/DELETE 权限；
- 对象上传成功但完成登记失败时登记 `cleanup_pending`；
- 受控 Storage 清理任务使用服务端凭证删除过期 `pending`、`superseded` 和 `cleanup_pending` 对象，不删除 `active` 历史照片。

移动端文件输入优先请求后置摄像头，同时允许浏览器在不支持直接拍照时退回系统图片选择器。照片选择、上传和数据库完成登记必须分别显示状态；只有服务端确认的 `active` 照片才显示为上传成功。

## 8. 权限与不可变性

- 浏览器不获得四张业务表的直接 INSERT、UPDATE 或 DELETE 权限，写操作只走安全 RPC。
- 浏览器对四张业务表的直接 SELECT 也关闭，所有业务读取通过安全 RPC 返回；Storage 策略通过专用权限判断函数校验照片读取权。
- 打卡事件为仅追加记录，任何角色均不能通过普通页面修改事件时间、坐标、距离或结果。
- 开放场次中的点位和照片只允许所属员工修改。
- 场次关闭后，点位与照片也转为业务只读。
- 现场担当只具有负责项目的读取权，不自动获得改卡或删除权。
- 社长和系统管理员在本期也只有完整读取权；人工修正需要未来单独设计带审计的流程。

## 9. 错误处理与恢复

### 9.1 定位

- 定位进行中时禁用重复提交按钮。
- 权限拒绝、超时或无效坐标分别显示可操作提示。
- 没有有效定位时不创建本地“成功”状态，也不排队离线补交。
- 正常或异常结果由服务器响应决定；客户端预览不能作为最终事实。

### 9.2 网络与并发

- RPC 失败时保留表单内容并显示重试。
- 不对打卡、场次关闭或照片完成登记进行未经服务器确认的乐观成功展示。
- 页面重新加载后先查询服务器开放场次；不得依赖内存状态判断是否已上班。
- 同一请求编号的重试返回原结果；不同设备并发提交由唯一约束和行锁拒绝重复结果。

### 9.3 照片

- 单张照片独立显示等待、上传、确认和失败状态。
- 失败照片可以单独重试，不要求重新拍摄已经成功的其他照片。
- 未完成上传不计入“至少一个完整点位”的检查。
- 其余不完整点位不显示特殊业务标签，也不阻止关闭场次。

## 10. 迁移与共存

- 新增迁移 `supabase/migrations/202607150003_today_attendance.sql`，不改写已存在的员工认证和项目安全迁移。
- 新增 pgTAP 测试 `supabase/tests/today_attendance.sql`。
- 不向新表迁移现有 `labor_records`，也不伪造历史 GPS 数据。
- 不删除 `tool_return_records`，不改变工具统计的数据来源。
- 旧项目缺少有效定位时只从打卡项目列表隐藏，不自动地理编码或伪造确认位置。
- 数据库迁移与前端入口必须作为同一版本发布；数据库能力未就绪时页面失败关闭并提示服务暂不可用。
- 本设计不授权直接部署生产迁移、创建生产 bucket 或修改生产数据；生产发布需单独执行备份、迁移和回滚检查。

## 11. 测试策略

### 11.1 前端与领域测试

- 菜单契约：一级“还工具”消失，“今日打卡”位于原位置，借工具内部仍包含归还功能。
- 项目筛选：只显示 `待开工/进行中` 且定位有效项目。
- 距离判定：边界内、边界上、范围外及不同精度组合。
- 状态机：未打卡、开放场次、关闭场次、刷新恢复和同日多项目。
- 点位规则：序号 1–7、拒绝第八个、至少一个完整点位即可下班、其他不完整点位不阻止且无特殊标签。
- 服务错误映射：定位、认证、网络、权限、并发和上传错误均提供安全提示。
- 照片验证：类型、20 MiB 边界、阶段唯一性、失败重试和只读状态。

### 11.2 数据库与权限测试

- 匿名、停用和离职账号被拒绝。
- 员工身份、服务器时间、项目快照、距离和结果不可由客户端伪造。
- 每个员工最多一个开放场次；同日关闭后可开始其他项目。
- 同一请求编号幂等；并发不同请求不会创建重复事件。
- 正常事件不接受异常原因，异常事件必须有原因。
- 下班前至少一个点位满足区域名称、工作文字、前照片和后照片；无需所有七个点位完整。
- 普通员工、当前现场担当、社长、系统管理员和无关员工的读取矩阵符合规则。
- 场次关闭后普通员工无法修改点位或照片。
- Storage 只允许预约路径上传，拒绝跨员工、跨场次、覆盖、超限和不允许类型。
- 私有对象无永久公开读取，短时签名访问遵守业务读取权限。

### 11.3 完整验证

- 运行所有 Node 测试和新增 focused tests；
- 重置本地 Supabase 后运行全部 pgTAP 测试；
- 对私有 Storage 执行真实上传、拒绝和签名读取测试；
- 运行 `npm run build`；
- 在手机尺寸下实际检查正常打卡、异常打卡、拒绝定位、拍照、失败重试、刷新恢复、同日换项目和不同角色查看。

## 12. 验收标准

1. 桌面左栏、首页和移动入口只保留一个“借工具”，原“还工具”位置显示“今日打卡”。
2. 借工具页面内部仍能归还工具，旧归还记录和统计可继续读取。
3. 员工可以从有效项目中选择现场，并以实时定位分别完成上下班打卡。
4. 范围外或定位精度无法证明在范围内时，只有填写原因后才能保存异常打卡。
5. 同一员工同一时刻不能开启两个场次，同一天可以依次完成多个项目。
6. 每个场次最多七个点位；至少一个点位的区域名称、工作内容、开工前照片和完工照片完整即可下班。
7. 其他不完整点位不显示特殊标签、不阻止下班，已经保存的内容仍保留。
8. 定位、时间、距离、身份和权限由服务器控制，客户端篡改不能改变业务事实。
9. 照片保存在私有 Storage 中，未经授权不能读取、覆盖或删除。
10. 普通员工、现场担当、社长和系统管理员只能读取各自授权范围。
11. 刷新页面或换设备后能够从服务器恢复开放场次。
12. 自动测试、数据库权限测试、Storage 测试、生产构建和手机端人工验收全部通过后才视为完成。

## 13. 本期不包含

- 异常打卡审批、驳回或补卡；
- 管理员修改或删除已保存的打卡事件；
- 离线打卡或稍后自动补交；
- 根据打卡自动生成工资、工时或人工成本；
- 项目班组成员分配；
- 多个施工中心点或复杂多边形围栏；
- 人脸识别、设备绑定或防越狱检测；
- 生产部署、生产数据迁移或生产 bucket 操作。
