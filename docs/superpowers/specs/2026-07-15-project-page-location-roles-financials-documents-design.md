# 工程项目页定位、担当、金额权限与文件管理设计

**日期：** 2026-07-15
**目标版本：** `/Users/yu/Documents/kaobeierp/employee-auth-worktree`
**状态：** 用户已确认交互、权限与验收设计

## 1. 目标

升级工程项目页，使其能够：

- 保存可用于未来员工定位打卡的项目经纬度与打卡范围；
- 支持完整的项目生命周期状态；
- 用规范员工目录分别选择设计担当与现场担当；
- 将开工日期文案与业务含义统一；
- 在不产生第二套金额数据的前提下展示现有合同税込总金额；
- 上传、查看、下载、版本化和作废合同、图纸及甲方法律文件；
- 在数据库与文件存储层落实金额和敏感文件的可见范围。

## 2. 已确认的业务规则

### 2.1 项目状态

状态固定为以下七项：

1. `报价中`
2. `设计中`
3. `待开工`
4. `进行中`
5. `暂停`
6. `已完工`
7. `已取消`

新项目默认状态为 `报价中`。现有 `进行中`、`暂停`、`已完工` 数据保持原值，无需迁移。

### 2.2 地址与定位

- 项目由办公室人员手动填写地址，不提供“获取当前位置”。
- 用户点击“地址定位”后，系统只执行一次地址查询，并将结果显示在地图上。
- 用户可点击地图或拖动标记微调实际施工位置。
- 项目保存手工地址、纬度、经度、打卡半径及最后定位时间。
- 默认打卡半径为 `300` 米。
- 修改地址文字后，已有坐标立即标记为“需重新确认”，不能静默沿用。
- `报价中`、`设计中`、`暂停`、`已完工`、`已取消` 可以暂存为未完成定位。
- 项目切换为 `待开工` 或 `进行中` 前，必须同时具有非空地址、有效纬度、有效经度及大于零的打卡半径。
- 地址查询失败不得覆盖旧坐标；用户仍可直接在地图上手动选点。

地图使用日本国土地理院底图。地址查询采用可替换的 geocoding adapter，首个实现为人工触发的 Nominatim 查询：不做自动补全；同一标准化地址结果在浏览器端缓存；请求节流到每秒不超过一次；页面显示 OpenStreetMap 数据署名。该实现遵守公开服务对人工触发、中低用量、缓存、署名和可替换性的要求。

参考：

- https://maps.gsi.go.jp/help/howtouse.html
- https://operations.osmfoundation.org/policies/nominatim/

### 2.3 担当人员

- 原“负责人”字段改为两个独立字段：`设计担当` 与 `现场担当`。
- 设计担当只能从规范员工目录中选择同时满足以下条件的人员：
  - `department === '设计部'`
  - `employmentStatus === '在职'`
  - `accountStatus === 'active'`
- 现场担当只能从规范员工目录中选择同时满足以下条件的人员：
  - `department === '工程部'`
  - `employmentStatus === '在职'`
  - `accountStatus === 'active'`
- 选择值使用 `employee_profiles.id`，同时保存员工编号与姓名快照，保证员工改名后历史项目仍可读。
- 不允许手工输入外部人员，也不使用旧 `erp.employees` 兼容目录作为候选数据源。
- 规范员工目录读取失败时，选择器失败关闭并提供重试；不得退回旧员工数据。
- 两个担当在报价阶段允许为空，以支持尚未分派人员的项目。

### 2.4 日期

- 页面标签 `开始日期` 改为 `开工日期`。
- 持久化字段继续使用 `startDate`，避免为文案变化引入数据迁移。
- `工程结束日期` 标签和 `endDate` 字段保持不变。

### 2.5 项目金额

- “项目金额”定义为现有合同收入域计算出的当前合同税込总金额。
- 项目页不创建新的可编辑金额字段。
- 唯一录入和修改入口仍为现有“合同收入”流程。
- 项目卡片显示 `adjustedTaxInclusiveAmount`；尚未录入时显示“未录入”。
- 项目金额、已收款、收款进度及合同收入入口只向以下人员显示：
  - `department === '设计部'`
  - `department === '财务部'`
  - `position === '社长'`
  - `employeeNumber === 'SW-000'`，即 `システム管理者`
- 上述人员仍需拥有工程项目模块查看权限才能进入项目页；金额修改还需拥有工程项目更新权限。
- 权限是固定服务端规则，不得通过给其他部门或职位配置模板而扩大。

### 2.6 项目文件

文件分为三类：

- `contract`：合同
- `drawing`：图纸
- `legal`：甲方法律文件

可见规则：

- 图纸：拥有工程项目查看权限的活跃员工可查看。
- 合同和甲方法律文件：仅项目金额白名单人员可查看。
- 上传新版本或作废文件：除具备相应查看资格外，还必须拥有工程项目更新权限。

文件行为：

- 使用私有 Supabase Storage bucket，不生成永久公开 URL。
- 查看或下载时生成有效期五分钟的 signed URL。
- 单文件上限 `50 MiB`。
- 合同、法律文件允许 PDF、JPG、JPEG、PNG、WEBP、DOC、DOCX、XLS、XLSX。
- 图纸额外允许 DWG、DXF、ZIP。
- 扩展名与 MIME 类型同时校验；未知或不匹配类型拒绝上传。
- 对大于 6 MiB 的文件使用 Supabase TUS resumable upload，显示进度并支持失败后继续；不覆盖既有对象。
- 对象路径仅包含项目 ID、文档 UUID 和版本号，不包含客户名、项目名或原文件名。
- 上传新文件或替换文件均创建不可变新版本。
- “删除”是作废元数据，不物理删除历史版本；历史对象仅由受控清理流程处理。
- 上传对象成功但元数据落库失败时立即尝试删除对象；无法清理时登记 `cleanup_pending`，供受控重试处理。

Supabase Storage 参考：

- https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/buckets/fundamentals

## 3. 页面与交互

### 3.1 项目表单

表单按以下顺序展示：

1. 项目名称、客户名称
2. 项目地址、地址定位按钮
3. 可交互地图、定位状态、纬度/经度摘要、打卡范围（默认 300 米）
4. 项目状态、设计担当、现场担当
5. 开工日期、工程结束日期
6. 备注
7. 保存、取消

地图组件只在项目表单展开时初始化，避免列表页常驻地图实例。首次定位结果、手工选点或拖动标记都会更新表单内坐标；只有保存项目后才进入持久化数据。

若地址已修改但未重新确认坐标，表单明确显示“地址已变更，请重新定位”。切换到 `待开工` 或 `进行中` 时阻止保存，并将焦点移动到定位区。

### 3.2 项目卡片

项目卡片显示：

- 项目名称、编号、状态
- 客户、地址、定位状态、打卡范围
- 设计担当、现场担当
- 开工日期、工程结束日期
- 备注
- 对白名单用户显示项目金额、已收款、收款进度和合同收入入口
- 文件管理入口
- 编辑、删除操作

无金额权限时不渲染占位符或“无权限”金额卡，避免泄露该项目是否已录入合同。

### 3.3 文件面板

项目保存并取得 `projectId` 后才允许上传文件。文件面板按合同、图纸、甲方法律文件分组，每组显示：

- 当前有效版本
- 文件名、大小、版本号、上传人、上传时间
- 查看、下载、新版本、作废按钮
- 可展开的历史版本

不具备敏感文件查看资格的用户完全不收到合同与法律文件元数据，因此页面也不渲染对应分组。

## 4. 数据模型

### 4.1 项目 payload 新字段

项目基础 payload 新增：

```text
latitude: number | null
longitude: number | null
attendanceRadiusMeters: number
locationConfirmedAt: ISO timestamp | ''
locationAddressSnapshot: string
designAssigneeEmployeeId: UUID | ''
designAssigneeEmployeeNumber: string
designAssigneeName: string
siteAssigneeEmployeeId: UUID | ''
siteAssigneeEmployeeNumber: string
siteAssigneeName: string
```

兼容规则：

- 旧项目没有定位字段时规范化为 `null/null/300/''/''`。
- 旧 `manager` 不删除。
- 当项目没有新的现场担当姓名时，列表将旧 `manager` 只读显示为“历史负责人”；编辑后只有用户明确选择现场担当才写入新关联字段。
- 项目金额继续使用既有合同收入字段与快照，不加入新的 `projectAmount` 字段。

### 4.2 项目文档元数据

新增 `public.project_documents`，每一行代表一个不可变文件版本，至少包含：

```text
document_id uuid primary key
project_id text not null
category text check in ('contract', 'drawing', 'legal')
logical_document_id uuid not null
version integer not null
bucket_id text not null
object_path text not null unique
original_file_name text not null
content_type text not null
size_bytes bigint not null
checksum_sha256 text
status text check in ('pending', 'active', 'void', 'cleanup_pending')
created_by_employee_id uuid not null
created_by_employee_number text not null
created_by_employee_name text not null
created_at timestamptz not null
completed_at timestamptz
voided_by_employee_id uuid
voided_at timestamptz
void_reason text
```

`logical_document_id + version` 唯一。当前版本由同一逻辑文件中最大的 active version 决定，不在项目 JSONB 中复制文件目录。

## 5. 服务与安全边界

### 5.1 项目基础资料

现有 `projects.payload` 同时含基础资料和历史合同字段，PostgreSQL RLS 无法隐藏单个 JSONB 键。因此项目访问改为专用安全 RPC：

- 取消认证浏览器对 `projects` 的直接读取和写入。
- `list_projects_secure()` 检查活跃员工和 `module.projects.view`。
- 对金额白名单返回完整允许字段；对其他项目用户在数据库内移除所有历史及现行金额字段后返回。
- `create_project_secure()`、`update_project_secure()` 和 `soft_delete_project_secure()` 分别检查工程项目 create、update、delete 权限。
- 非白名单调用者不能通过项目写 RPC新增、修改或恢复任何合同金额键。
- 合同收入表继续要求项目模块权限，并改用固定金额白名单函数保护读取和写入。

前端的可见性 helper 只用于界面体验；真正授权以数据库函数为准。

### 5.2 固定金额白名单

新增服务端函数判断当前用户是否属于固定白名单。函数只接受已完成首次改密、在职、账号启用且未删除的规范员工。系统管理员通过 `SW-000` 识别，不通过姓名识别。

权限模板接口必须拒绝把合同金额查看或修改权限赋给白名单之外的部门和职位，避免模板配置绕过固定规则。

迁移执行时应删除白名单之外已有的 `sensitive.contract_amount_view` 与 `sensitive.contract_amount_update` 模板授权并写入安全审计；固定白名单判断不依赖这些可编辑模板授权。

### 5.3 员工目录

项目页进入时调用现有 `employee_directory()`，仅接收非隐藏员工的安全摘要字段。目录不写入 localStorage，也不复用人员管理详情缓存。

### 5.4 文件存储

- 创建私有 bucket `erp-project-documents`。
- `storage.objects` 策略只作用于该 bucket，不修改其他 bucket 策略。
- 对象读取按路径关联 `project_documents` 元数据，并再次检查文档类别及当前员工权限。
- 上传使用新的 UUID 路径和 INSERT，不使用 upsert。
- 元数据创建、版本分配和作废通过受控 RPC 完成，以数据库事务保证版本唯一和审计身份来自当前规范员工。
- 预留 RPC 先创建 `pending` 元数据；Storage INSERT 策略只接受与当前员工、项目、对象路径和 pending 元数据完全匹配的上传。
- 完成 RPC 只有在对象存在且大小、类型与预留值一致时才把元数据改为 `active`。
- signed URL 只有在调用时权限检查通过后才生成，过期时间固定为 300 秒。

### 5.5 浏览器缓存

项目、合同变更、付款计划、收款流水和项目文件元数据均只保存在当前认证会话的内存状态，不再写入跨账号共享的 localStorage。前端不得从 `erp.projects`、`erp.projectContractChanges`、`erp.projectPaymentPlans` 或 `erp.projectReceipts` 本地键补回服务端未返回的数据。

部署前由系统管理员完成旧本地数据迁移和备份；新版首次启动后删除上述运行时敏感缓存键。这样既保留受控迁移窗口，也避免同一浏览器换账号后读取上一账号的金额数据。

## 6. 组件边界

为避免继续扩大 `App.jsx`，本次仅抽取与项目功能直接相关的单元：

- `src/features/projects/projectDomain.js`：状态、规范化、payload、定位和担当验证。
- `src/features/projects/projectPermissions.js`：前端固定白名单显示判断。
- `src/features/projects/projectLocationService.js`：地址标准化、节流、缓存与 geocoding adapter。
- `src/features/projects/ProjectLocationPicker.jsx`：地图初始化、选点、拖动和 300 米范围预览。
- `src/features/projects/projectDocumentDomain.js`：类别、类型、大小和版本规则。
- `src/features/projects/projectDocumentService.js`：TUS 上传、元数据 RPC、signed URL 与补偿清理。
- `src/features/projects/ProjectDocumentsPanel.jsx`：三个文件分组、进度、历史版本和作废交互。
- `src/features/projects/ProjectPage.jsx`：项目表单与卡片列表。
- `src/services/projectService.js`：改为专用安全项目 RPC 客户端，不再代理通用 JSONB CRUD。

`App.jsx` 继续负责认证应用状态和页面路由，只向项目页传入当前用户、项目集合、规范员工目录及刷新/退出回调。

## 7. 数据流

### 7.1 项目读取

1. 认证应用进入工程项目页。
2. 并行读取安全项目列表、规范员工目录及当前用户允许的文件元数据。
3. 数据库先检查活跃账号与模块权限。
4. 数据库按固定金额白名单返回完整或已剥离金额的项目 payload。
5. 前端规范化旧字段并渲染，不从 localStorage 补回服务端未返回的敏感字段。

### 7.2 项目保存

1. 前端执行字段、担当、状态与定位验证。
2. 前端只提交允许的基础项目字段。
3. 服务端重新验证字段集合、模块权限和敏感键禁写规则。
4. 数据库写入单个项目并返回安全投影。
5. 前端以服务端返回值更新项目集合。

### 7.3 文件上传

1. 前端验证类别、扩展名、MIME 和 50 MiB 上限。
2. 服务端预留文档 UUID、逻辑文档 UUID、版本号、不可变对象路径及 pending 元数据。
3. 浏览器使用 TUS 上传到私有 bucket 并显示进度。
4. 上传完成后调用元数据完成 RPC，服务端核对对象后将状态改为 active。
5. 元数据失败时立即请求清理对象；清理失败则记录 `cleanup_pending`。
6. 成功后刷新当前类别文件列表。

## 8. 错误处理

- 地址服务不可用：显示可重试提示，保留地址和旧坐标，允许地图手动选点。
- 地址无结果：提示用户补充都道府县、市区町村和番地，不清空表单。
- 地图底图不可用：仍显示经纬度输入摘要，允许稍后重试，不伪造定位成功。
- 员工目录失败：清空候选项并提供重试；已有项目担当姓名仍可只读展示。
- 项目读取、保存或删除被拒绝：使用现有安全错误文案并失败关闭，不显示缓存旧数据。
- 文件权限被撤销：下一次元数据读取或 signed URL 创建立即失败；既有五分钟链接在到期前无法提前撤回，因此有效期不得延长。
- 上传中断：TUS 保存断点并允许继续；同一不可变路径不并发覆盖。
- 元数据完成失败：执行补偿清理并向用户显示未保存提示。
- 作废失败：保留当前版本，不从 UI 乐观移除。

## 9. 测试与验收

### 9.1 自动测试

新增或扩展以下测试：

- 项目领域：七种状态、`报价中` 默认值、字段规范化、旧 `manager` 兼容。
- 定位领域：纬度经度范围、300 米默认值、地址变更使坐标待确认、待开工/进行中强制定位。
- 担当领域：设计部与工程部过滤；离职、停用、错误部门和隐藏账号排除。
- 金额显示：白名单四类身份可见，其他身份不可见。
- SQL 安全契约：无权限用户只获得剥离金额的项目；直接表访问被拒绝；白名单外无法读写合同收入。
- 浏览器缓存契约：项目金额、合同流水和文件元数据不写入 localStorage，旧敏感缓存键在受控迁移后清除。
- 文件领域：类别、扩展名、MIME、大小、对象路径和版本验证。
- 文件服务：TUS 进度、断点恢复、元数据完成、补偿清理、五分钟 signed URL。
- Storage SQL/pgTAP：drawing 与 contract/legal 的读写矩阵、其他 bucket 不受影响。
- UI 契约：新字段、文件入口、敏感区不渲染、旧开始日期文案被替换。
- 回归：现有合同收入计算和确认流程保持通过。

### 9.2 完成验证

实现完成前必须取得以下新鲜证据：

1. `npm test` 全部通过。
2. `npm run build` 成功且无构建错误。
3. 可用本地 Supabase 环境时执行数据库迁移和 pgTAP；若环境不可用，必须明确报告未执行项，不能宣称数据库集成已验证。
4. 在本地浏览器验证新增、编辑、七种状态、地址定位、地图微调、担当过滤、金额权限和三类文件流程。
5. 使用至少一个白名单账号和一个普通工程项目账号验证数据库返回内容确实不同。
6. 验证现有未提交的账号引导修复文件未被本功能覆盖或纳入提交。

## 10. 部署顺序

1. 备份现有项目和合同收入数据。
2. 部署数据库安全 RPC、固定白名单、项目文档表、bucket 及精确 Storage 策略。
3. 使用受控账号验证项目安全投影与文件权限矩阵。
4. 部署前端。
5. 执行真实账号验收。

不得先部署依赖新 RPC 的前端，也不得创建公共 bucket 作为临时过渡。

## 11. 非目标

本次不实现员工打卡页面、员工移动轨迹、后台持续定位、路线规划、批量地址地理编码、病毒扫描服务或公司级法务档案库。定位数据只为后续打卡功能建立可靠项目坐标基础。
