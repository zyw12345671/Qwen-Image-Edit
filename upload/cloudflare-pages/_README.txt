Cloudflare Pages 上传说明（已更新）

请优先上传 `dist/` 目录，不要再使用本目录中的旧静态文件。

原因：
- 本目录可能滞留历史打包文件名（如旧版 `assets/index-*.js`）
- 上传旧文件会导致前端逻辑未更新，仍可能直连 workers.dev，出现超时

正确流程：
1) 本地执行：npm run build
2) 确认 dist 内包含：
   - index.html
   - assets/index-*.js
   - assets/index-*.css
   - _redirects
3) 将 dist 目录内容完整上传到 Cloudflare Pages

部署后必查：
- 访问 https://991qwen-image-edit.pages.dev/_redirects 应能看到重写规则
- 页面“网络诊断”里，Pages 同源 API 应可达
