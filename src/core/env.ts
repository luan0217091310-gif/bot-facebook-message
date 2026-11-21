import { z } from 'zod';

/** Mô tả tiếng Việt cho từng biến để thông báo lỗi dễ hiểu với người mới. */
const HINT: Record<string, string> = {
  ENABLED_CHANNELS: 'danh sách kênh, ví dụ "telegram,messenger"',
  AI_API_KEY: 'API key của OpenAI/Gemini (bắt buộc)',
  AI_BASE_URL: 'URL http(s) của endpoint tương thích OpenAI',
  TELEGRAM_BOT_TOKEN: 'token lấy từ @BotFather',
  TELEGRAM_BOT_USERNAME: 'username của bot, không có @',
  ADMIN_TELEGRAM_IDS: 'ID số Telegram của admin, cách nhau bởi dấu phẩy',
  FB_PAGE_ID: 'ID số của Facebook Page',
  FB_PAGE_ACCESS_TOKEN: 'Page Access Token lấy trong Meta for Developers',
  FB_APP_SECRET: 'App Secret trong Cài đặt > Cơ bản của app Meta',
  FB_VERIFY_TOKEN: 'chuỗi bí mật tự đặt, phải trùng với ô Verify Token khi khai báo webhook',
  GRAPH_API_VERSION: 'dạng v27.0',
  ADMIN_PSIDS: 'PSID số của admin trên Messenger (gõ /id cho bot để xem)',
  PUBLIC_BASE_URL: 'URL HTTPS công khai, ví dụ https://bot.example.com',
  PORT: 'số cổng 1–65535',
  STORAGE: '"sqlite" hoặc "file"',
  DASHBOARD_PASSWORD: 'mật khẩu đăng nhập dashboard, ít nhất 12 ký tự',
  LOG_LEVEL: 'một trong trace, debug, info, warn, error',
};

const nonEmpty = z.string().trim().min(1);
const numericList = z.string().trim().regex(/^\d+(\s*,\s*\d+)*$/);
const opt = <T extends z.ZodType>(t: T) => z.preprocess((v) => (typeof v === 'string' && !v.trim() ? undefined : v), t.optional());

const schema = z.object({
  ENABLED_CHANNELS: opt(z.string().regex(/^\s*(telegram|messenger)(\s*,\s*(telegram|messenger))*\s*$/)).default('telegram'),
  AI_API_KEY: nonEmpty,
  AI_BASE_URL: opt(z.url()),
  STORAGE: opt(z.enum(['sqlite', 'file'])),
  LOG_LEVEL: opt(z.enum(['trace', 'debug', 'info', 'warn', 'error'])),
  DASHBOARD_PASSWORD: opt(z.string().min(12)),
  PORT: opt(z.coerce.number().int().min(1).max(65535)),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  ADMIN_TELEGRAM_IDS: z.string().optional(),
  FB_PAGE_ID: z.string().optional(),
  FB_PAGE_ACCESS_TOKEN: z.string().optional(),
  FB_APP_SECRET: z.string().optional(),
  FB_VERIFY_TOKEN: z.string().optional(),
  GRAPH_API_VERSION: opt(z.string().regex(/^v\d+\.\d+$/)),
  ADMIN_PSIDS: z.string().optional(),
  PUBLIC_BASE_URL: z.string().optional(),
}).superRefine((env, ctx) => {
  const channels = env.ENABLED_CHANNELS.split(',').map((s) => s.trim());
  const need = (key: keyof typeof env, ok: (v: string) => boolean) => {
    const v = (env[key] as string | undefined)?.trim() ?? '';
    if (!v || !ok(v)) ctx.addIssue({ code: 'custom', path: [key], message: v ? 'sai định dạng' : 'chưa khai báo' });
  };
  if (channels.includes('telegram')) {
    need('TELEGRAM_BOT_TOKEN', (v) => /^\d+:[\w-]{20,}$/.test(v));
    need('TELEGRAM_BOT_USERNAME', (v) => /^@?\w+$/.test(v));
    need('ADMIN_TELEGRAM_IDS', (v) => numericList.safeParse(v).success);
  }
  if (channels.includes('messenger')) {
    need('FB_PAGE_ID', (v) => /^\d+$/.test(v));
    need('FB_PAGE_ACCESS_TOKEN', () => true);
    need('FB_APP_SECRET', () => true);
    need('FB_VERIFY_TOKEN', (v) => v.length >= 8);
    need('PUBLIC_BASE_URL', (v) => /^https:\/\/[^\s]+$/.test(v));
    if (env.ADMIN_PSIDS?.trim() && !numericList.safeParse(env.ADMIN_PSIDS).success)
      ctx.addIssue({ code: 'custom', path: ['ADMIN_PSIDS'], message: 'sai định dạng' });
  }
});

/** Kiểm tra .env khi khởi động. Ném lỗi gộp mọi vấn đề, viết bằng tiếng Việt. Không in giá trị bí mật. */
export function validateEnv(env: NodeJS.ProcessEnv): void {
  const r = schema.safeParse(env);
  if (r.success) return;
  const lines = r.error.issues.map((i) => {
    const key = String(i.path[0] ?? '?');
    const why = i.message === 'chưa khai báo' || i.message === 'sai định dạng' ? i.message
      : (env[key] === undefined || env[key] === '' ? 'chưa khai báo' : 'sai định dạng');
    return `  • ${key}: ${why}${HINT[key] ? ` — cần ${HINT[key]}` : ''}`;
  });
  throw new Error(`Cấu hình .env chưa hợp lệ:\n${[...new Set(lines)].join('\n')}\nSửa file .env (xem .env.example) rồi chạy lại.`);
}
