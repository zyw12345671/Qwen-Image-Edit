# Cloudflare Workers 代理部署指南

## 问题原因

浏览器直接调用 `ai.gitee.com` API 进行图生图时存在 **CORS（跨域）限制**，因为：
- 需要上传图片（`multipart/form-data` 格式）
- 目标服务器（ai.gitee.com）没有配置 CORS 头

## 解决方案

创建 Cloudflare Workers 代理来绕过 CORS 限制。

## 部署步骤

### 1. 部署 Worker 代理

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers** → **创建新应用**
3. 点击 **创建 Worker**
4. 将 `worker.js` 的内容粘贴到编辑器中
5. 点击 **部署**

### 2. 获取 Worker URL

部署后会得到一个类似这样的 URL：
```
https://your-worker-name.your-username.workers.dev
```

### 3. 修改 index-v2.html

在 `index-v2.html` 中找到这行：
```javascript
const response = await fetch('https://ai.gitee.com/v1/images/generations', {
```

替换为：
```javascript
const response = await fetch('https://你的-worker-url/v1/images/generations', {
```

**注意**：将 `https://你的-worker-url` 替换为你实际的 Worker URL。

### 4. 部署 index-v2.html

将修改后的 `index-v2.html` 部署到：
- Cloudflare Pages
- Netlify
- 腾讯云轻量服务器

---

## 备选方案

如果不想使用 Worker 代理，可以使用 `deploy` 文件夹部署到腾讯云轻量服务器（需要 Node.js 后端）。

---

## 常见问题

**Q: Worker 代理安全吗？**
A: 是的，API Key 仍然由用户在前端输入，只通过代理转发请求，不会保存到服务器。

**Q: 可以使用其他代理服务吗？**
A: 可以使用类似的服务如：
- cors-anywhere (需要申请)
- 自己的服务器
