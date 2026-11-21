import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { IncomingMessage } from '../types.js';

export function scopeKey(msg: Pick<IncomingMessage, 'threadId' | 'topicId'>): string {
  if (!/^-?\d+$/.test(msg.threadId) || (msg.topicId !== undefined && (!Number.isSafeInteger(msg.topicId) || msg.topicId < 1))) {
    throw new Error('Invalid Telegram conversation ID');
  }
  return `${msg.threadId}${msg.topicId === undefined ? '' : `_${msg.topicId}`}`;
}

function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(`${path}.tmp`, text, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

function readOptional(path: string): string {
  try { return readFileSync(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

const entrySchema = z.object({
  role: z.enum(['user', 'assistant']), text: z.string(), at: z.number(),
  senderId: z.string().optional(), senderName: z.string().optional(),
  messageId: z.string().optional(), replyTo: z.string().optional(),
  replyText: z.string().optional(), replySenderId: z.string().optional(),
});
export type HistoryEntry = z.infer<typeof entrySchema>;

export class ThreadHistory {
  constructor(private dataDir: string, private limit: number, private maxChars: number) {}
  private path(key: string): string {
    if (!/^-?\d+(?:_\d+)?$/.test(key)) throw new Error('Invalid history key');
    return join(this.dataDir, 'threads', key, 'history.jsonl');
  }
  recent(key: string): HistoryEntry[] {
    const entries: HistoryEntry[] = [];
    for (const line of readOptional(this.path(key)).split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = entrySchema.safeParse(JSON.parse(line));
        if (parsed.success) entries.push(parsed.data);
      } catch { /* A damaged JSONL line does not discard other history. */ }
    }
    return this.bound(entries);
  }
  private bound(entries: HistoryEntry[]): HistoryEntry[] {
    const kept: HistoryEntry[] = [];
    let chars = 0;
    for (const entry of entries.slice(-this.limit).reverse()) {
      const size = JSON.stringify(entry).length;
      if (chars + size > this.maxChars) break;
      kept.push(entry);
      chars += size;
    }
    return kept.reverse();
  }
  append(key: string, entry: HistoryEntry): void {
    const entries = this.bound([...this.recent(key), entrySchema.parse(entry)]);
    atomicWrite(this.path(key), entries.map((item) => JSON.stringify(item)).join('\n') + '\n');
  }
  clear(key: string): void { atomicWrite(this.path(key), ''); }
}

const settingsSchema = z.record(z.string().regex(/^-?\d+$/), z.object({
  paused: z.boolean(), mode: z.enum(['all', 'mention']),
}));
export class GroupSettings {
  private settings: z.infer<typeof settingsSchema>;
  private path: string;
  constructor(dataDir: string, private defaultMode: 'all' | 'mention') {
    this.path = join(dataDir, 'group-settings.json');
    const raw = readOptional(this.path);
    this.settings = raw ? settingsSchema.parse(JSON.parse(raw)) : {};
  }
  get(chatId: string): { paused: boolean; mode: 'all' | 'mention' } {
    return this.settings[chatId] ?? { paused: false, mode: this.defaultMode };
  }
  remove(chatId:string):void {
    delete this.settings[chatId];
    atomicWrite(this.path,JSON.stringify(this.settings));
  }
  set(chatId: string, change: Partial<{ paused: boolean; mode: 'all' | 'mention' }>): void {
    const next = settingsSchema.parse({ ...this.settings, [chatId]: { ...this.get(chatId), ...change } });
    atomicWrite(this.path, JSON.stringify(next, null, 2));
    this.settings = next;
  }
}
