# 📑 AI Chat TOC - 对话目录导航

一个 Chrome 浏览器扩展，为 AI 聊天页面（ChatGPT、Claude、Gemini）生成侧边栏目录，快速跳转到任意问答。

## 功能

- ✅ 自动提取对话中的用户提问，生成可点击的目录
- ✅ 点击目录项平滑滚动到对应消息
- ✅ 实时监听新消息，目录自动更新（支持流式输出）
- ✅ 目录内搜索对话内容
- ✅ 鼠标悬停高亮对应消息
- ✅ 深色/浅色模式自适应
- ✅ 支持收起/展开侧边栏
- ✅ SPA 路由切换自动刷新目录

## 支持平台

| 平台 | 域名 | 状态 |
|------|------|------|
| ChatGPT | chatgpt.com / chat.openai.com | ✅ |
| Claude | claude.ai | ✅ |
| Gemini | gemini.google.com | ✅ |

## 安装方式（开发者模式）

1. 下载或 clone 本项目到本地
2. 打开 Chrome，访问 `chrome://extensions/`
3. 右上角打开「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本项目文件夹（包含 `manifest.json` 的目录）
6. 打开任意支持的 AI 聊天页面，侧边栏会自动出现

## 项目结构

```
ai-chat-toc/
├── manifest.json      # 扩展配置文件 (Manifest V3)
├── content.js         # 核心逻辑：DOM 解析、目录生成、事件监听
├── content.css        # 侧边栏样式（含深色模式适配）
├── popup.html         # 点击扩展图标的弹出面板
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 开发指南

### 核心架构

项目采用「平台适配器」模式，每个 AI 平台有独立的适配器对象定义在 `content.js` 的 `platformAdapters` 中。要新增平台支持，只需添加一个新的适配器：

```js
newPlatform: {
  name: '平台名称',
  hostMatch: /域名正则/,
  getUserMessages: () => { /* 返回用户消息元素列表 */ },
  getMessageText: (el) => { /* 从元素中提取文本 */ },
  getChatContainer: () => { /* 返回聊天容器元素 */ },
}
```

### 调试技巧

- 在 AI 聊天页面按 F12，Console 中搜索 `[AI Chat TOC]` 查看日志
- 各平台 DOM 结构会随版本更新而变化，如果目录不显示，先检查选择器是否失效

## 后续计划

- [ ] 对话导出为 Markdown / PDF
- [ ] 对话收藏与标签分类
- [ ] 键盘快捷键支持
- [ ] AI 自动摘要
- [ ] 支持更多平台 (Poe, Perplexity, DeepSeek 等)
- [ ] 发布到 Chrome Web Store

## License

MIT
