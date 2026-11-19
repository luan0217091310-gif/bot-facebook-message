import { z } from 'zod';
import type { FactStore } from '../core/facts.js';
import type { Tool } from './types.js';

const RememberArgs = z.object({
  content: z.string().min(1).max(1000),
  confidence: z.enum(['true', 'joke', 'unsure']).default('true'),
  volatile: z.boolean().optional().default(false),
  about: z.string().optional(),
  replacesId: z.string().optional(),
});

const ForgetArgs = z.object({
  id: z.string().min(1),
  reason: z.string().min(1).max(300).default('Admin yêu cầu xoá'),
});

export function createMemoryTools(store: FactStore): Tool[] {
  const rememberFact: Tool = {
    name: 'remember_fact',
    description:
      'Ghi nhớ một sự thật, sở thích, thói quen, kỷ niệm hoặc thông tin quan trọng về người dùng/nhóm để nhớ lâu dài qua các cuộc trò chuyện. Nếu thông tin mới thay thế/đính chính một ghi nhớ cũ, truyền thêm replacesId.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Nội dung thông tin cần ghi nhớ (ngắn gọn, rõ ràng)' },
        confidence: {
          type: 'string',
          enum: ['true', 'joke', 'unsure'],
          description: 'Mức độ tin cậy: true (thông tin thật), joke (nói đùa), unsure (chưa chắc chắn)',
        },
        volatile: {
          type: 'boolean',
          description: 'true nếu là thông tin dễ thay đổi theo thời gian ngắn (địa chỉ tạm, lịch trình tuần này, tâm trạng)',
        },
        about: {
          type: 'string',
          description: 'ID người mà thông tin này nói về (chỉ Admin mới được đặt cho người khác)',
        },
        replacesId: {
          type: 'string',
          description: 'ID của ghi nhớ cũ nếu thông tin mới này đính chính/thay thế ghi nhớ cũ',
        },
      },
      required: ['content', 'confidence'],
    },
    access: 'public',
    readOnly: false,
    async run(rawArgs, ctx) {
      const args = RememberArgs.parse(rawArgs);
      if (args.replacesId) {
        const oldFact = store.get(args.replacesId);
        if (!oldFact) {
          throw new Error(`Không tìm thấy ghi nhớ cũ [${args.replacesId}]`);
        }
        if (!ctx.isAdmin && oldFact.subjectId !== ctx.senderId) {
          throw new Error('Không được sửa thông tin của người khác');
        }
        store.tombstone(args.replacesId, 'đính chính');
      }
      const subjectId = ctx.isAdmin && args.about?.trim() ? args.about.trim() : ctx.senderId;
      const fact = store.add(
        {
          content: args.content,
          subjectId,
          sourceId: ctx.senderId,
          threadId: ctx.threadId,
          confidence: args.confidence,
          volatile: args.volatile ?? false,
        },
        { threadId: ctx.threadId, senderId: ctx.senderId, isGroup: ctx.isGroup },
      );
      return `Đã ghi nhớ [${fact.id}]: ${fact.content}`;
    },
  };

  const forgetFact: Tool = {
    name: 'forget_fact',
    description:
      'Xoá (đưa vào tombstone) một ghi nhớ theo ID. Công cụ này chỉ dành cho Admin và sẽ yêu cầu Admin xác nhận "ok".',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Mã ID của ghi nhớ cần xoá' },
        reason: { type: 'string', description: 'Lý do xoá ghi nhớ' },
      },
      required: ['id', 'reason'],
    },
    access: 'admin',
    readOnly: false,
    confirm(rawArgs) {
      const parsed = ForgetArgs.safeParse(rawArgs);
      if (!parsed.success) return null;
      const target = store.get(parsed.data.id);
      if (!target || target.tombstone) return null;
      return `Xoá ghi nhớ "${target.content}" [${target.id}]?`;
    },
    async run(rawArgs) {
      const args = ForgetArgs.parse(rawArgs);
      const target = store.get(args.id);
      if (!target || target.tombstone) {
        throw new Error(`Không tìm thấy ghi nhớ [${args.id}]`);
      }
      store.tombstone(args.id, args.reason);
      return `Đã xoá ghi nhớ [${args.id}]: "${target.content}"`;
    },
  };

  return [rememberFact, forgetFact];
}
