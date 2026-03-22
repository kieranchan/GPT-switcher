# v3.0.1 Session Token 兼容性修复

## 下载方式

- 在下方 Assets 中下载 `gpt-session-switcher-v3.0.1.zip`
- 将压缩包解压到本地文件夹

## 使用方法

1. 打开 Chrome，进入 `chrome://extensions/`
2. 打开右上角 `开发者模式`
3. 点击 `加载已解压的扩展程序`
4. 选择解压后的扩展目录
5. 打开 ChatGPT，点击扩展图标
6. 可直接导入账号 JSON，或在弹窗中点击账号进行切换

## Cookie 切换修复

- 修复部分账号卡片点击后看似无响应的问题
- 切换逻辑改为兼容 Auth.js 的 `__Secure-next-auth.session-token` 分片写入规则
- 同步补齐分片 Cookie 的读取、排序与清理逻辑

## Team / Personal 空间修复

- 修复首次切换到 Team / Personal workspace 时可能掉回登录态的问题
- 普通 token 继续使用单段 Cookie，较长 token 自动走兼容分片
- 改善切换失败时的错误处理与回退表现

## 导入与验证

- 兼容最新批次产物中的超长 token
- 更新本地浏览器 mock，覆盖多段 session cookie 场景
- 已在真实 ChatGPT 页面完成回归验证，覆盖 Team token 与超长 token

---

**完整变更日志**: https://github.com/kieranchan/GPT-switcher/compare/v3.0.0...v3.0.1
