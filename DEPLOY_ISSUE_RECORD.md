# 部署问题复盘记录（Qwen-Image-Edit）

## 现象
- Cloudflare Pages 前端可打开，但生成图片失败。
- 常见报错：
  - `405 Method Not Allowed`（`/api/edit-image`）
  - `ERR_CONNECTION_TIMED_OUT / ERR_CONNECTION_CLOSED`（`workers.dev`）
  - `Too many subrequests`
  - `任务处理中超时（最后状态：failure）`

## 根因
1. 纯静态 Pages 部署时，`/api/edit-image` 未正确命中后端（出现 405）。
2. 部分网络到 `workers.dev` 不稳定，直连超时。
3. Pages Functions 中长轮询会触发子请求限制（`Too many subrequests`）。
4. 上游接口请求体字段不兼容（前端传 `images`，上游需要 `image` + `task_types`），导致任务 `failure` 且错误信息泛化。

## 最终稳定方案
1. 使用 **Cloudflare Pages + Functions（Git 自动部署）**。
2. `functions/api/edit-image.js`：
   - 接收前端 `images`
   - 转换为上游 `image`
   - 补齐 `task_types`（id/style/composition）
   - 仅负责“提交任务并返回 `task_id`”（202）
3. `functions/api/task-status.js`：
   - 同域轮询任务状态
   - 兼容不同状态字段命名
4. 前端轮询 `/api/task-status`，并在失败时展示上游原始错误详情。

## 经验结论
- 遇到 `405` 先判断 API 是否真的被函数接管，不能只看页面是否可访问。
- 遇到 `Too many subrequests`，不要在单个函数里长轮询，应改成“提交任务 + 前端短轮询状态”。
- 遇到 `failure + unexpected error`，优先检查请求体字段兼容性（文件字段名、task_types 等）。
