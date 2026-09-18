# 密码策略与恢复记录

记录日期：2026-09-18  
Supabase 项目：`maafjofyetjvnjxtoxrb`

## 修改前生产配置

通过 Supabase Management API 只读获取并保存完整配置到本机受限文件：

- 本机备份：`/private/tmp/shengwang-auth-config-before-password-6-digit.json`
- 文件权限：仅当前用户可读写
- `password_min_length`：`6`
- `password_required_characters`：`null`
- `password_hibp_enabled`：`false`
- `security_update_password_require_reauthentication`：`false`

本次无需修改生产 Auth 配置，也不需要数据库迁移。

## 应用规则

- 正常登录继续接受现有旧密码，不限制为数字。
- 新设密码仅接受恰好六位 ASCII 数字，按字符串处理。
- 新建员工和管理员重置生成的临时密码同样为六位数字。
- 密码仍只写入 Supabase Auth，不写入业务表、日志或浏览器存储。
- 登录失败限制继续由数据库按员工编号和请求来源原子执行：15 分钟内五次失败后锁定约 15 分钟，成功登录清除同来源锁定。

## 恢复

代码回退到标签 `backup/password-flow-20260918-6c19a2d` 即可恢复旧的十二位复杂新密码校验和临时密码生成方式。

生产 Auth 配置在修改前就是最短六位且无字符种类要求，因此本次没有配置变更需要反向恢复。
