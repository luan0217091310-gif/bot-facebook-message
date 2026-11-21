// Cập nhật Callback URL webhook của app Meta theo PUBLIC_BASE_URL trong .env, rồi đăng ký lại Page vào app.
// Dùng sau mỗi lần URL tunnel thay đổi:  npx tsx scripts/update-webhook.ts
import 'dotenv/config';
import { createHmac } from 'node:crypto';

const e = process.env;
const need = ['FB_APP_ID', 'FB_APP_SECRET', 'FB_VERIFY_TOKEN', 'PUBLIC_BASE_URL', 'FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN'] as const;
const missing = need.filter((k) => !e[k]?.trim());
if (missing.length) { console.error('Thiếu trong .env: ' + missing.join(', ')); process.exit(1); }
const v = e.GRAPH_API_VERSION || 'v27.0';
const graph = `https://graph.facebook.com/${v}/`;
const fields = 'messages,messaging_postbacks,messaging_optins,message_reactions,message_reads,message_deliveries';

async function call(path: string, params: Record<string, string>) {
  const r = await fetch(graph + path, { method: 'POST', body: new URLSearchParams(params) });
  const j = await r.json() as { success?: boolean; error?: { message: string } };
  if (!r.ok || j.error) throw new Error(path + ': ' + (j.error?.message ?? r.status));
  return j;
}

// Token ứng dụng (app_id|app_secret) dùng để sửa cấu hình webhook của app.
await call(`${e.FB_APP_ID}/subscriptions`, {
  object: 'page', callback_url: `${e.PUBLIC_BASE_URL}/webhooks/messenger`, verify_token: e.FB_VERIFY_TOKEN!,
  fields, include_values: 'true', access_token: `${e.FB_APP_ID}|${e.FB_APP_SECRET}`,
});
console.log('✔ Đã cập nhật Callback URL: ' + e.PUBLIC_BASE_URL + '/webhooks/messenger');
const proof = createHmac('sha256', e.FB_APP_SECRET!).update(e.FB_PAGE_ACCESS_TOKEN!).digest('hex');
await call(`${e.FB_PAGE_ID}/subscribed_apps`, { subscribed_fields: fields, access_token: e.FB_PAGE_ACCESS_TOKEN!, appsecret_proof: proof });
console.log('✔ Đã đăng ký Page nhận tin nhắn.');
