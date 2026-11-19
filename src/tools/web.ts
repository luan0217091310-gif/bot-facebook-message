import { z } from 'zod';
import { htmlToCleanText } from '../core/net.js';
import type { Tool } from './types.js';

const SearchArgs = z.object({
  query: z.string().min(1).max(400),
  max_results: z.number().int().min(1).max(8).optional().default(5),
});

interface TavilyResultItem {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
}

const CACHE_TTL_MS = 10 * 60 * 1000;

export function createWebSearchTool(
  apiKey?: string,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Tool {
  const cache = new Map<string, { at: number; value: string }>();

  return {
    name: 'web_search',
    description:
      'Tìm kiếm thông tin mới nhất trên Internet (tin tức, kiến thức, giá cả, sự kiện, tài liệu...). Dùng khi câu hỏi cần dữ liệu thực tế hoặc thông tin cập nhật.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Từ khoá tìm kiếm ngắn gọn, rõ ý' },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: 'Số lượng kết quả tối đa (1 đến 8, mặc định 5)',
        },
      },
      required: ['query'],
    },
    access: 'public',
    readOnly: true,
    async run(rawArgs, ctx) {
      const args = SearchArgs.parse(rawArgs);
      const normQuery = args.query.trim().toLowerCase().replace(/\s+/g, ' ');
      const cacheKey = `${normQuery}::${args.max_results}`;
      const hit = cache.get(cacheKey);
      if (hit && now() - hit.at <= CACHE_TTL_MS) {
        return hit.value;
      }

      let output: string;
      if (apiKey?.trim()) {
        const res = await fetchFn('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey.trim()}`,
          },
          body: JSON.stringify({
            query: args.query,
            search_depth: 'basic',
            include_raw_content: true,
            max_results: args.max_results,
          }),
          signal: ctx.signal,
        });
        if (!res.ok) {
          throw new Error(`Tavily lỗi HTTP ${res.status}`);
        }
        const data = (await res.json()) as { results?: TavilyResultItem[] };
        const items = (data.results ?? []).slice(0, args.max_results).map((item) => {
          const body = (item.raw_content || item.content || '').slice(0, 3000);
          return `${item.title ?? 'Không tiêu đề'}\n${item.url ?? ''}\n${body}`;
        });
        output = items.length > 0 ? items.join('\n---\n') : 'Không tìm thấy kết quả phù hợp.';
      } else {
        // Zero-config fallback using DuckDuckGo HTML search when TAVILY_API_KEY is not configured.
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
        const res = await fetchFn(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BekaneBot/1.0)' },
          signal: ctx.signal,
        });
        if (!res.ok) {
          throw new Error(`Tìm kiếm web lỗi HTTP ${res.status}`);
        }
        const html = await res.text();
        const snippetMatches = [...html.matchAll(/<a class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)];
        const items = snippetMatches.slice(0, args.max_results).map((m) => {
          const link = m[1];
          const title = htmlToCleanText(m[2]);
          const snippet = htmlToCleanText(m[3]).slice(0, 1000);
          return `${title}\n${link}\n${snippet}`;
        });
        output = items.length > 0
          ? items.join('\n---\n')
          : htmlToCleanText(html).slice(0, 3000) || 'Không tìm thấy kết quả phù hợp.';
      }

      cache.set(cacheKey, { at: now(), value: output });
      return output;
    },
  };
}
