# v3.0.1 Session Token Compatibility Fixes

## Cookie 切换修复

- 修复部分账号卡片点击后无响应的问题
- 改为兼容 Auth.js 的 `__Secure-next-auth.session-token` 分片写入规则
- 同步支持分片 Cookie 的读取、排序与清理

## Team / Personal 空间修复

- 修复 Team / Personal workspace 首次切换后掉回登录态的问题
- 保持普通 token 使用单段 Cookie，长 token 自动走兼容分片
- 改善切换失败时的错误处理与回退表现

## 导入与测试改进

- 兼容最新批次产物中的超长 token
- 更新本地浏览器 mock，覆盖多段 session cookie 场景
- 完成真实 ChatGPT 页面回归验证，覆盖 Team token 与超长 token

---

**完整变更日志**: https://github.com/kieranchan/GPT-switcher/compare/v3.0.0...v3.0.1
