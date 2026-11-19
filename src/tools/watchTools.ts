import { z } from 'zod';
import type { WatchStore } from '../core/watches.js';
import type { Tool } from './types.js';

const WatchArgs = z.object({
  url: z.string().url(),
  label: z.string().max(120).optional(),
});

const UnwatchArgs = z.object({
  id: z.string().min(1),
});

export function createWatchTools(store: WatchStore): Tool[] {
  const watchUrl: Tool = {
    name: 'watch_url',
    description:
      'Theo dõi định kỳ một trang web (URL) và tự động thông báo về Telegram khi nội dung trang thay đổi (không tốn token AI khi trang không đổi). Chỉ Admin mới được thêm trang theo dõi.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Đường dẫn URL trang web cần theo dõi' },
        label: { type: 'string', description: 'Tên gợi nhớ cho trang web này (tuỳ chọn)' },
      },
      required: ['url'],
    },
    access: 'admin',
    readOnly: false,
    async run(rawArgs, ctx) {
      const args = WatchArgs.parse(rawArgs);
      const site = await store.add({
        url: args.url,
        label: args.label,
        threadId: ctx.threadId,
        topicId: ctx.topicId,
      });
      return `Đã bắt đầu giám sát [${site.id}] ${site.label} (${site.url}). Bot sẽ tự báo khi trang có thay đổi!`;
    },
  };

  const listWatches: Tool = {
    name: 'list_watches',
    description: 'Xem danh sách các trang web đang được giám sát thay đổi trong cuộc trò chuyện này.',
    parameters: { type: 'object', properties: {} },
    access: 'public',
    readOnly: true,
    async run(_rawArgs, ctx) {
      const items = store.list(ctx.threadId);
      if (items.length === 0) return 'Chưa có trang web nào đang được giám sát.';
      return items.map((s) => `- [${s.id}] ${s.label}: ${s.url}`).join('\n');
    },
  };

  const unwatchUrl: Tool = {
    name: 'unwatch_url',
    description: 'Ngừng giám sát một trang web theo mã ID (chỉ dành cho Admin).',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Mã ID của trang đang giám sát cần gỡ' },
      },
      required: ['id'],
    },
    access: 'admin',
    readOnly: false,
    async run(rawArgs, ctx) {
      const { id } = UnwatchArgs.parse(rawArgs);
      const removed = store.remove(id, ctx.threadId);
      if (!removed) throw new Error(`Không tìm thấy trang giám sát [${id}].`);
      return `Đã ngừng giám sát [${id}]: ${removed.label}`;
    },
  };

  return [watchUrl, listWatches, unwatchUrl];
}
