# 工程项目普通文件归档与长期保存设计

**日期：** 2026-07-15
**目标工作区：** `/Users/yu/Documents/kaobeierp/employee-auth-worktree`
**状态：** 四部分设计已获用户确认，待本文件最终书面复核

## 1. 文档定位

本设计为工程项目新增三类普通项目文件的安全归档能力：

- 项目合同；
- 效果图；
- 后期产生的增减项单据。

增减项单据只是项目级普通文件，不绑定某一条合同增减记录，也不参与合同金额计算。

本文件取代以下旧设计中与“项目文件”有关的分类、权限、数据模型、上传和验收内容：

- `docs/superpowers/specs/2026-07-15-project-page-location-roles-financials-documents-design.md`
- `docs/superpowers/plans/2026-07-15-project-documents.md`

旧文档中的 `contract / drawing / legal` 分类不得继续实现。书面设计通过后，应依据本文件重新编写实施计划；在此之前不修改功能代码。

## 2. 目标与保存承诺

### 2.1 功能目标

- 每个已保存项目可归档多份合同、效果图和增减项单据。
- 文件可查看、下载、上传新版本、查看历史和作废。
- 文件版本不可被覆盖；作废不等于删除。
- 项目被软删除后，文件仍保留，只有系统管理员可从只读档案中访问。
- 数据库、Storage、服务端接口和界面使用同一套权限规则。
- 文件名、项目名、客户名不进入 Storage 对象路径。

### 2.2 “永久保存”的准确含义

本功能提供的是应用级长期保留：

- `active` 和 `void` 文件在正常业务操作中没有物理删除入口；
- 项目删除不级联删除文件或版本元数据；
- 主存储和独立备份均不配置自动过期生命周期；
- 每个已完成版本保留 SHA-256 校验值，可在备份与恢复时验证完整性。

仅把文件放入 Supabase Storage 不能单独称为完整的灾难恢复。Supabase 官方说明数据库备份不包含 Storage 中的对象，因此必须另外复制对象并保存对应元数据。只有独立备份目标、自动任务和恢复校验均已配置并成功运行后，系统才能显示“灾难恢复已启用”；否则只能显示“云端长期保存，异地备份未启用”。参考：[Supabase 数据库备份](https://supabase.com/docs/guides/platform/backups)、[下载 Storage 对象](https://supabase.com/docs/guides/storage/management/download-objects)、[删除项目的影响](https://supabase.com/docs/guides/platform/delete-project)。

本设计不承诺法律意义上的 WORM、法定年限保管或任何云厂商绝对不会丢失数据。若未来有法务级不可删除要求，应单独设计带 Object Lock 的合规归档。

## 3. 文件分类与权限

### 3.1 固定分类

数据库和前端使用以下固定代码，分类由服务端决定其敏感级别，客户端不能自行传入或更改授权级别：

| 分类代码 | 页面名称 | 授权级别 |
| --- | --- | --- |
| `project_contract` | 项目合同 | 敏感 |
| `rendering` | 效果图 | 项目可见 |
| `contract_change_document` | 增减项单据 | 敏感 |

同一分类允许存在多个独立逻辑文件，文件名重复也不会互相覆盖。

### 3.2 权限矩阵

所有规则首先要求当前登录人来自规范员工目录，处于在职、账号启用、未删除且已完成首次改密状态。

| 操作 | 效果图 | 项目合同、增减项单据 |
| --- | --- | --- |
| 列表、查看、下载 | `module.projects.view` | `module.projects.view`，且属于设计部、财务部、职位为社长，或员工编号为 `SW-000` |
| 上传、新版本、作废 | 上述查看资格 + `module.projects.update` | 上述敏感查看资格 + `module.projects.update` |
| 已删除项目档案 | 仅 `SW-000` 只读 | 仅 `SW-000` 只读 |

敏感白名单是固定服务端规则，不依赖可编辑权限模板，不能通过界面配置扩大到其他部门或职位。系统管理员只通过员工编号 `SW-000` 识别，不通过显示姓名识别。

普通用户不只是看不到敏感分组；服务端列表结果中也不得包含敏感文件的文件名、数量、版本、上传人、时间或对象路径。

### 3.3 项目删除后的规则

- 普通工程项目列表继续隐藏软删除项目。
- 项目一旦软删除，设计部、财务部、社长和普通项目用户均不能继续访问其文件。
- 软删除、停用账号或撤权后，普通接口立即拒绝新的目录和链接请求；已经签发的链接无法主动撤销，仍可能在最多 5 分钟内使用。这是短期签名链接方案的明确有界窗口。
- `SW-000` 在工程项目页看到单独的“已删除项目档案”入口。
- 档案页允许读取项目快照、文件目录、历史版本、预览和下载。
- 档案页不允许编辑项目、恢复项目、上传、新版本或作废文件。

## 4. 页面与交互

### 4.1 新建项目与文件入口

文件必须归属于真实 `projectId`，因此新项目先保存基础资料，再允许上传文件。新建表单不把待上传文件放入浏览器缓存，也不制造临时项目记录。

项目保存成功后，项目卡片显示“文件管理”入口。文件面板分为：

1. 项目合同
2. 效果图
3. 增减项单据

不具备敏感权限时，只显示效果图分组，不显示占位符、锁图标或文件数量。

### 4.2 文件列表

每个逻辑文件显示：

- 原始文件名和文件大小；
- 当前版本号；
- 上传人姓名与员工编号；
- 上传完成时间；
- 查看、下载、上传新版本、历史版本和作废操作。

历史列表显示每个版本的状态、校验值摘要、上传人与时间。作废必须填写原因；作废后仍可在历史中查看和下载。若最新版本被作废，界面回退到该逻辑文件中版本号最高的未作废版本，并明确提示发生了回退。版本号永不复用。

### 4.3 上传体验

- 支持一次选择多个文件，每个文件独立显示校验、进度、完成或失败状态。
- 单文件上限为 `50 MiB`（`52,428,800` 字节）。
- 大于 `6 MiB`（`6,291,456` 字节）使用 Supabase TUS 断点续传；等于或小于该值使用标准上传。
- 断点信息只保存在当前已挂载页面的内存中，不写入 localStorage、sessionStorage 或 IndexedDB。
- 页面未刷新时可继续中断的 TUS 上传。精确路径上传票据只能在预留后的 5 分钟内签发，票据最长有效 2 小时；TUS URL 从实际创建起最长有效 24 小时。因此 abandoned pending 的 `cleanup_not_before` 固定为预留时间 + 5 分钟 + 2 小时 + 24 小时 + 1 小时宽限期，在此之前清理器不得认领。页面刷新或退出后，用户重新上传会取得新的预留版本。参考：[Supabase TUS 断点上传](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)、[签名上传 URL](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl)。
- 上传失败不会覆盖或隐藏旧的有效版本。只有服务端完成校验并把新版本标记为 `active` 后，界面才将其显示为当前版本。
- 上传完成进入 `queued/finalizing` 后，前端按 1、2、4、8 秒递增并以 10 秒封顶轮询安全状态；前台等待超过 5 分钟时显示“后台校验中”并停止自动轮询，用户可手动刷新，服务端任务不被取消。
- 面板可读取当前用户自己未结束上传的安全摘要；对仍为 pending 的记录提供“放弃上传”，不显示对象路径、票据或 TUS URL。放弃后进入受控清理，可立即释放并发额度。

### 4.4 预览与下载

- JPG、JPEG、PNG、WEBP 和浏览器支持的 PDF 使用临时签名链接预览。
- HEIC/HEIF 只在浏览器支持时预览，否则显示下载按钮，不做有损转码。
- Word、Excel 以及浏览器不能直接预览的文件强制以 attachment 下载，不上传到第三方在线预览服务；响应需验证 `X-Content-Type-Options: nosniff`，界面提示“文件未经病毒扫描，请确认来源后打开”。
- 每次操作即时申请有效期固定为 5 分钟的签名链接；链接不持久化，对象缓存时间设置为 0。
- 权限被撤销后不能提前收回已经签发的链接，因此服务端每次签发前重新鉴权，并把有效期严格限制为 5 分钟。若未来业务要求“撤权后零秒失效”，必须改成每个字节都经过实时鉴权代理的下载模式，而不能继续使用签名链接。参考：[Supabase 私有文件与签名链接](https://supabase.com/docs/guides/storage/serving/downloads)。

## 5. 文件类型规则

### 5.1 允许类型

`project_contract` 和 `contract_change_document` 允许：

- PDF：`.pdf`
- Word：`.doc`、`.docx`
- Excel：`.xls`、`.xlsx`
- 常用图片：`.jpg`、`.jpeg`、`.png`、`.webp`

`rendering` 允许：

- `.jpg`、`.jpeg`、`.png`、`.webp`
- `.heic`、`.heif`
- `.pdf`

不允许可执行文件、压缩包、CAD 源文件、音视频或未列出的扩展名。

### 5.2 两阶段校验

浏览器先校验扩展名、声明 MIME 和大小，以尽早给出反馈；服务端完成函数再读取私有对象，校验实际字节数、文件签名和 SHA-256。服务端结果为最终结果。

HEIC/HEIF 在部分浏览器中可能没有声明 MIME；预留接口按扩展名为 Storage 上传指定规范 `image/heic` 或 `image/heif`，同时保留原始声明 MIME 为空的事实，仅当服务端确认文件签名时允许完成。其他未知或扩展名、MIME、签名不匹配的文件拒绝激活并进入失败清理流程。

原始文件名仅作为授权后的显示和下载名称保存。服务端只取基础文件名，移除路径分隔符、CR/LF、空字节、双向文本控制符和其他 Unicode 控制/格式字符，规范化 Unicode，并限制为 255 个 UTF-8 字节；对象路径永远不使用该名称。作废原因经同样的控制字符清理，去除首尾空白后必须为 1–500 个字符。

## 6. 数据模型与不可变版本

### 6.1 `project_document_logicals`

每个独立逻辑文件有一行父记录，用来固定所属项目、分类并串行分配版本：

```text
logical_document_id uuid primary key
project_id text not null
document_kind text not null
last_reserved_version integer not null
created_by_employee_id uuid not null
created_at timestamptz not null
```

创建新文件时，预留 RPC 同时创建父记录和 v1。上传新版本时，RPC 必须在事务内 `SELECT ... FOR UPDATE` 锁住该父记录，确认它属于请求项目和同一分类，再递增 `last_reserved_version` 并创建版本行。父表对 `(logical_document_id, project_id, document_kind)` 建唯一约束，版本表使用对应复合外键，数据库层也禁止跨项目或跨分类挂接。客户端不能传入版本号，也不能把已有 `logical_document_id` 改挂到其他项目或分类。并发预留因此顺序分配不同版本；失败预留占用的版本号不复用。

逻辑父记录的 ID、项目、分类、创建人和创建时间由不可变触发器保护；`last_reserved_version` 只能由预留函数在持锁事务中递增。存在任何版本行时父记录禁止删除，业务接口永远不提供父记录删除操作。

### 6.2 `project_documents`

每一行代表一个文件版本。至少包含：

```text
document_id uuid primary key
project_id text not null
document_kind text not null
logical_document_id uuid not null
version integer not null
bucket_id text not null
object_path text not null unique
original_file_name text not null
file_extension text not null
declared_content_type text not null
verified_content_type text
expected_size_bytes bigint not null
verified_size_bytes bigint
expected_checksum_sha256 text not null
verified_checksum_sha256 text
status text not null
processing_token uuid
processing_lease_until timestamptz
upload_ticket_issuable_until timestamptz not null
cleanup_not_before timestamptz not null
created_by_employee_id uuid not null
created_by_employee_number text not null
created_by_employee_name text not null
created_at timestamptz not null
completed_at timestamptz
voided_by_employee_id uuid
voided_by_employee_number text
voided_at timestamptz
void_reason text
failure_code text
```

约束：

- `document_kind` 只允许三种固定分类。
- `status` 只允许 `pending`、`queued`、`finalizing`、`active`、`void`、`failed`、`cleanup_pending`。
- `logical_document_id + version` 唯一，版本从 1 递增且不复用。
- `object_path` 固定为 `<projectId>/<documentId>/<version>`，不含扩展名和任何业务名称。
- `bucket_id` 固定为私有 bucket `erp-project-documents`。
- 项目外键禁止级联删除；项目表物理删除时应被 `RESTRICT` 阻止。
- `active` 和 `void` 行的身份、分类、路径、文件信息、版本和校验值不可更新；`active` 必须具有相等的预期/实测大小与 SHA-256。
- 所有版本元数据行均由触发器拒绝 DELETE；失败清理只删除 Storage 中未激活的对象，并把元数据保留为 `failed`。active/void 的对象和元数据均没有业务删除路径。
- 只允许受控状态迁移：`pending -> queued/cleanup_pending`、`queued -> finalizing/cleanup_pending`、`finalizing -> active/queued/cleanup_pending`、`active -> void`、`cleanup_pending -> failed`。`queued -> cleanup_pending` 只允许在 job 的总重试截止时间已过时发生。
- 完成请求只幂等创建唯一 job 并把 `pending` 转为 `queued`，不生成处理 token。worker 在同一数据库事务中把 job 与文档一起认领为 processing/finalizing，并只在版本行生成唯一权威的随机 `processing_token` 和 lease；job 表不保存第二份 token 或 lease。
- worker 只续租版本行。所有激活、重排队和失败更新必须同时匹配文档 ID、`finalizing`、token，并要求 `processing_lease_until > clock_timestamp()`。
- 瞬时 Storage/网络错误把 `finalizing` 原子退回 `queued`，按 5 秒、30 秒、2 分钟、10 分钟、30 分钟退避，最多尝试 5 次且总重试窗口不超过 2 小时。worker 崩溃后，reaper 对过期 lease 执行相同的重排队；只有确定性格式/校验失败、最终鉴权失败或重试耗尽才进入 `cleanup_pending`。
- 清理器只认领 `cleanup_pending`，并以新 token/lease 原子替换旧处理权；不得直接清理刚过期的 `finalizing`。超过 `cleanup_not_before` 仍未提交完成请求的 abandoned `pending` 才可转为 `cleanup_pending`。
- processing token、lease 和内部任务 ID 只对 worker 可见，任何浏览器投影、日志或错误响应都不得返回这些值。
- 重复完成请求必须幂等：已经 `active` 时返回同一版本，`queued/finalizing` 时返回处理中，其他终态不得重复激活。

当前版本按同一 `logical_document_id` 中版本号最高的 `active` 行计算，不在项目 JSONB 中复制目录或当前版本号。

### 6.3 校验队列、审计与备份快照

`project_document_verification_jobs` 每个文档最多一行，只保存 `queued/processing/succeeded/failed`、尝试次数、下次可用时间、重试截止时间和安全错误码，不保存 token 或 lease。浏览器不能直接读取或写入该队列；完成接口幂等创建任务，worker 的认领/重排队事务同时更新 job 与版本行。

新增仅追加的 `project_document_events`，记录预留、完成、查看链接申请、下载链接申请、作废、失败清理和档案访问。事件保存操作人、项目、文件版本、时间和安全结果，不保存签名链接本身。

`project_document_backup_runs` 记录备份目标标识、快照水位线、开始/完成时间、对象数量、字节数、清单校验值和成功/失败状态。`project_document_backup_items` 在每次运行开始时冻结该恢复点的完整对象清单和元数据摘要。两张表均不存储备份密钥。

元数据表、逻辑文件表、队列表、审计表和备份表均撤销 `anon/authenticated` 直接表权限。所有 `SECURITY DEFINER` 函数使用固定 `search_path` 和最小授权。审计事件禁止普通角色直接 INSERT，并以触发器拒绝 UPDATE/DELETE；事件字段最小化，不写签名 URL、访问 token、对象内容或供应商原始错误。备份运行详情只允许 `SW-000` 通过安全投影读取。pgTAP 必须直接验证版本行 DELETE、逻辑父行 DELETE/身份字段 UPDATE 和审计 UPDATE/DELETE 均被数据库拒绝。

## 7. 私有存储与服务端边界

### 7.1 Storage

- 创建私有 bucket `erp-project-documents`，`public = false`，对象 `cacheControl = 0`。
- bucket 自身也设置 50 MiB 文件上限和三类文件 MIME 的并集；分类级规则继续由预留与完成接口收紧。
- 不调用 `getPublicUrl`，不创建公共 bucket，不把 service-role key 发送到浏览器。
- 浏览器只获得绑定到本人 pending 预留记录和不可变对象路径的短期签名上传票据；票据、TUS URL 和临时上传状态只留在当前页面内存，不入库、不写日志或浏览器持久缓存。
- 上传一律使用新路径和 `upsert = false`，禁止覆盖。
- 该 bucket 对 `authenticated` 不建立 INSERT、SELECT、UPDATE 或 DELETE policy。最小权限 Edge Function 在重新鉴权后用服务端凭据为服务端选定的单一路径调用 `createSignedUploadUrl(..., { upsert: false })`；标准上传使用该 token，TUS 通过 `x-signature` 直传。浏览器即使知道完整对象路径，也不能通过 authenticated object URL 直接上传、GET、列出或删除对象。参考：[Supabase 签名上传 URL](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl)、[TUS 签名上传](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)。
- 新迁移显式删除旧计划可能创建的该 bucket INSERT/SELECT/DELETE policy。pgTAP 验证策略边界，但不能替代 Storage HTTP 行为；标准上传、TUS、直接 authenticated GET/list/delete 必须在与目标相同版本的本地或测试 Storage 上做端到端门禁测试。
- 对其他 bucket 的策略不做任何改动。

### 7.2 安全接口

项目文件使用专用 RPC、队列 worker 和最小权限 Edge Function，不复用通用 JSONB CRUD：

- `list_project_documents_secure(project_id)`：按项目状态、模块权限和固定分类权限过滤元数据。
- `reserve_project_document_secure(...)`：服务端验证项目、分类、权限和资源限额；新版本锁住逻辑文件父行，再分配文档 UUID、版本、对象路径、5 分钟票据签发截止时间和保守的 `cleanup_not_before`。
- `project-document-upload-ticket`：只在票据签发窗口内、文档仍为本人 pending 且实时权限仍满足时，用服务端凭据为数据库路径创建 `upsert: false` 的两小时签名上传 token；token 不落库。
- `request_project_document_finalize_secure(document_id)`：幂等地重新鉴权，在一个事务内把 `pending` 转为 `queued` 并创建唯一校验 job；不生成处理 token/lease。
- `list_my_incomplete_project_documents_secure(project_id)`：只返回当前员工本人未结束上传的安全摘要，不返回内部路径、token、lease 或错误细节。
- `abandon_project_document_upload_secure(document_id)`：仅原上传人可在实时权限仍满足时把自己的 pending 转为 cleanup_pending；queued/finalizing 不能由浏览器取消。
- `project-document-verifier`：在同一数据库事务中认领 queued job 与文档，在版本行生成唯一 token/lease，再使用服务端凭据流式读取对象，计算 SHA-256，并核对大小和真实格式。
- `finalize_project_document_internal(...)`：仅校验 worker 可调用；在最终激活事务内再次检查上传员工当前仍有效、仍具备该分类查看资格和项目更新权限、项目未删除，并以状态 + token + lease 条件更新为 `active`。
- `void_project_document_secure(document_id, reason)`：只允许当前有效项目中具备更新权限的用户作废有效版本。
- `project-document-access`：重新检查实时权限，记录审计，再生成固定 300 秒的预览或下载链接；有效项目按普通权限矩阵处理，软删除项目只接受服务端判定的 `SW-000` archive 模式，客户端不能自行声明 archive 绕过。
- `list_deleted_project_archive_secure()`：只向 `SW-000` 返回软删除项目快照。
- `list_deleted_project_documents_secure(project_id)`：只向 `SW-000` 返回档案文件。
- `get_project_document_backup_status_secure()`：只向 `SW-000` 返回最近一次备份与完整盘点状态，不返回密钥或目标凭据。
- `project-document-reaper`：作为独立于 verifier 的定时任务，把 lease 过期的 finalizing 按尝试次数与两小时重试截止时间原子退回 queued；对从未被认领或重排后一直未处理且已超过重试截止时间的 queued，原子转为 cleanup_pending；不删除对象。
- `project-document-cleanup`：把超过 `cleanup_not_before` 的 abandoned pending 转为 cleanup_pending，再只认领 cleanup_pending 并删除失败对象；绝不直接接收 queued/finalizing/active/void 作为清理目标。

所有接口均从当前认证会话解析员工身份，忽略客户端传入的上传人、部门、职位、敏感级别、对象路径和版本号。

### 7.3 上传事务边界

1. 浏览器校验文件并计算 SHA-256。
2. 预留 RPC 在事务内检查权限/限额、锁定逻辑文件、分配版本并创建 `pending` 元数据。
3. 浏览器立即申请精确路径签名上传票据，并用 token 标准直传或创建 TUS URL；任何 authenticated 直传都失败。
4. 完成请求把 `pending` 原子转为 `queued` 并创建唯一 job；重复请求只返回既有状态。
5. worker 在一个事务中认领 job 和文档，只在版本行生成 token/lease，然后续租、读取对象并核对大小、格式和 SHA-256。
6. 瞬时错误在尝试和总时限内退避重排队；worker 崩溃由 reaper 重排队；从未被认领的 queued 超过总时限后由 reaper 转为 cleanup_pending，不直接删除对象。
7. 最终激活事务重新读取上传员工状态、分类资格、实时权限和项目删除状态，并同时匹配 `finalizing + token + lease 未过期`；任一条件变化都不能激活。
8. 校验与最终鉴权全部通过后，版本转为 `active`、job 转为 `succeeded` 并写审计事件。
9. 确定性失败或重试耗尽才转为 `cleanup_pending`；界面保留旧当前版本。
10. 清理器以新 token/lease 只认领 cleanup_pending，删除对象后把元数据/job 转为 `failed` 并保留审计；旧 worker 因状态、token 和 lease 条件不再可能激活。

服务端状态变化和审计写入必须在数据库事务中完成。对象存储与数据库不能共享事务，因此使用上述预留、校验、补偿清理流程实现最终一致性。

### 7.4 校验 worker 可行性门槛

50 MiB 文件的 SHA-256、HEIC/HEIF 识别、OOXML ZIP 结构检查和旧 DOC/XLS OLE 类型识别可能超过托管 Edge Function 的 CPU、内存或持续时间限制。实现的第一个技术验证必须用各类最坏 50 MiB 样本进行基准测试，并记录 CPU、峰值内存、墙钟时间和失败模式。Supabase 当前托管 Edge 限制包括 256 MB 内存和有限 CPU/持续时间，参考：[Edge Function 限制](https://supabase.com/docs/guides/functions/limits)。

队列与内部完成 RPC 不依赖具体运行器：只有在所有最坏样本都留有足够余量时才使用 Edge worker；否则使用受控的 Node 后台 worker。OOXML 禁止全量解压和嵌套归档，最多检查 10,000 个条目、单条目声明展开大小 100 MiB、总声明展开大小 200 MiB，并拒绝宏启用类型；旧 DOC/XLS 使用有目录链、扇出和循环检测上限的 OLE 解析；HEIC/HEIF 使用有 box 数量、深度和长度上限的解析。Node worker 每个任务在隔离进程中设置 128 MiB 内存与 60 秒墙钟上限，解析崩溃、超时或越界一律失败关闭。

基准语料必须同时包含正常最大文件、zip bomb、嵌套归档、畸形 central directory、OLE 循环链、恶意 HEIC box、截断文件和解析器 fuzz 回归集。生产文件功能在某一种运行器通过资源、重试、崩溃隔离和恶意样本测试前不得启用。格式识别只用于阻止伪装类型，不等于病毒扫描或内容安全证明。

### 7.5 服务端资源限额

为防止误操作或失陷账号耗尽永久存储和校验队列，默认限额由服务端事务执行，而不是只靠界面：

- 每名员工同时最多 5 个 `pending/queued/finalizing/cleanup_pending` 版本；
- 每个项目同时最多 20 个未结束版本；
- 每名员工每小时最多预留 120 个版本，滚动 24 小时最多预留 5 GiB；
- 每个项目 active/void 对象默认累计上限 20 GiB，接近 80% 时向 `SW-000` 告警；
- 全局待校验/校验中队列最多 200 个任务，达到上限时预留失败关闭并返回可重试时间；
- 前端同时最多传输 3 个文件，其余在当前页面内排队。

限额保存在只有服务端可写的配置中。预留事务在项目级锁下把 active/void 实际字节与所有未结束版本的预期字节一起计入容量，防止并发预留绕过上限；员工速率与并发计数也在同一事务内判断。`SW-000` 可通过受控管理操作提高单项目容量或临时批量导入额度，每次调整记录旧值、新值、原因和操作者；不能通过提高额度触发任何历史文件删除。全局 Storage 账户容量也必须监控，容量或队列告警未配置前不得启用生产上传。

## 8. 项目基础安全前置条件

文件系统依赖项目基础资料已经改用安全 RPC。实施文件功能前必须先完成：

- `src/services/projectService.js` 停止代理旧通用 `erp.projects` 接口；
- 浏览器停止把项目、合同金额、合同增减、收款和文件元数据写入共享本地缓存；
- 项目列表、创建、更新和软删除使用服务端模块权限；
- 非金额白名单用户收到的项目投影已在数据库中剥离金额字段；
- 删除项目的状态可以由文件接口在服务端可靠判断。

若这些前置条件未满足，不得用仅前端隐藏按钮的方式上线文件功能。

## 9. 独立备份与恢复

### 9.1 备份内容

提供受控管理脚本，把以下内容复制到与主 Supabase 项目不同账号和凭据域、启用服务端加密、版本化/删除保护且没有自动过期规则的 S3 兼容目标：

- 私有 bucket 内全部 active/void 对象；
- `project_document_logicals` 逻辑父记录与 `last_reserved_version`；
- `project_documents` 元数据；
- 对应项目与操作人员的最小只读身份快照；
- `project_document_events` 审计记录；
- 带版本号的独立 archive schema 定义，可在没有原员工/项目表的隔离环境中导入上述快照并保留内部父子约束；
- 包含对象路径、大小、版本和 SHA-256 的不可变清单。

每次运行先在单个数据库一致性事务中冻结：UTC cutoff、项目快照、逻辑父记录、全部版本元数据、事件水位线，以及所有在 cutoff 前已完成的 active/void 对象清单。事务提交后才复制对象；文件对象本身不可变且不能被业务删除，因此长时间复制不会改变这个恢复点。cutoff 后的上传、作废或项目删除进入下一次恢复点。

备份对象按 SHA-256 写入不可变内容库；日常增量只复制尚不存在的内容，但每次 UTC run 前缀都保存一份完整自包含的 archive schema、项目/人员快照、逻辑父表、版本表、事件快照和完整对象引用清单。verification job 是临时执行状态，不作为可重放任务备份。因此任一成功 run 都是独立可选择的恢复点，不依赖原员工表、原项目表或拼接一串增量清单。

所有对象与元数据复核完成后，脚本最后写入不可变 `COMPLETED.json`，其中包含 schema 版本、cutoff、manifest SHA-256、对象数量、总字节数及每个目标 version ID，并使用与 Storage 凭据分离的 KMS 非对称密钥签名。源库 `backup_runs` 只有在回读并验证该 marker 后才能转为成功。备份目标中没有 marker、marker 验签失败或 manifest 不匹配的 run 一律视为未完成，不能恢复。

备份 writer 使用只能列出、读取和新增版本、不能删除或缩短保留期的最小权限凭据；恢复读取凭据单独保存，不进入日常运行环境。目标启用版本化和经验证的 Object Lock/删除保护，清单固定每个备份对象的目标 version ID、ETag 和 SHA-256，防止后写的同名版本改变既有恢复点。凭据定期轮换，连续失败、对象缺失、校验不符或凭据异常均告警。版本化、删除保护、加密、独立凭据、首次完整 run 和恢复抽查全部通过前，“灾难恢复已启用”状态必须保持关闭。建议生产环境每天执行一次增量复制、每周执行一次完整盘点、每季度执行一次隔离恢复演练；具体目标和定时任务在生产确认时启用。

### 9.2 恢复规则

恢复说明必须覆盖：

1. 只选择 `COMPLETED.json` 存在、KMS 签名有效且 manifest 哈希匹配的 run；
2. 在隔离环境创建该 run 指定版本的 archive schema；完整生产恢复则应先恢复规范员工与项目核心数据库；
3. 先导入项目/人员快照和 `project_document_logicals`，再按外键顺序恢复版本与审计元数据；
4. 按清单固定的 target version ID 从内容库恢复对象到私有 bucket；
5. 对每个对象重新计算 SHA-256；
6. 数量、大小、父子关系、`last_reserved_version` 和校验值全部一致后才标记恢复成功；
7. cutoff 时仍处于 pending/queued/finalizing/cleanup_pending 的版本恢复为带 `recovery_interrupted` 原因的 `failed` 历史，不恢复为运行中任务，也不重放 verification job；
8. 使用 `SW-000` 档案账号抽查预览和下载；
9. 不因恢复而生成公共 URL或改写 active/void 历史版本。

本地实现阶段只创建脚本、配置样例、自动测试和恢复说明，不擅自连接或写入生产备份目标。生产目标、凭据、定时任务和首次完整备份需另行确认。

## 10. 前端组件边界

- `src/features/projects/projectDocumentDomain.js`：分类、文件类型、大小、状态和版本视图规则。
- `src/features/projects/projectDocumentPermissions.js`：仅用于界面体验的显示 helper；不得替代服务端授权。
- `src/features/projects/projectDocumentService.js`：预留、标准/TUS 上传、完成、列表、临时链接、作废和档案接口。
- `src/features/projects/ProjectDocumentsPanel.jsx`：三个分组、批量进度、历史、预览、下载和作废。
- `src/features/projects/DeletedProjectArchive.jsx`：仅 `SW-000` 可见的只读档案。
- `src/features/projects/ProjectPage.jsx`：保存项目后提供文件管理入口，不自行实现 Storage 细节。
- `scripts/backup-project-documents.mjs`：独立备份、清单和校验。
- `docs/project-document-backup-and-restore.md`：配置、运行、恢复与演练说明。

上传状态只属于当前认证会话的内存。退出登录时必须取消未完成请求并清空文件名、进度、预留记录和临时链接。

只读档案页顶部向 `SW-000` 显示最近一次备份、完整盘点和恢复演练状态；状态只来自安全接口，前端不得根据本地时间自行推断“已备份”。

## 11. 错误处理

- 项目保存失败：不开放文件入口，也不创建临时文件项目。
- 权限在上传途中被撤销：完成步骤失败，新版本不激活；对象进入受控清理。
- 标准或 TUS 上传中断：保留旧当前版本，页面内允许重试或继续。
- 上传票据过期或错过 5 分钟签发窗口：不延长旧 reservation，提示用户重新预留新版本；旧 pending 按 `cleanup_not_before` 清理。
- 重复完成请求：返回同一 active 版本或当前 queued/finalizing 状态，不创建重复任务、不重复激活。
- 校验遇到瞬时 Storage/网络错误：在两小时/五次上限内退避重排队，不立即删除对象；确定性失败或重试耗尽才进入清理。
- verifier 从未认领 queued job：独立 reaper 在两小时截止时间后转入受控清理，释放员工、项目和全局队列额度。
- 文件内容校验失败：显示安全错误，不向用户暴露内部对象路径。
- 完成成功但界面刷新失败：重新调用安全列表，禁止重复上传同一路径。
- 作废失败：保留原状态，不做乐观移除。
- 临时链接过期：重新检查权限并申请新链接，不自动延长旧链接。
- 项目已删除：普通接口立即返回统一的不可用结果，不泄露档案存在性；删除前已经签发的链接最多继续有效 5 分钟。
- 清理任务失败：保持 `cleanup_pending` 并重试；不得扩大到 queued/finalizing/active/void 对象。
- 异地备份未配置或最近一次失败：管理状态明确显示，不能用“永久安全”掩盖。

## 12. 实施顺序

1. 完成项目基础资料安全 RPC 接入并移除敏感浏览器缓存依赖。
2. 新增数据库迁移：私有 bucket、逻辑文件/版本/校验队列表、审计表、备份快照表、权限函数、RPC、无浏览器 Storage policy、lease 和不可变约束。
3. 实现精确路径签名上传票据，并先在目标 Storage 版本验证标准/TUS 上传与直接访问拒绝。
4. 完成 50 MiB/恶意样本基准，再依据结果实现 Edge 或 Node 校验 worker、reaper、临时访问和原子失败清理。
5. 用测试驱动实现文件领域、上传服务、文件面板和只读档案页。
6. 实现独立备份脚本、KMS marker、配置样例和恢复说明。
7. 在本地执行领域测试、服务测试、SQL/pgTAP、Storage HTTP、worker 测试、全量 `npm test` 和 `npm run build`。
8. 在本地浏览器按权限矩阵验收上传、进度、预览、下载、续传、新版本、作废、历史和删除项目档案。
9. 汇报本地验证结果；生产 Supabase 迁移、函数、bucket、worker、备份目标或定时任务均需另行确认后执行。

## 13. 测试与验收标准

### 13.1 自动测试

- 文件领域：三种分类、扩展名/MIME/签名、50 MiB 上限、6 MiB 边界、版本回退。
- 权限：效果图项目查看权限、敏感固定白名单、更新权限、停用/离职/未改密账号失败关闭。
- 数据库：普通用户完全收不到敏感元数据；直接表访问被拒绝；路径由服务端分配；并发新版本在父行锁下取得不同版本；版本元数据 DELETE、父行身份 UPDATE/DELETE 和项目硬删除均被阻止。
- Storage：authenticated 在该 bucket 没有 INSERT/SELECT/UPDATE/DELETE policy；服务端票据只能上传匹配 pending 的单一路径且不能覆盖；标准和 TUS HTTP 实测成功；直接上传、GET 已知路径、列全 bucket、UPDATE 和 DELETE 均失败；旧策略被移除；其他 bucket 策略不变。
- 上传时限：票据只能在预留后 5 分钟内签发且 2 小时失效；最晚创建的 24 小时 TUS URL 与一小时宽限期结束前，cleanup 不能认领 pending。
- 完成校验：大小、格式或 SHA-256 不一致时永不激活；重复完成幂等；成功时在最终二次鉴权后以状态 + token + lease 原子写状态和审计。
- 生命周期：job 与文档在同一事务认领且只有版本行 lease；瞬时错误/worker 崩溃重排队；从未认领的 queued 超过截止时间后由独立 reaper 终结；reaper 与 cleanup 分工明确；finalizer 与 cleanup 只能一方取得 claim；不会生成 active 空对象；新版本不覆盖旧版本；作废保留对象；cleanup 只能接触已转换为 cleanup_pending 的对象，不能直接接触 queued/finalizing/active/void。
- 资源限额：员工/项目并发、小时速率、24 小时字节数、项目容量和全局队列分别在临界值内成功、超限失败；管理员调整有完整审计。
- 解析器：zip bomb、嵌套归档、畸形 ZIP/OLE/HEIC、截断文件、超时、内存越界与 fuzz 回归样本全部失败关闭且不拖垮 worker。
- 审计：普通角色不能直接插入，任何应用角色都不能 UPDATE/DELETE；安全函数固定 search_path，事件中没有链接、token 或原始敏感错误。
- 档案：项目删除后新的普通访问全部失败；删除前链接最多保留 5 分钟；只有 `SW-000` 可取得新的只读档案链接且不能写。
- 前端：敏感分组不渲染；批量上传互不影响；最多三个并发传输；queued/finalizing 退避轮询；上传票据、TUS URL、临时链接和上传状态不写本地持久缓存。
- 备份：一致性 cutoff 同时包含逻辑父表与版本表；独立 archive schema；外部 `COMPLETED.json` KMS 验签；完整 run 清单、增量对象复用、独立凭据、删除保护、幂等、完整盘点、损坏对象校验失败、运行中任务安全终结和隔离恢复一致。
- 回归：项目、合同收入和账号权限现有测试保持通过。

### 13.2 本地人工验收

至少使用以下身份验证：

- `SW-000` 系统管理员；
- 设计部员工；
- 财务部员工；
- 社长；
- 有项目查看/更新权限的普通员工；
- 只有查看权限的普通员工；
- 停用或离职账号。

每种允许类型至少上传一个小文件；另用一个大于 6 MiB 的文件验证 TUS 中断与继续，用超过 50 MiB、伪造扩展名和错误 MIME 文件验证拒绝。用 50 MiB 最坏格式样本验证 worker 资源余量。软删除测试项目后，确认普通账号不能申请新链接、删除前链接在 5 分钟窗口后失效，`SW-000` 可从档案预览和下载但不能更改。

完成声明必须附上新鲜证据：数据库迁移和 pgTAP、目标版本 Storage 标准/TUS HTTP 门禁、worker 资源/恶意样本、全部自动测试、构建、浏览器角色矩阵，以及备份脚本 dry-run/隔离目标 marker 与恢复校验结果。任何未执行项都必须单独报告。

## 14. 非目标

- 不把增减项单据关联到合同增减记录。
- 不从项目文件自动识别金额或回写合同收入。
- 不提供永久公开链接或匿名分享。
- 不把文件本体、元数据或临时链接写入浏览器持久缓存。
- 不支持硬删除 active/void 文件。
- 不实现第三方在线 Office 预览、图片有损转码或病毒扫描平台。
- 不在本次本地开发中直接变更生产 Supabase 或生产备份目标。

## 15. 已确认决策摘要

- 存储方案：私有 Supabase Storage + 独立文档版本元数据表。
- 增减项单据：项目级普通文件，不与具体增减记录关联。
- 效果图：所有具备项目查看权限的活跃员工可见。
- 项目合同和增减项单据：仅设计部、财务部、社长、`SW-000` 可见。
- 上传、新版本、作废：在上述可见规则之外还要求项目更新权限。
- 删除项目：文件继续保留，普通用户不可见，仅 `SW-000` 可访问只读档案。
- 保存保障：应用内不物理删除历史文件，并建立独立加密备份和可验证恢复流程。
- 工作方式：先在当前本地运行项目中实现并完整测试，生产变更另行确认。
