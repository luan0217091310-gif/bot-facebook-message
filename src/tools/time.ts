import type { Tool } from './types.js';

export function createTimeTool(now: () => Date = () => new Date()): Tool {
  return {
    name: 'get_current_time',
    description: 'Lấy ngày, giờ, thứ chính xác hiện tại ở Việt Nam (múi giờ Asia/Ho_Chi_Minh). Dùng khi người dùng hỏi giờ giấc, ngày tháng, thứ mấy, hoặc tính thời gian nhắc việc.',
    parameters: {
      type: 'object',
      properties: {},
    },
    access: 'public',
    readOnly: true,
    async run() {
      const date = now();
      const formatted = date.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        weekday: 'long',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      return `${formatted} (ISO: ${date.toISOString()})`;
    },
  };
}
