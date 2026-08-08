# Task 02 报告：采购到货改为仓库待确认

日期：2026-08-09

分支：`codex/warehouse-forward-port`

范围：第二版 ERP 的采购到货入口、采购权限、仓库待确认收货、采购剩余数量与回归保护。

## 结果

采购页面不再执行旧的“采购入库后立即写采购、入库记录和库存”流程。采购员现在只能选择采购记录、仓库物品明确型号和本次到货数量，并提交一张 `pending` 仓库收货单；提交时不能指定价格、操作人、最终仓库或货架。库存、批次、移动和项目成本均不会在此步骤变化，必须等待后续仓库负责人确认。

旧版 `purchaseService.commitStockIn` 兼容适配仍保留在服务层，避免扩大本任务迁移范围；第二版 `App.jsx` 已不存在该调用，也不存在旧的即时库存合并辅助函数。

## 数据库与并发边界

- 扩展尚未上线的本地 Phase 3 migration `202608080004_warehouse_workflows.sql`，未操作线上 Supabase。
- 待确认收货允许仓库和货架同时为空；已确认或确认后作废的完整行仍强制要求两者都有值。
- 采购单、提交人、提交时间、幂等键、原始提交载荷，以及行所属收货单、型号和申请数量均不可直接篡改。
- 幂等重试使用排序后的完整规范载荷比对；同键同内容可安全返回原收货单（`pending` / `confirmed` / `rejected` / `void`），同键不同内容稳定冲突。重试响应永远隐去成本。
- 采购数量、待确认数量、已确认数量和剩余数量全部由服务端权威计算；拒绝和确认前作废不占剩余数量。
- 提交与采购修改按同一采购行/资源锁顺序串行，防止并发超量；采购数量不能降到待确认加已确认数量以下。
- 任何历史仓库收货单（包括 rejected/void）存在时，采购记录不能删除；服务端是最终防线。
- 新增只读 RPC 提供启用中的精确型号选择器和采购到货汇总，不返回仓库价格。
- 提交权限为 `module.purchases.view` + `module.purchases.create` + `warehouse.receipt.submit`；上下文读取只需采购查看和收货提交；仓库确认权限保持独立。

## 前端失败关闭与交互

- 上下文 loading/error/forbidden 或采购汇总缺失时显示“状态暂不可用”，不再把未知状态伪装成“未入库”。
- 非 ready 和提交中会禁用采购、型号、数量和提交按钮。
- 首次网络失败不刷新、不显示成功、不清空表单，并保留同一幂等键；重试成功后才刷新并清空采购、型号和数量。
- 成功文案明确说明“等待仓库负责人确认；当前库存尚未增加”。
- 删除前端提示会参考服务端 `hasReceipt`，但即使页面数据过期，数据库仍会阻止删除。

## 独立复审后的加固

- 到货数量输入框增加 `min="0.001"` 和 `step="0.001"`，浏览器可正常接受例如 `2.125` 的小数数量。
- 采购页汇总不再使用旧 `stockInRecords` 判断入库状态，改为服务端权威到货上下文；新增“待仓库确认”数量，上下文失败或缺失时整个状态汇总失败关闭，不会显示误导性数字。
- 完全相同的请求在收货单已确认、已拒绝或已作废后仍可安全重试，不再触发唯一键错误。客户端仍必须绑定原始采购、型号和申请数量；`pending` 还严格绑定原仓位，终态则接受服务端确认后的权威仓库、货架和实收数量。
- 无论当前用户是否有查看成本权限，采购到货提交和幂等重试返回的 `unitCost` 都必须为 `null`；服务层对任何携带成本的响应失败关闭。

## TDD 与回归证据

红灯证据：

- bridge 模块缺失、到货请求不接受空仓位、采购权限组合不正确、App 仍调用旧即时入库流程。
- SQL 首轮缺少采购到货上下文 RPC，且待确认行不允许空仓位。
- 真实 React 交互测试在注入 bridge 前无法触达测试调用，证明生产组件尚未具备可验证的绑定边界。
- 到货上下文失败审查发现未知状态曾被显示成“未入库”，已先补失败测试再修复。

最终绿灯：

- warehouse pgTAP：`540/540`，失败 `0`：
  - catalog concurrency `11/11`
  - workflow concurrency `12/12`
  - foundation `144/144`
  - QR `22/22`
  - workflows `98/98`
  - catalog media `176/176`
  - permission catalog `32/32`
  - read service `45/45`
- purchase accrual pgTAP：`176/176`，失败 `0`。
- Task 02 最终采购桥接专项 Node/React：`74/74`，失败 `0`。
- 第二版 ERP 仓库的全量 Node：`1379/1379`，失败 `0`。
- 本轮可复现 SQL 合计：`716/716`（warehouse `540` + purchase accrual `176`），失败 `0`。
- `npm run build`：成功，`177` modules transformed。
- `git diff --check`：通过。
- App 污染扫描：旧 `purchaseService.commitStockIn` 调用、`commitPurchaseStockInMutation` 和 `mergeInventoryItem` 均为 `0`。

并发测试会提交自己的固定 fixture，因此与要求空表的基础套件分开 clean reset 运行。`purchase_records` 新增仓库收货外键后，旧 TRUNCATE 回归可能先被 PostgreSQL 外键以 `0A000` 拦截，而不是旧触发器的 `42501`；测试仅适配为接受这两种安全拦截，没有放宽生产权限或完整性。

## 隔离证明

- 使用本任务独立的本地临时工作目录，测试完成后已删除。
- Supabase project id：`warehouse-phase3-task2-red`
- API / DB / shadow ports：`62821 / 62822 / 62820`
- Docker DB label：`com.supabase.cli.project=warehouse-phase3-task2-red`
- Docker DB 映射：`0.0.0.0:62822->5432`
- 未使用默认 Supabase 端口，未连接、迁移、写入或部署线上环境。
- 首次启动发现默认 analytics 端口冲突；改用独立端口后成功，首次尝试未留下资源。
- 测试完成后已执行 `supabase stop --no-backup`；同 project label 的容器、volume、network 均为 `0`，并删除本任务隔离工作目录和 TAP 临时日志。
- 独立复审加固使用第二个隔离 project id `warehouse-phase3-task2-followup`，API / DB / shadow ports 为 `62921 / 62922 / 62920`；同样未连接线上环境，验收后停止并清理。

## 已知非阻断警告

Vite 生产构建仍提示主 JS chunk 大于 500 kB；这是现有工程的包体积警告，不影响本任务正确性。本任务未做代码分包，以避免扩展迁移范围。
