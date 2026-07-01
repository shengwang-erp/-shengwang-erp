# 生旺 ERP 数据中心

企业微信工作台使用的 ERP H5 测试首页，基于 React + Vite，可部署到 Vercel。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 上传 GitHub

```bash
git add .
git commit -m "Create ERP H5 homepage"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

如果已经添加过远程仓库，跳过 `git remote add origin ...`。

## 部署到 Vercel

1. 打开 https://vercel.com 并登录。
2. 点击 `Add New...`，选择 `Project`。
3. 选择刚上传到 GitHub 的仓库。
4. Framework Preset 选择 `Vite`。
5. Build Command 使用 `npm run build`。
6. Output Directory 使用 `dist`。
7. 点击 `Deploy`。

部署完成后，Vercel 会生成一个 `https://项目名.vercel.app` 地址，可放入企业微信工作台。
