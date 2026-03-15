# v3.0.0 Team Workspace Support + Release Polish

## Team 账号适配

- 支持从 ChatGPT Team 页面读取结构化会话数据
- 自动识别 `Team` 套餐、`userId`、`accountId`、`organizationId`
- 兼容 workspace 场景下的显示名称和工作区名称
- 优化双份 `__Secure-next-auth.session-token` Cookie 的读取与清理逻辑

## 导入导出升级

- 导出改为使用浏览器正式下载流程，并弹出“另存为”
- 导出文件名改为本地日期格式，避免时区导致日期错乱
- 导入支持保留 Team 元数据
- 兼容 `{ "accounts": [...] }` 包装格式和旧版键值格式

## 切换体验修复

- 修复切换账号时 ChatGPT 页面加载会让 popup 看起来全空的问题
- 启动时改为先渲染界面，再后台同步当前账号信息
- 搜索支持 workspace、账号 ID、组织 ID 等字段

## 兼容性与稳定性

- 增加 `downloads` 权限以支持可靠导出
- 保留现有标签、排序和筛选逻辑
- 为本地回归测试补充浏览器 mock 入口

---

**完整变更日志**: https://github.com/kieranchan/GPT-switcher/compare/v2.0.0...v3.0.0
