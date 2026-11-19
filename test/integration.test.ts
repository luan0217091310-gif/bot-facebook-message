import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import OpenAI from 'openai';
import { Bot, type Message } from 'node-telegram-bot-api';
import { loadConfig } from '../src/config.js';
import { createTelegram } from '../src/adapters/telegram/client.js';
import { createDispatcher } from '../src/core/dispatcher.js';
import { createOpenAiLlm } from '../src/core/llm.js';
import { GroupSettings, ThreadHistory } from '../src/core/storage.js';

it('runs real Telegram v2 and OpenAI SDKs through polling, dispatcher, AI and a topic reply with mocked HTTP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bothieu-integration-'));
  const cfg = loadConfig({ TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_BOT_USERNAME: 'HieuBot', AI_API_KEY: 'test-key', ADMIN_TELEGRAM_IDS: '111', ALLOWED_GROUPS: '-100' });
  const message = {
    message_id: 45, message_thread_id: 12, date: 1, chat: { id: -100, type: 'supergroup', title: 'Test' },
    from: { id: 7, is_bot: false, first_name: 'An' }, text: 'Chào bot',
  } as Message;
  const sent: URLSearchParams[] = [];
  const aiBodies: Record<string, unknown>[] = [];
  let polls = 0;
  const fakeTelegramFetch: typeof fetch = async (input, init) => {
    const method = String(input).split('/').at(-1);
    const body = new URLSearchParams(String(init?.body));
    let result: unknown = true;
    if (method === 'getMe') result = { id: 123, is_bot: true, first_name: 'Hiếu', username: 'HieuBot' };
    if (method === 'getWebhookInfo') result = { url: '', pending_update_count: 0, has_custom_certificate: false };
    if (method === 'getUpdates') {
      if (polls++ === 0) result = [{ update_id: 10, message }];
      else if (body.get('timeout') === '0') result = [];
      else return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    if (method === 'sendMessage') { sent.push(body); result = { ...message, message_id: 46, text: body.get('text') }; }
    return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  };
  const fakeAiFetch: typeof fetch = async (_input, init) => {
    aiBodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      id: 'chat-test', object: 'chat.completion', created: 1, model: cfg.aiModel,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Chào An!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { headers: { 'content-type': 'application/json' } });
  };
  const bot = new Bot(cfg.telegramToken, { fetch: fakeTelegramFetch, maxRetries: 0 });
  const telegram = createTelegram(cfg, (text) => text, () => {}, bot);
  const dispatcher = createDispatcher({
    cfg, history: new ThreadHistory(dir, 40, 16000), settings: new GroupSettings(dir, 'all'),
    llm: createOpenAiLlm(new OpenAI({ apiKey: cfg.aiApiKey, fetch: fakeAiFetch, maxRetries: 0 }), cfg.aiModel, cfg.maxOutputTokens),
    persona: { get: () => 'Bạn là Bot Hiếu' }, send: telegram.send, typing: telegram.typing,
    clean: (text) => text, log: () => {},
  });
  try {
    await telegram.start(async (incoming) => {
      try { await dispatcher.handle(incoming); }
      finally { telegram.stop(); }
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].get('text')).toBe('Chào An!');
    expect(sent[0].get('chat_id')).toBe('-100');
    expect(sent[0].get('message_thread_id')).toBe('12');
    expect(JSON.parse(sent[0].get('reply_parameters')!)).toMatchObject({ message_id: 45 });
    expect(aiBodies[0]).toMatchObject({ model: cfg.aiModel, max_completion_tokens: 600, store: false });
    expect(dispatcher.stats).toEqual({ completed: 1, failed: 0, tokens: 15 });
  } finally {
    telegram.stop(); await dispatcher.close(); await telegram.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
