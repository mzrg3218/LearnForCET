# LEARNforCET 部署指南（上传到 Cloudflare，免费）

**准备**：一个 Cloudflare 账号（[dash.cloudflare.com](https://dash.cloudflare.com) 免费注册）+ 装了 Node.js 的电脑。

在本文件夹打开终端（PowerShell 或 cmd 都行），按顺序执行 6 步：

## 1. 安装 Cloudflare 官方命令行工具

```bash
npm install -g wrangler
```

## 2. 登录（会自动弹浏览器授权）

```bash
wrangler login
```

## 3. 创建数据库

```bash
wrangler d1 create learnforcet
```

命令会输出一个 `database_id`（一串字母数字），**复制它**。

## 4. 填写配置

用记事本打开 `wrangler.toml`，把这一行的占位符：

```
database_id = "TODO_FILL_AFTER_wrangler_d1_create"
```

替换成你刚复制的 id，保存。

## 5. 远端建表（只需做一次）

```bash
wrangler d1 execute DB --remote --file=migrations/0001_init.sql
```

## 6. 部署！

```bash
wrangler deploy
```

完成后终端会输出 `https://learnforcet.xxx.workers.dev` —— 这就是你的网站，**任何人在任何设备**打开这个网址都能注册账户、加好友、聊天、背单词。

---

## 想先在本地试试？

```bash
npx wrangler d1 execute DB --local --file=migrations/0001_init.sql   # 首次建表
npx wrangler dev --port 8787                                          # 访问 http://localhost:8787
```

## 常见问题

| 问题 | 解决 |
|------|------|
| 提示未登录 / 授权过期 | 重新执行 `wrangler login` |
| 想换网站名 | 改 `wrangler.toml` 第一行 `name = "..."`，重新 `wrangler deploy`（网址前缀跟着变） |
| 更新了代码 | 再跑一次 `wrangler deploy` 即可，数据不受影响 |
| 忘记 database_id | `wrangler d1 list` 查看 |
| 免费额度够吗 | 个人/班级规模完全够：Workers 每天 10 万次请求、D1 每天 500 万次读取 |
