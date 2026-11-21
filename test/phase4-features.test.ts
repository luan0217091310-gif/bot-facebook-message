import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessenger, DAY } from '../src/adapters/messenger/adapter.js';
import { messengerConfig, pageBrainConfig } from '../src/adapters/messenger/config.js';
import { Graph } from '../src/adapters/messenger/graph.js';
import { createBrain } from '../src/brain.js';
import { Repository } from '../src/repository.js';
import { language } from '../src/services/language.js';
import { pageServices } from '../src/services/page.js';
import { createSimulatorSession } from '../src/simulator.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cb of cleanups.splice(0)) await cb();
});

describe('Phase 4 features: language detection, quick replies, comments and cross-channel links', () => {
  it('detects Vietnamese (with/without diacritics), English, explicit /lang switches and preserves language on slash commands', () => {
    expect(language('Xin chào, cho mình hỏi giá', 'en')).toBe('vi');
    expect(language('xin chao, bao gia giup minh', 'en')).toBe('vi');
    expect(language('Hello, how much is the service?', 'vi')).toBe('en');
    expect(language('/help', 'vi')).toBe('vi');
    expect(language('/book', 'vi')).toBe('vi');
    expect(language('/help', 'en')).toBe('en');
    expect(language('/faq how much?', 'vi')).toBe('en');
    expect(language('/lang en', 'vi')).toBe('en');
    expect(language('/lang vi', 'en')).toBe('vi');
  });

  it('builds contextual quick replies respecting Meta limits and supports /lang, /link disabled notice and private reply buttons', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bekane-p4-'));
    const cfg = messengerConfig({
      FB_PAGE_ID: '1',
      FB_APP_SECRET: 'sample',
      FB_VERIFY_TOKEN: 'sample',
      FB_PAGE_ACCESS_TOKEN: 'unit',
      PUBLIC_BASE_URL: 'https://example.org',
      ADMIN_PSIDS: '8',
    });
    const db = new Repository(':memory:');
    const sent: Array<Record<string, unknown>> = [];
    const graph = new Graph(cfg, async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ message_id: '1' });
    });
    const m = createMessenger(graph, db, () => {});
    const brain = createBrain(pageBrainConfig({ AI_API_KEY: 'unit', DATA_DIR: dir }, cfg), m.adapter, (s) => s, () => {});
    const services = pageServices(m, brain, {
      alert: vi.fn(async () => {}),
      log: () => {},
      clean: (s) => s,
      comments: true,
      handoffMinutes: 20,
      linked: false,
      rate: 100,
      transcribe: async () => 'ok',
      summarize: async () => 'ok',
    });
    cleanups.push(async () => {
      await m.adapter.close();
      await brain.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    const docChoices = services.suggest(false, { text: 'nhắc mình lúc 8h', reply: 'Đã đặt lời nhắc', hasDocument: true });
    expect(docChoices.length).toBeLessThanOrEqual(4);
    expect(docChoices.every((c) => c.title.length <= 20)).toBe(true);
    expect(docChoices.some((c) => c.payload === '/close_file')).toBe(true);
    expect(docChoices.some((c) => c.payload === '/reminders')).toBe(true);

    const watchChoices = services.suggest(true, { text: 'watch website https://example.com' });
    expect(watchChoices.some((c) => c.payload === '/watches')).toBe(true);

    const ev = (text: string) => {
      db.set('7', 'last', Date.now());
      return {
        kind: 'chat' as const,
        key: 'k_' + text,
        at: Date.now(),
        user: '7',
        msg: { msgId: 'm_' + text, threadId: '7', senderId: '7', text, isGroup: false, mentionsBot: false },
      };
    };

    await services.handle(ev('/lang en'));
    expect(db.get('7', 'language')).toBe('en');
    expect((sent.at(-1)?.message as { text: string }).text).toBe('Switched language to English.');

    await services.handle(ev('/help'));
    expect(db.get('7', 'language')).toBe('en');

    await services.handle(ev('/link'));
    expect((sent.at(-1)?.message as { text: string }).text).toContain('not enabled');

    await services.handle({
      kind: 'comment',
      key: 'comment:1_99',
      user: '9',
      at: Date.now(),
      comment: '1_99',
      body: 'bao gia giup minh',
    });
    const privateReply = sent.find((s) => (s.recipient as { comment_id?: string } | undefined)?.comment_id === '1_99');
    expect(privateReply).toBeDefined();
    expect((privateReply?.message as { quick_replies?: unknown[] }).quick_replies?.length).toBeGreaterThan(0);
    expect(db.get('9', 'last')).toBeUndefined();
  });

  it('supports unlinking from Telegram side as well as Messenger side', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bekane-link-'));
    const cfg = messengerConfig({
      FB_PAGE_ID: '1',
      FB_APP_SECRET: 'sample',
      FB_VERIFY_TOKEN: 'sample',
      FB_PAGE_ACCESS_TOKEN: 'unit',
      PUBLIC_BASE_URL: 'https://example.org',
    });
    const db = new Repository(':memory:');
    const m = createMessenger(new Graph(cfg, async () => Response.json({ message_id: '1' })), db, () => {});
    const brain = createBrain(pageBrainConfig({ AI_API_KEY: 'unit', DATA_DIR: dir }, cfg), m.adapter, (s) => s, () => {});
    const services = pageServices(m, brain, {
      alert: async () => {},
      log: () => {},
      clean: (s) => s,
      comments: false,
      handoffMinutes: 20,
      linked: true,
      rate: 100,
      transcribe: async () => '',
      summarize: async () => '',
    });
    cleanups.push(async () => {
      await m.adapter.close();
      await brain.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    const code = services.links.issue('77');
    expect(
      services.links.redeem({
        msgId: 'tg1',
        threadId: '5001',
        senderId: '5001',
        isGroup: false,
        mentionsBot: false,
        text: '/link ' + code,
      }),
    ).toBe(true);
    expect(services.links.linkedPsid('5001')).toBe('77');
    expect(services.links.unlinkTelegram('5001')).toBe(true);
    expect(services.links.linkedPsid('5001')).toBeUndefined();
    expect(services.links.unlinkTelegram('5001')).toBe(false);
  });
});

describe('Phase 6 local Messenger chat simulator', () => {
  it('simulates full Messenger UX locally without real Page tokens (text, quick reply, FAQ, file, comment, 24h window)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bekane-sim-test-'));
    const notePath = join(dir, 'bang-gia.txt');
    writeFileSync(notePath, 'Gói VIP giá 500 nghìn/tháng.', 'utf8');

    const sim = await createSimulatorSession({ mockAi: true, otn: false });
    cleanups.push(async () => {
      await sim.close();
      rmSync(dir, { recursive: true, force: true });
    });

    expect(sim.usingMockAi).toBe(true);

    // 1. Tin nhắn đầu tiên nhận lời chào + trả lời Mock AI + quick replies gợi ý.
    const first = await sim.sendText('Xin chào Bekane');
    const texts = first.filter((e) => e.kind === 'text');
    expect(texts[0].text).toContain('Xin chào!');
    expect(texts[1].text).toContain('[Mock AI cục bộ]');
    expect(texts[1].quickReplies?.length).toBeGreaterThan(0);

    // 2. Thêm FAQ và tra cứu /faq.
    sim.addFaq('Chính sách đổi trả', 'Đổi trả miễn phí trong 7 ngày nếu lỗi kỹ thuật.');
    const faqOut = await sim.sendText('/faq đổi trả');
    expect(faqOut.some((e) => e.kind === 'text' && e.text?.includes('Nguồn: Chính sách đổi trả'))).toBe(true);

    // 3. Gửi tệp TXT cục bộ.
    const fileOut = await sim.sendLocalFile(notePath);
    expect(fileOut.some((e) => e.kind === 'text' && e.quickReplies?.some((q) => q.payload === '/close_file'))).toBe(true);

    // 4. Bình luận công khai + Private Reply.
    const commentOut = await sim.sendComment('Shop báo giá giúp mình?');
    expect(commentOut.some((e) => e.kind === 'comment')).toBe(true);
    expect(commentOut.some((e) => e.kind === 'private_reply')).toBe(true);

    // 5. Lùi mốc thời gian 25h để kiểm tra hết cửa sổ 24h & lưu tin lỡ (lấy lại khi chat).
    expect(sim.advanceHours(25)).toBe(true);
    expect(sim.isIn24hWindow()).toBe(false);
    await sim.triggerNotice('Nhắc lịch họp 15h');
    expect(sim.db.get<string[]>(sim.psid, 'missed')).toEqual(['Nhắc lịch họp 15h']);

    const afterReopen = await sim.sendText('Mình quay lại rồi');
    expect(afterReopen.some((e) => e.kind === 'text' && e.text?.includes('Nhắc lịch họp 15h'))).toBe(true);
    expect(DAY).toBe(86400000);
  });
});
