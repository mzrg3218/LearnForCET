// Cloudflare Pages Functions 入口：接管 /api/* 全部请求
// 与 worker/index.js 共用同一份后端代码（也兼容 wrangler deploy 的 Workers 部署）
import worker from '../../worker/index.js';

export const onRequest = (ctx) => worker.fetch(ctx.request, ctx.env);
