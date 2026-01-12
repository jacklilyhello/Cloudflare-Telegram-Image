# Cloudflare Telegram Image

使用 Cloudflare Workers + Telegram Bot 的轻量图床：上传图片到 Telegram 频道，返回短链并通过 Worker 代理访问。

## 功能

- `POST /upload` 上传图片（multipart/form-data，字段名 `file`）
- `GET /i/:id` 访问图片（通过 Worker 代理 Telegram file API）
- 可选防盗链：通过 `ALLOWED_ORIGINS` 控制 Origin/Referer 白名单
- 默认 `sendPhoto`，支持 `sendDocument` 保留原图

## 前置准备

### 1) 获取 Telegram 频道 chat_id

可将 Bot 加入频道并发送一条消息，然后通过 `getUpdates` 或使用 @userinfobot 等方式查看频道的 `chat_id`（通常是 `-100` 开头）。

### 2) Bot 权限

确保 Bot 是频道管理员，否则无法发送消息/图片。

## 创建 KV

```bash
wrangler kv namespace create IMG_KV
```

将输出的 `id` 填入 `wrangler.toml` 的 `[[kv_namespaces]]` 中。

## 写入 Secret

```bash
wrangler secret put TG_BOT_TOKEN
```

## 配置变量

在 `wrangler.toml` 的 `[vars]` 中填写：

- `TG_CHAT_ID`：你的频道 chat_id
- `ALLOWED_ORIGINS`：逗号分隔的 Origin 白名单（留空表示不启用防盗链）

## 本地调试

```bash
npm install
npm run dev
```

## 部署

```bash
npm run deploy
```

## API 使用示例

### 上传图片（默认 sendPhoto）

```bash
curl -X POST "http://127.0.0.1:8787/upload" \
  -F "file=@/path/to/image.jpg"
```

### 上传图片（sendDocument，保留原图）

```bash
curl -X POST "http://127.0.0.1:8787/upload?document=1" \
  -F "file=@/path/to/image.png"
```

### 访问图片

```bash
curl "http://127.0.0.1:8787/i/<id>"
```

## 主页

默认使用 Worker 静态资源绑定读取 `public/index.html`。如需替换主页，请直接修改 `public/index.html`，或在 `wrangler.toml` 中调整 `assets` 配置。
