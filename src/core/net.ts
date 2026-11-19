const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
];

export function assertPublicHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL không hợp lệ');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Chỉ hỗ trợ giao thức http hoặc https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL không được chứa thông tin đăng nhập');
  }
  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new Error('Chặn truy cập mạng nội bộ (SSRF protection)');
  }
  return parsed;
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  fetchFn: typeof fetch = fetch,
  maxRedirects = 5,
): Promise<Response> {
  let currentUrl = assertPublicHttpUrl(rawUrl).toString();
  for (let i = 0; i <= maxRedirects; i++) {
    const response = await fetchFn(currentUrl, {
      ...init,
      redirect: 'manual',
      headers: {
        'User-Agent': 'BekaneBot/1.0 (+https://github.com/luan0217091310-gif/setup-bot-tele)',
        ...(init.headers ?? {}),
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return response;
      const next = new URL(location, currentUrl).toString();
      currentUrl = assertPublicHttpUrl(next).toString();
      continue;
    }
    return response;
  }
  throw new Error('Quá nhiều lần chuyển hướng (redirect)');
}

export function htmlToCleanText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
