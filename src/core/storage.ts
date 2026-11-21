import { FileDocStore, type DocStore } from './docstore.js';
import { z } from 'zod';
import type { IncomingMessage } from '../types.js';

export function scopeKey(msg: Pick<IncomingMessage, 'threadId' | 'topicId'>): string {
  if (!/^-?\d+$/.test(msg.threadId) || (msg.topicId !== undefined && (!Number.isSafeInteger(msg.topicId) || msg.topicId < 1))) {
    throw new Error('Invalid Telegram conversation ID');
  }
  return `${msg.threadId}${msg.topicId === undefined ? '' : `_${msg.topicId}`}`;
}

const store = (d: string | DocStore): DocStore => typeof d === 'string' ? new FileDocStore(d) : d;

const entrySchema = z.object({
  role: z.enum(['user', 'assistant']), text: z.string(), at: z.number(),
  senderId: z.string().optional(), senderName: z.string().optional(),
  messageId: z.string().optional(), replyTo: z.string().optional(),
  replyText: z.string().optional(), replySenderId: z.string().optional(),
});
export type HistoryEntry = z.infer<typeof entrySchema>;

export class ThreadHistory {
  private docs: DocStore;
  constructor(dataDir: string | DocStore, private limit: number, private maxChars: number) { this.docs = store(dataDir); }
  private path(key: string): string {
    if (!/^-?\d+(?:_\d+)?$/.test(key)) throw new Error('Invalid history key');
    return `threads/${key}/history.jsonl`;
  }
  keys(): string[] {
    return (this.docs.list?.('threads/') ?? []).map((n) => n.split('/')[1]!).filter(Boolean);
  }
  recent(key: string): HistoryEntry[] {
    const entries: HistoryEntry[] = [];
    for (const line of this.docs.read(this.path(key)).split('\n')) {
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
    this.docs.write(this.path(key), entries.map((item) => JSON.stringify(item)).join('\n') + '\n');
  }
  clear(key: string): void { this.docs.write(this.path(key), ''); }
}

const settingsSchema = z.record(z.string().regex(/^-?\d+$/), z.object({
  paused: z.boolean(), mode: z.enum(['all', 'mention']),
}));
export class GroupSettings {
  private settings: z.infer<typeof settingsSchema>;
  private path = 'group-settings.json';
  private docs: DocStore;
  constructor(dataDir: string | DocStore, private defaultMode: 'all' | 'mention') {
    this.docs = store(dataDir);
    const raw = this.docs.read(this.path);
    this.settings = raw ? settingsSchema.parse(JSON.parse(raw)) : {};
  }
  get(chatId: string): { paused: boolean; mode: 'all' | 'mention' } {
    return this.settings[chatId] ?? { paused: false, mode: this.defaultMode };
  }
  remove(chatId:string):void {
    delete this.settings[chatId];
    this.docs.write(this.path,JSON.stringify(this.settings));
  }
  set(chatId: string, change: Partial<{ paused: boolean; mode: 'all' | 'mention' }>): void {
    const next = settingsSchema.parse({ ...this.settings, [chatId]: { ...this.get(chatId), ...change } });
    this.docs.write(this.path, JSON.stringify(next, null, 2));
    this.settings = next;
  }
}
