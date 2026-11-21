import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const sha = (s: string) => createHash('sha256').update(s).digest();
export const safeEqual = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

/** Phiên đăng nhập dashboard: cookie = hạn dùng + HMAC, không lưu trạng thái phía server. */
export function sessions(secret: string, ttlMs = 12 * 3600000, now: () => number = Date.now) {
  const sign = (exp: string) => createHmac('sha256', secret).update('dashboard:' + exp).digest('base64url');
  return {
    issue(): string { const exp = String(now() + ttlMs); return exp + '.' + sign(exp); },
    valid(token: string | undefined): boolean {
      if (!token) return false;
      const [exp, mac] = token.split('.');
      if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) < now()) return false;
      return safeEqual(mac, sign(exp));
    },
  };
}

/** Giới hạn số lần đăng nhập sai theo IP (chống dò mật khẩu). */
export function attempts(limit = 5, windowMs = 60000, now: () => number = Date.now) {
  const seen = new Map<string, number[]>();
  return {
    blocked(ip: string): boolean {
      const list = (seen.get(ip) ?? []).filter((t) => now() - t < windowMs);
      seen.set(ip, list);
      return list.length >= limit;
    },
    fail(ip: string): void { seen.set(ip, [...(seen.get(ip) ?? []), now()]); if (seen.size > 10000) seen.clear(); },
  };
}

/**
 * Giải mã signed_request của Meta (Data Deletion Callback).
 * Định dạng: base64url(chữ ký HMAC-SHA256 bằng App Secret) + '.' + base64url(JSON payload).
 */
export function parseSignedRequest(signed: string, appSecret: string): { user_id: string; [k: string]: unknown } | null {
  const [sig, payload] = signed.split('.');
  if (!sig || !payload) return null;
  const expected = createHmac('sha256', appSecret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data?.algorithm?.toUpperCase?.() !== 'HMAC-SHA256' || typeof data.user_id !== 'string') return null;
    return data;
  } catch { return null; }
}

export const confirmationCode = () => randomBytes(8).toString('hex');
