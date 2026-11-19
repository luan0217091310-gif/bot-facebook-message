import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { FactStore, renderMemoryForPrompt } from '../src/core/facts.js';
import { createMemoryTools } from '../src/tools/memoryTools.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeStore(now = Date.now) {
  const dir = mkdtempSync(join(tmpdir(), 'bekane-facts-'));
  dirs.push(dir);
  return new FactStore(join(dir, 'facts.json'), now);
}

describe('Scoped Fact Memory & Tools', () => {
  it('never leaks DM facts into any group chat', () => {
    const store = makeStore();
    store.add(
      { content: 'Bí mật riêng tư của Luân', subjectId: '6864517458', sourceId: '6864517458', threadId: '6864517458', confidence: 'true', volatile: false },
      { threadId: '6864517458', senderId: '6864517458', isGroup: false },
    );
    expect(store.search({ threadId: '-5185817080', senderId: '6864517458', isGroup: true })).toEqual([]);
    const dmFacts = store.search({ threadId: '6864517458', senderId: '6864517458', isGroup: false });
    expect(dmFacts).toHaveLength(1);
    expect(dmFacts[0].visibility).toBe('private');
  });

  it('isolates group facts between different groups and detects staleness and tombstones', () => {
    let clock = 1_000_000;
    const store = makeStore(() => clock);
    const f1 = store.add(
      { content: 'Nhóm 1 thích chơi game', subjectId: '7', sourceId: '7', threadId: '-100', confidence: 'true', volatile: true },
      { threadId: '-100', senderId: '7', isGroup: true },
    );
    expect(store.search({ threadId: '-200', senderId: '7', isGroup: true })).toEqual([]);

    // 15 days later -> volatile fact becomes stale
    clock += 15 * 24 * 60 * 60 * 1000;
    const found = store.search({ threadId: '-100', senderId: '7', isGroup: true });
    expect(found[0].stale).toBe(true);

    // Tombstone hides it from search and lists it in tombstones
    store.tombstone(f1.id, 'đính chính');
    expect(store.search({ threadId: '-100', senderId: '7', isGroup: true })).toEqual([]);
    const tombs = store.tombstones({ threadId: '-100', senderId: '7', isGroup: true });
    expect(tombs).toHaveLength(1);
    const rendered = renderMemoryForPrompt(found, tombs);
    expect(rendered).toContain('(cũ, cần hỏi lại)');
    expect(rendered).toContain('KHÔNG dùng lại');
  });

  it('prevents guest from replacing another user fact and requires admin confirmation for forget_fact', async () => {
    const store = makeStore();
    const [remember, forget] = createMemoryTools(store);
    await remember.run(
      { content: 'Luân thích uống cà phê sữa', confidence: 'true' },
      { threadId: '-100', senderId: '6864517458', isAdmin: true, isGroup: true },
    );
    const luanFact = store.search({ threadId: '-100', senderId: '6864517458', isGroup: true })[0];

    await expect(
      remember.run(
        { content: 'Sửa trộm', confidence: 'true', replacesId: luanFact.id },
        { threadId: '-100', senderId: '999', isAdmin: false, isGroup: true },
      ),
    ).rejects.toThrow(/người khác/);

    expect(forget.access).toBe('admin');
    expect(forget.confirm?.({ id: luanFact.id, reason: 'xoá' }, { threadId: '-100', senderId: '6864517458', isAdmin: true, isGroup: true }))
      .toContain('Luân thích uống cà phê sữa');
  });
});
