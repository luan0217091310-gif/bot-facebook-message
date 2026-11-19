import { describe, it, expect, vi } from 'vitest';
import { TelegramApiError } from 'node-telegram-bot-api';
import { createSender, type TelegramApi } from '../src/adapters/telegram/client.js';
import type { IncomingMessage } from '../src/types.js';

const msg: IncomingMessage = { threadId: '-100', topicId: 12, senderId: '7', text: 'hi', isGroup: true, msgId: '-100:45', mentionsBot: false };
function fixture() {
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 100 });
  const acquire = vi.fn(async (_id: string, _signal?: AbortSignal) => {});
  const api = { sendMessage, sendChatAction: vi.fn() } as unknown as TelegramApi;
  return { sendMessage, acquire, send: createSender(api, acquire, (text) => text.replaceAll('SECRET', '[ĐÃ ẨN]')) };
}
describe('Telegram output', () => {
  it('splits, redacts and sends all parts with the right reply and topic, without formatting injection', async () => {
    const f = fixture();
    await f.send(msg, 'SECRET' + 'a'.repeat(8500));
    expect(f.sendMessage).toHaveBeenCalledTimes(3);
    expect(f.acquire).toHaveBeenCalledTimes(3);
    for (const [params] of f.sendMessage.mock.calls) {
      expect(params).toMatchObject({ chat_id: '-100', message_thread_id: 12, reply_parameters: { message_id: 45, allow_sending_without_reply: true } });
      expect(params.text.length).toBeLessThanOrEqual(4000);
      expect(params.text).not.toContain('SECRET');
      expect(params).not.toHaveProperty('parse_mode');
    }
  });
  it('retries an explicit 429 but does not retry an ambiguous network failure', async () => {
    const f = fixture();
    f.sendMessage.mockRejectedValueOnce(new TelegramApiError(429, 'flood', { retry_after: 0 }));
    await f.send(msg, 'hi');
    expect(f.sendMessage).toHaveBeenCalledTimes(2);
    f.sendMessage.mockClear().mockRejectedValueOnce(new Error('network'));
    await expect(f.send(msg, 'hi')).rejects.toThrow('network');
    expect(f.sendMessage).toHaveBeenCalledOnce();
  });
  it('checks cancellation after waiting for a rate-limit slot', async () => {
    const controller = new AbortController();
    const sendMessage = vi.fn();
    const send = createSender({ sendMessage } as unknown as TelegramApi, async () => { controller.abort(); }, (text) => text);
    await expect(send(msg, 'hi', controller.signal)).rejects.toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it('bounds the output queue and preserves order within one chat', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const sendMessage = vi.fn().mockImplementationOnce(() => hold).mockResolvedValue({});
    const send = createSender({ sendMessage } as unknown as TelegramApi, async () => {}, (text) => text, { perChat: 2, total: 3 });
    const a = send(msg, 'first'); const b = send(msg, 'second');
    await expect(send(msg, 'overflow')).rejects.toThrow('queue is full');
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    release(); await Promise.all([a, b]);
    expect(sendMessage.mock.calls.map((call) => call[0].text)).toEqual(['first', 'second']);
    await send(msg, 'third');
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });
});
