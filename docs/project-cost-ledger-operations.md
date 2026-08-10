# 统一项目成本明细账运维与恢复

统一项目成本明细账是会计成本中心的项目费用权威读取模型。它把项目绑定的业务事实、会计调整和项目拆分组合成同一份快照；采购、仓库、人工、车辆、工具、经营费用等原始业务记录始终保持不变。会计页面的调整只追加到账本事件表，绝不回写或覆盖来源单据。

## 权限与访问边界

- 查看明细、筛选、打印、PDF 和 Excel 需要有效在职账号及 `module.project_costs.view`。
- 新增手工项目费用需要 `module.project_costs.create`。
- 金额调整和项目拆分需要 `module.project_costs.update`。
- 浏览器不能直接读写 `project_cost_manual_entries`、`project_cost_adjustment_events` 或 `project_cost_allocation_events`；只允许调用已授权的 `SECURITY DEFINER` RPC。
- RPC 从服务端会话确定修改人和时间。客户端提交的人员名称、原金额、当前版本或时间不能替代服务端校验。
- 员工停用、权限撤销或登录失效后，旧账号尚未完成的响应不得重新填回页面。

## 来源识别与计入时点

项目绑定且有效的记录按业务日期立即计入，不等待付款、到货或发票：

- `purchase:`：直接绑定项目、且没有被权威仓库批次替代的采购；
- `warehouse:`：已确认项目出库、零散工单领料及对应退回/冲销；
- `labor:`：正式确认的项目人工分摊；
- `vehicle-fuel:`、`vehicle-expense:`、`vehicle-issue:`：项目燃油、车辆费用和维修/事故费用；
- `tool-responsibility:`：仅当 `allocateToProject` 明确为 `true` 且项目当前有效时计入；项目工具丢失按工具价值、损坏按维修费用计入，员工赔偿另行记录，不静默抵减项目毛成本；
- `operating:`：启用项目分摊并绑定项目的经营费用；
- `legacy-manual:`：历史有效手工项目成本；
- `manual:`：会计通过明细账新增的正数或负数费用。

已删除、已取消、已作废、不存在或非活动项目的显式绑定，以及金额/关键字段不合规的来源，
不作为正常零值处理，而以安全来源键进入 `incompleteSources`。工具记录缺少
`allocateToProject: true` 表示公司范围费用，会被完整排除且不列为不完整。已由仓库冻结批次
成本代表的采购，只计算仓库成本，不再重复计算采购总额。

## 调整与审计语义

- 金额调整是“有符号增量”，当前有效金额等于原始金额加全部有效调整；允许负数退款、折扣和冲销。
- 每次调整追加一条不可删除的审计事件，记录来源键、序号、调整前金额、调整值、调整后金额、原因、服务端修改人和服务端时间。
- 页面、打印/PDF 和 Excel 都显示“已调整”标记；完整原因、人员和时间进入审计明细。
- 修改后原始采购、仓库、人工、车辆、工具和经营费用记录不变。恢复业务来源应在原业务模块完成；会计更正应继续追加反向调整，不删除历史事件。

## 项目拆分规则

- 拆分可按金额或比例录入，提交时统一转换为四位小数的固定金额。
- 所有项目必须唯一且当前有效；拆分金额的有符号合计必须严格等于该来源当前有效金额。
- 比例模式只允许最后一行吸收安全舍入差异。
- 保存会追加拆分事件，保留拆分前后快照、原因、人员和时间；不会修改来源项目字段。
- 已有拆分历史的来源需要更正金额时，应新增独立的手工更正/冲销费用并按需拆分，不能让旧拆分快照与新金额不一致。
- 服务端对已有拆分历史的来源直接拒绝新增金额调整，返回 `PROJECT_COST_LEDGER_ALLOCATION_ACTIVE`；原始来源和既有审计保持不变。

## 版本冲突恢复

调整和拆分都携带当前 `version`。若另一名会计已先保存，服务端返回 `PROJECT_COST_LEDGER_VERSION_CONFLICT`，不会写入部分事件。

1. 保留页面中的金额、拆分草稿和原因。
2. 点击刷新，重新读取当前筛选条件下的完整账本和匹配审计。
3. 核对新金额、新拆分和最新审计后再次提交。
4. 若来源已取消或删除，按 `PROJECT_COST_LEDGER_SOURCE_MISSING` 处理，不以旧缓存继续保存。

## 不完整来源与恢复

`incompleteSources` 非空、分页不完整、页间汇总不一致、账本总额与逐行固定点合计不一致，或账本/审计版本不匹配时，报表状态必须保持不完整：

- 不把缺失来源显示成 `¥0`，也不回退到旧采购、仓库或本地缓存总额；
- 禁止打印、导出 PDF 和导出 Excel；
- 会计月度总成本保持“暂不可用”，但已独立确认的公司工资、采购付款现金流和公司级经营费用仍按各自来源展示；
- 使用页面“重试/刷新”重新取得同一账号、同一筛选条件的新快照。连续失败时记录安全错误码、发生时间和不可用来源，不记录敏感原始响应。

## 打印、PDF 与 Excel

- “打印”和“导出 PDF”使用同一份横向 A4 打印页。导出 PDF 时在系统打印窗口选择“另存为 PDF”。
- 打印主表按费用类别分组，重复表头，显示分类小计、项目总计和“已调整”标记；审计附页显示修改前后、原因、修改人和修改时间。
- Excel 只包含 `项目成本明细`、`分类汇总`、`调整记录` 三张工作表。表头冻结、筛选开启，金额采用四位小数日元格式，分类小计和项目总计同时保留公式及校验值。
- 页面、打印/PDF 和 Excel 必须消费同一个已应用、完整且审计匹配的不可变快照；未点击“应用”的筛选条件不能改变报表标题或数值。
- 每次导出只调用一次 `export_project_cost_report_secure`，由数据库在同一语句快照内返回完整账本、匹配审计、同一 `generatedAt` 和 SHA-256 `snapshotToken`；禁止浏览器跨页拼接。
- 单次原子报表最多 5000 行账本和 20000 条审计事件；超过上限返回 `PROJECT_COST_LEDGER_REPORT_TOO_LARGE`，应缩小项目或日期范围后重试。

## 隔离本地验证

不得把测试命令指向已链接、共享或生产 Supabase 项目。每次数据库验证创建独立临时工作目录：

```bash
LEDGER_DB_WORKDIR="$(mktemp -d /private/tmp/kaobeierp-project-cost-ledger.XXXXXX)"
rsync -a supabase/ "$LEDGER_DB_WORKDIR/supabase/"
npx supabase start --exclude analytics,edge-runtime,functions,imgproxy,inbucket,kong,meta,realtime,rest,storage,studio,vector --workdir "$LEDGER_DB_WORKDIR"
npx supabase db reset --local --workdir "$LEDGER_DB_WORKDIR"
npx supabase test db "$LEDGER_DB_WORKDIR/supabase/tests/project_cost_ledger.sql" --local --workdir "$LEDGER_DB_WORKDIR"
node supabase/tests/project_cost_ledger_concurrency.mjs --workdir "$LEDGER_DB_WORKDIR"
```

应用回归命令：

```bash
node --test src/features/project-cost-ledger/*.test.js src/features/cost-accounting/*.test.js
npm test
npm run build
npm run verify:local-demo-security
git diff --check
```

验收时至少核对：正负手工费用、自动仓库费用调整、跨两个项目拆分、审计展开、20/50/100 分页、Excel 三工作表、横向 A4 打印及 PDF 入口；所有金额应与页面固定点合计完全一致。
