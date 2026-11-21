import { z } from 'zod';
import { join } from 'node:path';
import { loadConfig } from '../../config.js';

const id = z.string().regex(/^[1-9]\d{0,39}$/);
const schema = z.object({
  FB_PAGE_ID: id, FB_PAGE_ACCESS_TOKEN: z.string().min(1), FB_APP_SECRET: z.string().min(1),
  FB_VERIFY_TOKEN: z.string().min(1), GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v27.0'),
  ADMIN_PSIDS: z.string().default('').transform(s => s.split(',').map(p => p.trim()).filter(Boolean)).pipe(z.array(id)),
  PUBLIC_BASE_URL: z.url().regex(/^https:\/\//), PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});
export function messengerConfig(env: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error('Thiếu hoặc sai cấu hình Messenger: ' + parsed.error.issues.map(e => e.path.join('.')).join(', '));
  return parsed.data;
}
export type MessengerConfig = ReturnType<typeof messengerConfig>;
export function pageBrainConfig(env: NodeJS.ProcessEnv, page: MessengerConfig) {
  const cfg = loadConfig(env, 'messenger');
  return {...cfg, adminIds: new Set(page.ADMIN_PSIDS), dmPolicy: 'open' as const,
    dataDir: join(cfg.dataDir, 'messenger', page.FB_PAGE_ID)};
}
