import { z } from 'zod';
import type { ReminderStore } from '../core/scheduler.js';
import type { Tool } from './types.js';

const ScheduleArgs = z.object({
  note: z.string().min(1).max(500),
  delay_minutes: z.number().positive().max(43200),
});

const CancelArgs = z.object({
  id: z.string().min(1),
});

export function createReminderTools(store: ReminderStore, now: () => number = Date.now): Tool[] {
  const scheduleReminder: Tool = {
    name: 'schedule_reminder',
    description:
      'Đặt lịch hẹn giờ nhắc việc trên Telegram sau một khoảng thời gian (tính theo số phút từ hiện tại). Ví dụ: "Nhắc mình 15 phút nữa uống nước" -> delay_minutes = 15.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Nội dung lời nhắc cần gửi khi đến giờ' },
        delay_minutes: {
          type: 'number',
          description: 'Số phút kể từ hiện tại đến lúc cần nhắc (ví dụ: 5, 30, 60, 120...)',
        },
      },
      required: ['note', 'delay_minutes'],
    },
    access: 'public',
    readOnly: false,
    async run(rawArgs, ctx) {
      const args = ScheduleArgs.parse(rawArgs);
      const dueAt = now() + Math.round(args.delay_minutes * 60 * 1000);
      const reminder = store.add({
        threadId: ctx.threadId,
        topicId: ctx.topicId,
        senderId: ctx.senderId,
        senderName: ctx.senderName,
        note: args.note.trim(),
        dueAt,
      });
      const dueStr = new Date(dueAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      return `Đã đặt lịch nhắc [${reminder.id}]: "${reminder.note}" vào lúc ${dueStr}.`;
    },
  };

  const listReminders: Tool = {
    name: 'list_reminders',
    description: 'Xem danh sách các lịch hẹn nhắc việc đang chờ trong cuộc trò chuyện hiện tại.',
    parameters: { type: 'object', properties: {} },
    access: 'public',
    readOnly: true,
    async run(_rawArgs, ctx) {
      const items = store.list(ctx.threadId);
      if (items.length === 0) return 'Hiện không có lịch nhắc việc nào đang chờ.';
      return items
        .map((r) => {
          const dueStr = new Date(r.dueAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
          return `- [${r.id}] ${r.note} (Hẹn lúc: ${dueStr})`;
        })
        .join('\n');
    },
  };

  const cancelReminder: Tool = {
    name: 'cancel_reminder',
    description: 'Huỷ một lịch nhắc việc đang chờ theo mã ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Mã ID của lịch nhắc cần huỷ' },
      },
      required: ['id'],
    },
    access: 'public',
    readOnly: false,
    async run(rawArgs, ctx) {
      const { id } = CancelArgs.parse(rawArgs);
      const removed = store.remove(id, ctx.threadId);
      if (!removed) throw new Error(`Không tìm thấy lịch nhắc [${id}] trong cuộc trò chuyện này.`);
      return `Đã huỷ lịch nhắc [${id}]: "${removed.note}"`;
    },
  };

  return [scheduleReminder, listReminders, cancelReminder];
}
