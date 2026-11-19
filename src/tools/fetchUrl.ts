import { z } from 'zod';
import { htmlToCleanText, safeFetch } from '../core/net.js';
import type { Tool } from './types.js';

const FetchArgs = z.object({
  url: z.string().url(),
});

export function createFetchUrlTool(fetchFn: typeof fetch = fetch): Tool {
  return {
    name: 'fetch_url',
    description:
      'Đọc và trích xuất nội dung văn bản của một trang web hoặc bài báo qua đường link URL (http/https). Dùng khi người dùng gửi link và nhờ đọc, tóm tắt, đánh giá hoặc kiểm tra nội dung trang web đó.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Đường dẫn URL đầy đủ (bắt đầu bằng http:// hoặc https://)' },
      },
      required: ['url'],
    },
    access: 'public',
    readOnly: true,
    async run(rawArgs, ctx) {
      const { url } = FetchArgs.parse(rawArgs);
      const res = await safeFetch(url, { signal: ctx.signal }, fetchFn);
      if (!res.ok) {
        throw new Error(`Không tải được trang (HTTP ${res.status})`);
      }
      const raw = await res.text();
      const cleaned = htmlToCleanText(raw).slice(0, 6000);
      return cleaned || 'Trang không có nội dung văn bản hiển thị.';
    },
  };
}
