# 生旺 ERP 数据中心

React + Vite 构建的独立网页版 ERP，第一阶段目标是部署到 Vercel，让手机和电脑都可以通过 HTTPS 地址访问。当前版本暂时不强依赖企业微信，企业微信只作为后续入口和身份登录能力。

## 阶段路线

1. 独立网页版 ERP：部署到 Vercel，保留所有业务模块。
2. 云端数据库：业务数据保存到 Supabase，多设备、多人员共用同一套数据。
3. 账号密码登录：用员工账号密码识别身份并启用权限控制。
4. 公司内部试用：老板、会计、仓库、现场负责人测试真实业务。
5. 企业微信入口：把 Vercel 网址放入企业微信工作台。
6. 企业微信身份登录：后端用企业微信 code 换 userId，再匹配员工档案。

## 当前业务模块

- 工程项目
- 人员管理
- 人工记录
- 采购管理
- 仓库库存
- 材料出入库
- 工具管理
- 车辆管理
- 会计成本
- 老板驾驶舱

老板驾驶舱在首页业务模块最后一个显示。

## 当前数据存储

当前版本已接入 Supabase 云端数据库。配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 后，业务数据会优先从 Supabase 读取和保存；localStorage 只作为本机缓存、登录状态和迁移前的临时数据来源。

当前业务数据键：

- `erp.projects`
- `erp.employees`
- `erp.laborRecords`
- `erp.purchaseRecords`
- `erp.purchasePaymentRecords`
- `erp.inventoryItems`
- `erp.stockInRecords`
- `erp.stockOutRecords`
- `erp.stockReturnRecords`
- `erp.toolRecords`
- `erp.toolBorrowRecords`
- `erp.toolReturnRecords`
- `erp.lifelongToolAssignments`
- `erp.toolResponsibilityRecords`
- `erp.vehicleRecords`
- `erp.vehicleUsageRecords`
- `erp.fuelRecords`
- `erp.vehicleExpenseRecords`
- `erp.vehicleIssueRecords`
- `erp.salaryRecords`
- `erp.projectCostRecords`
- `erp.operatingExpenseRecords`

云端表结构见 [docs/supabase-schema.sql](./docs/supabase-schema.sql)。当前原型阶段采用“每个业务模块一张表 + payload JSONB + 审计字段”的方式，后续可以逐步拆成完整关系型字段。

## 测试阶段登录

当前版本已经加入测试阶段登录/注册：

- 系统内置一个隐藏恢复账号，用于权限异常时恢复系统访问。
- 隐藏恢复账号不显示在人员管理普通列表和老板驾驶舱人员统计中。
- 员工可用真实姓名 + 6 位数字密码自助注册。
- 自助注册员工会自动写入人员管理，但默认没有业务模块权限。
- 自助注册即使选择老板或操作员职位，也不会自动获得最高权限。
- 最高权限必须由已授权管理员在人员管理中手动设置。

安全说明：

1. 真实姓名 + 6 位数字密码只是测试阶段方案。
2. 当前 `passwordHash` 仍可能是明文，不适合正式上线。
3. 正式上线必须接 Supabase Auth 或企业微信身份登录。
4. 正式密码必须加密保存，不能明文保存。
5. localStorage 不能作为正式账号密码数据库。
6. 企业微信登录以后应使用 `wecomUserId` 绑定员工身份。
7. 系统内置一个隐藏恢复账号，用于权限异常时恢复系统访问。正式上线前必须迁移为安全后端管理方式。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## GitHub 网页上传

如果不用终端，可以在 GitHub 空仓库页面点击 `uploading an existing file`，把项目根目录里的文件拖进去：

- `package.json`
- `package-lock.json`
- `index.html`
- `vite.config.js`
- `.gitignore`
- `README.md`
- `.env.example`
- `src/`
- `public/`
- `docs/`

提交说明可写：

```text
Initial ERP web project
```

## GitHub 终端上传

```bash
cd /Users/yu/Documents/ERP
git init
git add .
git commit -m "Initial ERP web project"
git branch -M main
git remote add origin https://github.com/shengwang-erp/-shengwang-erp.git
git push -u origin main
```

如果远程仓库已存在：

```bash
git remote set-url origin https://github.com/shengwang-erp/-shengwang-erp.git
git push -u origin main
```

## Vercel 部署

1. 打开 https://vercel.com 并登录。
2. 点击 `Add New...`，选择 `Project`。
3. 选择 GitHub 里的 ERP 仓库。
4. Framework Preset 选择 `Vite`。
5. Build Command 使用 `npm run build`。
6. Output Directory 使用 `dist`。
7. 点击 `Deploy`。

部署完成后会得到类似 `https://项目名.vercel.app` 的 HTTPS 地址。

## Supabase 云端数据库配置

不要把 key 写死在代码里。复制 `.env.example` 为 `.env.local`，再填写：

```bash
VITE_SUPABASE_URL=你的 Supabase Project URL
VITE_SUPABASE_ANON_KEY=你的 Supabase anon public key
```

在 Supabase 控制台执行建表：

1. 打开 Supabase 项目。
2. 进入 `SQL Editor`。
3. 复制 [docs/supabase-schema.sql](./docs/supabase-schema.sql) 全部内容。
4. 点击 `Run`。
5. 回到 ERP 的“系统设置”，使用“localStorage → Supabase 数据迁移”把当前浏览器测试数据上传到云端。

当前阶段是 ERP 原型云端版。正式上线前必须补充：

1. Supabase Row Level Security 精细策略。
2. 正式用户认证或 Supabase Auth。
3. 密码加密。
4. 后端权限校验。
5. 操作日志。
6. 数据备份。
7. 附件权限控制。
8. 企业微信身份登录。

企业微信 secret 不能放在前端，未来必须通过后端处理。
