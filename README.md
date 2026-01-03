# GPT Session Switcher

一个轻量、高效的 Chrome 扩展，用于在多个 [ChatGPT](https://chatgpt.com) 账号之间无缝切换。基于 **Manifest V3** 和原生 JavaScript 构建，拥有现代化的 UI 设计。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Manifest](https://img.shields.io/badge/Manifest-V3-green)
![Chrome](https://img.shields.io/badge/Chrome-Extension-orange)

## ✨ 功能特性

* **⚡ 一键切换**: 无需手动退出再登录，点击即可瞬间切换账号。
* **🏷️ 套餐徽章**: 在账号卡片上显示可视化套餐标识（Pro/Plus/Team/Free）。
* **🔄 快速同步**: 工具栏一键更新当前账号的用户名和套餐信息。
* **📥 智能自动获取**: 
    * 自动从当前标签页抓取 `session-token`。
    * 智能提取用户名和套餐信息。
* **🎨 现代化 UI**: 采用卡片式设计，支持**深色模式**。
* **🖱️ 拖拽排序**: 长按并拖动即可调整账号列表顺序。
* **💾 导入与导出**: 支持将账号列表备份为 JSON 文件。
* **🔒 安全本地化**: 所有数据仅存储在浏览器本地，绝不上传至任何远程服务器。

## 📦 安装指南

1. 下载最新 [Release](https://github.com/kieranchan/GPT-switcher/releases)
2. 解压 ZIP 文件
3. 打开 Chrome 浏览器，访问 `chrome://extensions/`
4. 打开右上角的 **开发者模式**
5. 点击 **加载已解压的扩展程序**，选择解压后的文件夹

## 📖 使用说明

### 1. 添加账号
1. 确保已登录 ChatGPT
2. 点击扩展图标，点击 **+** 按钮
3. 点击 **📥** 按钮自动抓取账号信息
4. 点击 **保存**

### 2. 切换账号
* 点击列表中的任意账号卡片即可切换
* 如果没有 ChatGPT 页面打开，会自动创建新标签页

## ⚠️ 安全声明

* **仅限本地**: 您的数据永远不会离开您的浏览器
* **权限说明**: 
    * `cookies`: 用于修改 Cookie 实现账号切换
    * `scripting`: 用于从页面 DOM 中读取用户名
    * `storage`: 用于保存账号列表

## 📄 许可证

本项目基于 MIT 许可证开源
