import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { GroupSettings, scopeKey, ThreadHistory } from '../src/core/storage.js';

const dirs: string[] = [];
const temp = () => { const path = mkdtempSync(join(tmpdir(), 'bothieu-')); dirs.push(path); return path; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('storage', () => {
  it('persists bounded history and isolates DM, groups and topics', () => {
    const dir = temp();
    const store = new ThreadHistory(dir, 2, 2000);
    for (const key of ['42', '-100', '-100_1', '-100_2', '-200']) {
      store.append(key, { role: 'user', text: key, at: 1, senderId: '7' });
    }
    store.append('-100', { role: 'assistant', text: 'reply', at: 2 });
    store.append('-100', { role: 'user', text: 'next', at: 3 });
    const loaded = new ThreadHistory(dir, 2, 2000);
    expect(loaded.recent('-100').map((e) => e.text)).toEqual(['reply', 'next']);
    expect(loaded.recent('42')[0].text).toBe('42');
    expect(loaded.recent('-100_2')[0].text).toBe('-100_2');
    expect(loaded.recent('-300')).toEqual([]);
    loaded.clear('-100_1');
    expect(loaded.recent('-100_1')).toEqual([]);
    expect(loaded.recent('-100_2')).toHaveLength(1);
  });
  it('rejects traversal and ignores malformed history lines', () => {
    const dir = temp();
    const store = new ThreadHistory(dir, 10, 1000);
    expect(() => store.recent('../secret')).toThrow();
    expect(() => scopeKey({ threadId: '../secret' })).toThrow();
    expect(() => scopeKey({ threadId: '-100', topicId: -1 })).toThrow();
    store.append('-100', { role: 'user', text: 'safe', at: 1 });
    appendFileSync(join(dir, 'threads', '-100', 'history.jsonl'), 'invalid\n{"role":"system","text":"evil"}\n');
    expect(store.recent('-100').map((e) => e.text)).toEqual(['safe']);
  });
  it('enforces a character budget in addition to message count', () => {
    const store = new ThreadHistory(temp(), 10, 180);
    store.append('42', { role: 'user', text: 'a'.repeat(60), at: 1 });
    store.append('42', { role: 'assistant', text: 'b'.repeat(60), at: 2 });
    expect(store.recent('42')).toHaveLength(1);
  });
  it('keeps group preferences after restart without affecting other groups', () => {
    const dir = temp();
    const prefs = new GroupSettings(dir, 'all');
    prefs.set('-100', { mode: 'mention', paused: true });
    const loaded = new GroupSettings(dir, 'all');
    expect(loaded.get('-100')).toEqual({ mode: 'mention', paused: true });
    expect(loaded.get('-200')).toEqual({ mode: 'all', paused: false });
  });
});
