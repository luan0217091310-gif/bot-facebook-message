import pino, { type Logger } from 'pino';
import { redact } from './redact.js';

/** Bí mật lấy từ env theo tên biến (TOKEN/SECRET/API_KEY/PASSWORD) để che trong mọi dòng log. */
export function envSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(env).filter(([k, v]) => v && /TOKEN|SECRET|API_KEY|PASSWORD/.test(k)).map(([, v]) => v!);
}

/**
 * Log có cấu trúc (JSON một dòng) bằng pino. Mọi chuỗi đi qua redact() trước khi ghi,
 * kể cả các trường trong object, nên token/API key không bao giờ lọt vào log.
 */
export function createLogger(secrets: string[], options: { level?: string; destination?: pino.DestinationStream } = {}) {
  const clean = (s: string) => redact(s, secrets);
  const scrub = (v: unknown): unknown =>
    typeof v === 'string' ? clean(v) : Array.isArray(v) ? v.map(scrub)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)])) : v;
  const logger: Logger = pino({
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
    base: { app: 'bekane' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { log: (o) => scrub(o) as Record<string, unknown> },
    hooks: { logMethod(args, method) { method.apply(this, args.map(scrub) as Parameters<typeof method>); } },
  }, options.destination);
  /** Tương thích với hàm log(string) cũ: tự chọn mức warn/error theo nội dung. */
  const log = (s: string) => {
    const text = clean(s);
    if (/lỗi|error|thất bại|failed/i.test(text)) logger.error(text);
    else if (/cảnh báo|warn|hết cửa sổ|bị chặn/i.test(text)) logger.warn(text);
    else logger.info(text);
  };
  return { logger, log, clean };
}
