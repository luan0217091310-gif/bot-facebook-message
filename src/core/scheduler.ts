import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Reminder {
  id: string;
  threadId: string;
  topicId?: number;
  senderId: string;
  senderName?: string;
  note: string;
  dueAt: number;
  createdAt: number;
}

export class ReminderStore {
  private items: Reminder[] = [];
  private delivering = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly filePath: string,
    private readonly onDue?: (reminder: Reminder) => Promise<void> | void,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.items = [];
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      this.items = Array.isArray(parsed) ? (parsed as Reminder[]) : [];
    } catch {
      this.items = [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${this.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.items, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }

  add(input: Omit<Reminder, 'id' | 'createdAt'>): Reminder {
    const reminder: Reminder = {
      ...input,
      id: randomBytes(3).toString('hex'),
      createdAt: this.now(),
    };
    this.items.push(reminder);
    this.save();
    return reminder;
  }

  list(threadId?: string): Reminder[] {
    return this.items
      .filter((r) => !threadId || r.threadId === threadId)
      .slice()
      .sort((a, b) => a.dueAt - b.dueAt);
  }

  remove(id: string, threadId?: string): Reminder | undefined {
    const idx = this.items.findIndex((r) => r.id === id && (!threadId || r.threadId === threadId));
    if (idx === -1) return undefined;
    const [removed] = this.items.splice(idx, 1);
    this.save();
    return removed;
  }

  async tick(): Promise<number> {
    if (!this.onDue) return 0;
    const current = this.now();
    const due = this.items.filter((r) => r.dueAt <= current);
    if (due.length === 0) return 0;
    let delivered=0;
    for (const r of due) {
      if(this.delivering.has(r.id))continue;
      this.delivering.add(r.id);
      try { await this.onDue(r); this.remove(r.id); delivered++; }
      finally { this.delivering.delete(r.id); }
    }
    return delivered;
  }

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
