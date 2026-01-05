# v2.0.0 安全加固 + 模块化重构

## 🔒 安全修复

- XSS 防护：添加 `sanitize()` 函数，转义所有用户输入
- CSP 配置：限制脚本来源为 `'self'`
- 导入验证：`validateAccount()` 检查导入数据
- 移除全局变量：11 处 `window.*` 替换为模块私有变量

## ⚡ 性能优化

- O(1) 查找：`createAccountMap/TagMap` 替代数组遍历
- 记忆化：`memoize()` 缓存计算结果
- 错误边界：`trySafe()` 包装器防止崩溃
- 浅拷贝修复：使用 `map()` 模式避免直接修改

## 🧩 模块化重构

```
popup/
├── constants.js   # URL、存储键、图标
├── store.js       # 状态管理、工具函数
├── components.js  # AccountCard、App
└── main.js        # 入口、业务逻辑
```

## 🧹 代码清理

- 删除冗余 `background.js`
- 删除旧 `popup.js` 单文件

---

**完整变更日志**: https://github.com/kieranchan/GPT-switcher/compare/v1.0.0...v2.0.0
