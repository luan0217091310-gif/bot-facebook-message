import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessenger, DAY, inWindow } from '../src/adapters/messenger/adapter.js';
import { messengerConfig, pageBrainConfig } from '../src/adapters/messenger/config.js';
import { parseEvents, validSignature } from '../src/adapters/messenger/events.js';
import { Graph } from '../src/adapters/messenger/graph.js';
import { notifications } from '../src/adapters/messenger/notifications.js';
import { splitMessenger } from '../src/adapters/messenger/split.js';
import { createBrain } from '../src/brain.js';
import { createDispatcher } from '../src/core/dispatcher.js';
import type { LlmClient } from '../src/core/llm.js';
import { GroupSettings, ThreadHistory } from '../src/core/storage.js';
import { Repository } from '../src/repository.js';
import { createTimeTool } from '../src/tools/time.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cb of cleanups.splice(0)) await cb();
});

describe('Messenger webhook signature, event parser and splitter', () => {
  it('validates X-Hub-Signature-256 on raw payload bytes', () => {
    const raw = Buffer.from('{"object":"page","entry":[]}', 'utf8');
    const secret = 'app-secret-123';
    const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

    expect(validSignature(raw, sig, secret)).toBe(true);
    expect(validSignature(Buffer.from('{"object":"page","entry":[1]}', 'utf8'), sig, secret)).toBe(false);
    expect(validSignature(raw, sig, 'wrong-secret')).toBe(false);
    expect(validSignature(raw, undefined, secret)).toBe(false);
    expect(validSignature(raw, 'sha256=not-hex', secret)).toBe(false);
    expect(validSignature(raw, sig.toUpperCase(), secret)).toBe(false);
  });

  it('parses messaging, quick replies, postbacks, attachments, OTN optin, reactions and feed comments while filtering echo and other pages', () => {
    const page = '1001';
    const events = parseEvents(
      {
        object: 'page',
        entry: [
          {
            id: '9999',
            messaging: [{ sender: { id: '7' }, recipient: { id: '9999' }, timestamp: 1000, message: { mid: 'm0', text: 'skip' } }],
          },
          {
            id: page,
            messaging: [
              { sender: { id: '7' }, recipient: { id: page }, timestamp: 1001, message: { mid: 'm_echo', text: 'echo', is_echo: true } },
              {
                sender: { id: '7' },
                recipient: { id: page },
                timestamp: 1002,
                message: {
                  mid: 'm1',
                  text: 'Đặt lịch hẹn',
                  quick_reply: { payload: '/book' },
                  attachments: [
                    { type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/img.jpg' } },
                    { type: 'audio', payload: { url: 'https://cdn.fbsbx.com/voice.mp4' } },
                    { type: 'file', payload: { url: 'https://cdn.fbsbx.com/doc.pdf' } },
                    { type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/sticker.png', sticker_id: 369239263222822 } },
                  ],
                },
              },
              { sender: { id: '7' }, recipient: { id: page }, timestamp: 1003, postback: { mid: 'p1', payload: '/start' } },
              { sender: { id: '7' }, recipient: { id: page }, timestamp: 1004, optin: { type: 'one_time_notif_optin', payload: 'rem_1', one_time_notif_token: 'otn_tok_1' } },
              { sender: { id: '7' }, recipient: { id: page }, timestamp: 1005, reaction: { mid: 'm1', action: 'react' } },
              { sender: { id: '7' }, recipient: { id: page }, timestamp: 1006, read: { watermark: 1005 } },
            ],
            changes: [
              { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '1001_55', from: { id: '8' }, created_time: 1700000000, message: 'Giá sao ạ?' } },
              { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '1001_56', from: { id: page }, created_time: 1700000001, message: 'Page reply' } },
            ],
          },
        ],
      },
      page,
    );

    expect(events).toHaveLength(6);
    expect(events[0]).toMatchObject({ kind: 'comment', comment: '1001_55', user: '8', at: 1700000000 * 1000, body: 'Giá sao ạ?' });
    expect(events[1]).toMatchObject({
      kind: 'chat',
      key: 'm1',
      user: '7',
      msg: {
        text: '/book',
        attachments: [
          { kind: 'photo', fileId: 'https://scontent.xx.fbcdn.net/img.jpg' },
          { kind: 'audio', fileId: 'https://cdn.fbsbx.com/voice.mp4' },
          { kind: 'document', fileId: 'https://cdn.fbsbx.com/doc.pdf' },
          { kind: 'sticker', fileId: 'https://scontent.xx.fbcdn.net/sticker.png' },
        ],
      },
    });
    expect(events[2]).toMatchObject({ kind: 'chat', key: 'p1', msg: { text: '/start' } });
    expect(events[3]).toMatchObject({ kind: 'optin', token: 'otn_tok_1', job: 'rem_1' });
    expect(events[4]).toMatchObject({ kind: 'reaction' });
    expect(events[5]).toMatchObject({ kind: 'read' });
  });

  it('splits long text and code blocks under 2000 chars without breaking surrogate pairs', () => {
    const plain = 'Xin chào thế giới! '.repeat(250);
    const parts = splitMessenger(plain);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 1999)).toBe(true);
    expect(parts.join('')).toBe(plain);

    const longCode = '```ts\n' + 'const x = 1;\n'.repeat(250) + '```';
    const codeParts = splitMessenger(longCode);
    expect(codeParts.length).toBeGreaterThan(1);
    expect(codeParts.every((p) => p.length <= 1999 && p.startsWith('```ts\n') && p.endsWith('```'))).toBe(true);

    const withEmoji = 'a'.repeat(1998) + '😀' + 'b'.repeat(20);
    const emojiParts = splitMessenger(withEmoji);
    expect(emojiParts.join('')).toBe(withEmoji);
    expect(emojiParts.every((p) => !/[\uD800-\uDBFF]$/.test(p))).toBe(true);
    expect(() => splitMessenger('abc', 10)).toThrow();
  });
});

describe('Messenger 24h window, OTN, Telegram fallback and PSID admin auth', () => {
  it('enforces conservative 24h window boundaries and proactive delivery fallback', async () => {
    const now = 2_000_000_000_000;
    expect(inWindow(undefined, now)).toBe(false);
    expect(inWindow(now - DAY, now)).toBe(false);
    expect(inWindow(now - DAY + 1, now)).toBe(true);
    expect(inWindow(now + 1000, now)).toBe(false);

    const cfg = messengerConfig({
      FB_PAGE_ID: '1',
      FB_PAGE_ACCESS_TOKEN: 'tok',
      FB_APP_SECRET: 'sec',
      FB_VERIFY_TOKEN: 'ver',
      PUBLIC_BASE_URL: 'https://example.org',
      ADMIN_PSIDS: '99',
    });
    const db = new Repository(':memory:');
    const sent: Array<Record<string, unknown>> = [];
    const graph = new Graph(cfg, async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ message_id: '1' });
    });
    const m = createMessenger(graph, db, () => {});
    const tgSent: string[] = [];
    const notices = notifications(m, {
      otn: true,
      log: () => {},
      fallback: async (id, text) => {
        if (id !== '7') return false;
        tgSent.push(text);
        return true;
      },
    });
    cleanups.push(async () => {
      await m.adapter.close();
      db.close();
    });

    // Trong cửa sổ 24h: gửi kiểu UPDATE.
    db.set('7', 'last', Date.now() - 1000);
    await notices.notify('7', 'Nhắc trong 24h');
    expect(sent[0]).toMatchObject({ recipient: { id: '7' }, messaging_type: 'UPDATE' });

    // Xin OTN, người dùng opt-in, rồi hết cửa sổ 24h -> dùng token 1 lần.
    const planMsg = await notices.plan('7', 'rem_9', 'Uống thuốc', Date.now() + 2 * DAY);
    expect(planMsg).toContain('Nhắc tôi');
    expect(sent[1]).toMatchObject({ message: { attachment: { payload: { template_type: 'one_time_notif_req', payload: 'rem_9' } } } });
    notices.accept({ kind: 'optin', key: 'o1', user: '7', at: Date.now(), token: 'otn_once', job: 'rem_9' });

    db.set('7', 'last', Date.now() - DAY - 1000);
    await notices.notify('7', 'Nhắc ngoài 24h bằng OTN', undefined, 'rem_9');
    expect(sent[2]).toMatchObject({ recipient: { one_time_notif_token: 'otn_once' }, message: { text: 'Nhắc ngoài 24h bằng OTN' } });
    expect(db.get('7', 'otn:rem_9')).toBeUndefined();

    // Token đã thu hồi -> rơi xuống Telegram fallback cho user 7, còn user 8 lưu missed và trả khi chat lại.
    await notices.notify('7', 'Nhắc lần 2 sang Telegram', undefined, 'rem_9');
    expect(tgSent).toEqual(['Nhắc lần 2 sang Telegram']);

    await notices.notify('8', 'Tin lỡ 1');
    await notices.notify('8', 'Tin lỡ 2');
    expect(db.get<string[]>('8', 'missed')).toEqual(['Tin lỡ 1', 'Tin lỡ 2']);
    db.set('8', 'last', Date.now());
    await notices.flush('8');
    expect(db.get<string[]>('8', 'missed')).toEqual([]);
    expect(sent.slice(-2).map((s) => (s.message as { text: string }).text)).toEqual([
      'Bạn có lời nhắc hoặc cập nhật bị lỡ:\nTin lỡ 1',
      'Bạn có lời nhắc hoặc cập nhật bị lỡ:\nTin lỡ 2',
    ]);
  });

  it('enforces PSID admin permissions and HITL confirmation on large string PSIDs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bekane-psid-'));
    const adminPsid = '9007199254740993123';
    const guestPsid = '9007199254740993999';
    const page = messengerConfig({
      FB_PAGE_ID: '1',
      FB_PAGE_ACCESS_TOKEN: 'tok',
      FB_APP_SECRET: 'sec',
      FB_VERIFY_TOKEN: 'ver',
      PUBLIC_BASE_URL: 'https://example.org',
      ADMIN_PSIDS: adminPsid,
    });
    const cfg = pageBrainConfig({ AI_API_KEY: 'unit', DATA_DIR: dir }, page);
    expect(cfg.adminIds.has(adminPsid)).toBe(true);
    expect(cfg.adminIds.has(guestPsid)).toBe(false);

    const replies: string[] = [];
    const choices: Array<{ text: string; options: Array<{ title: string; payload: string }> }> = [];
    let confirmedActionRan = false;
    let round = 0;
    const llm: LlmClient = {
      async complete() {
        round++;
        if (round === 1) {
          return {
            text: '',
            tokens: 5,
            toolCalls: [{ id: 'tc1', name: 'confirm_tool', arguments: '{}' }],
            rawMessage: { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'confirm_tool', arguments: '{}' } }] },
          };
        }
        return { text: 'Đã hoàn tất thao tác quản trị.', tokens: 5 };
      },
    };
    const confirmTool = {
      ...createTimeTool(),
      name: 'confirm_tool',
      description: 'Needs confirmation',
      confirm: () => 'Xác nhận chạy thao tác quản trị?',
      async run() {
        confirmedActionRan = true;
        return 'Done';
      },
    };
    const dispatcher = createDispatcher({
      channel: 'messenger',
      cfg,
      llm,
      history: new ThreadHistory(dir, 20, 10000),
      settings: new GroupSettings(dir, 'all'),
      persona: { get: () => 'Test persona' },
      tools: [confirmTool],
      confirm: async (_msg, text) => {
        choices.push({ text, options: [{ title: 'Đồng ý', payload: 'ok' }, { title: 'Huỷ', payload: 'thôi' }] });
      },
      send: async (_msg, text) => {
        replies.push(text);
      },
      typing: async () => {},
      clean: (s) => s,
      log: () => {},
    });
    cleanups.push(async () => {
      await dispatcher.close();
      rmSync(dir, { recursive: true, force: true });
    });

    await dispatcher.handle({ msgId: 'g1', threadId: guestPsid, senderId: guestPsid, isGroup: false, mentionsBot: false, text: '/status' });
    expect(replies.at(-1)).toBe('Lệnh này chỉ dành cho chủ bot.');

    await dispatcher.handle({ msgId: 'a1', threadId: adminPsid, senderId: adminPsid, isGroup: false, mentionsBot: false, text: '/status' });
    expect(replies.at(-1)).toContain('Bekane Bot đang chạy.');

    await dispatcher.handle({ msgId: 'a2', threadId: adminPsid, senderId: adminPsid, isGroup: false, mentionsBot: false, text: 'chạy tool' });
    expect(choices).toHaveLength(1);
    expect(choices[0].text).toContain('Xác nhận chạy thao tác quản trị?');

    // Khách cùng payload 'ok' trong hội thoại khác không duyệt được, admin mới duyệt được.
    await dispatcher.handle({ msgId: 'a3', threadId: adminPsid, senderId: adminPsid, isGroup: false, mentionsBot: false, text: 'ok' });
    expect(confirmedActionRan).toBe(true);
  });
});

describe('Messenger HTTP webhook -> SQLite inbox -> createBrain -> Graph mock integration', () => {
  it('verifies GET challenge, rejects bad POST signature, and processes signed webhook end-to-end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bekane-ms-int-'));
    const mockAi = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4o-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Chào bạn từ Bekane Messenger!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
        }),
      );
    });
    await new Promise<void>((resolve) => mockAi.listen(0, '127.0.0.1', () => resolve()));
    const addr = mockAi.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const appSecret = 'webhook-secret';
    const verifyToken = 'verify-secret';
    const pageId = '555666777';
    const cfg = messengerConfig({
      FB_PAGE_ID: pageId,
      FB_PAGE_ACCESS_TOKEN: 'page-token',
      FB_APP_SECRET: appSecret,
      FB_VERIFY_TOKEN: verifyToken,
      PUBLIC_BASE_URL: 'https://bot.example.com',
      ADMIN_PSIDS: '111',
    });
    const brainCfg = pageBrainConfig(
      { AI_API_KEY: 'test-key', AI_BASE_URL: `http://127.0.0.1:${port}/v1`, DATA_DIR: dir },
      cfg,
    );
    const db = new Repository(':memory:');
    const sent: Array<Record<string, unknown>> = [];
    const graph = new Graph(cfg, async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ message_id: 'out_' + sent.length });
    });
    const m = createMessenger(graph, db, () => {});
    const brain = createBrain(brainCfg, m.adapter, (s) => s, () => {});
    m.suggestions(() => [{ title: 'Đặt lịch hẹn', payload: '/book' }]);
    m.bind(async (msg) => {
      await brain.dispatcher.handle(msg);
    });

    cleanups.push(async () => {
      await m.adapter.close();
      await brain.close();
      db.close();
      await new Promise<void>((done) => mockAi.close(() => done()));
      rmSync(dir, { recursive: true, force: true });
    });

    const badVerify = await m.app.inject({
      method: 'GET',
      url: '/webhooks/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc',
    });
    expect(badVerify.statusCode).toBe(403);

    const okVerify = await m.app.inject({
      method: 'GET',
      url: `/webhooks/messenger?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=CHALLENGE_99`,
    });
    expect(okVerify.statusCode).toBe(200);
    expect(okVerify.body).toBe('CHALLENGE_99');

    const payload = Buffer.from(
      JSON.stringify({
        object: 'page',
        entry: [
          {
            id: pageId,
            messaging: [
              {
                sender: { id: '222333' },
                recipient: { id: pageId },
                timestamp: Date.now(),
                message: { mid: 'mid_int_1', text: 'Xin chào bot' },
              },
            ],
          },
        ],
      }),
      'utf8',
    );
    const badPost = await m.app.inject({
      method: 'POST',
      url: '/webhooks/messenger',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
      payload,
    });
    expect(badPost.statusCode).toBe(403);

    const sig = 'sha256=' + createHmac('sha256', appSecret).update(payload).digest('hex');
    const okPost = await m.app.inject({
      method: 'POST',
      url: '/webhooks/messenger',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      payload,
    });
    expect(okPost.statusCode).toBe(200);
    expect(okPost.body).toBe('EVENT_RECEIVED');

    await vi.waitFor(() => {
      const pending = db.sql.prepare('SELECT count(*) AS n FROM inbox WHERE body IS NOT NULL').get() as { n: number };
      expect(pending.n).toBe(0);
      expect(sent.some((s) => (s.message as { text?: string } | undefined)?.text === 'Chào bạn từ Bekane Messenger!')).toBe(true);
    });

    const aiReply = sent.find((s) => (s.message as { text?: string } | undefined)?.text === 'Chào bạn từ Bekane Messenger!');
    expect(aiReply).toMatchObject({
      recipient: { id: '222333' },
      messaging_type: 'RESPONSE',
      message: {
        text: 'Chào bạn từ Bekane Messenger!',
        quick_replies: [{ content_type: 'text', title: 'Đặt lịch hẹn', payload: '/book' }],
      },
    });
    expect(sent.some((s) => s.sender_action === 'mark_seen')).toBe(true);
    expect(sent.some((s) => s.sender_action === 'typing_off')).toBe(true);
  });
});
