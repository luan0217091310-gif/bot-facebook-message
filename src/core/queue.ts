export class QueueFullError extends Error {}
export class QueueExpiredError extends Error {}
interface Job {
  senderId: string;
  run: (signal: AbortSignal) => Promise<void>;
  controller: AbortController;
  at: number;
  resolve: (completed: boolean) => void;
  reject: (error: unknown) => void;
}
interface Lane { active?: Job; pending: Job[] }

/** Serial per conversation, bounded concurrency across conversations. */
export class WorkQueue {
  private lanes = new Map<string, Lane>();
  private active = 0;
  private closed = false;
  constructor(
    private concurrency: number, private perThread: number,
    private total: number, private maxWaitMs: number,
    private now = Date.now,
  ) {}
  get size(): number {
    return [...this.lanes.values()].reduce((n, lane) => n + lane.pending.length + (lane.active ? 1 : 0), 0);
  }
  add(key: string, senderId: string, run: Job['run']): Promise<boolean> {
    const lane = this.lanes.get(key) ?? { pending: [] };
    if (this.closed || this.size >= this.total || lane.pending.length + (lane.active ? 1 : 0) >= this.perThread) {
      return Promise.reject(new QueueFullError('Queue is full'));
    }
    return new Promise((resolve, reject) => {
      lane.pending.push({ senderId, run, controller: new AbortController(), at: this.now(), resolve, reject });
      this.lanes.set(key, lane);
      this.pump();
    });
  }
  private pump(): void {
    for (const [key, lane] of this.lanes) {
      if (this.active >= this.concurrency) break;
      if (lane.active) continue;
      const job = lane.pending.shift();
      if (!job) { this.lanes.delete(key); continue; }
      lane.active = job;
      this.active++;
      void (async () => {
        try {
          if (this.now() - job.at > this.maxWaitMs) throw new QueueExpiredError('Queue wait expired');
          await job.run(job.controller.signal);
          job.resolve(!job.controller.signal.aborted);
        } catch (error) {
          if (job.controller.signal.aborted) job.resolve(false);
          else job.reject(error);
        } finally {
          lane.active = undefined;
          this.active--;
          if (!lane.pending.length) this.lanes.delete(key);
          // Move a busy conversation to the back so other groups get a turn.
          else { this.lanes.delete(key); this.lanes.set(key, lane); }
          this.pump();
        }
      })();
    }
  }
  cancel(key: string, senderId?: string): number {
    const lane = this.lanes.get(key);
    if (!lane) return 0;
    let count = 0;
    if (lane.active && (!senderId || lane.active.senderId === senderId)) {
      lane.active.controller.abort();
      count++;
    }
    lane.pending = lane.pending.filter((job) => {
      if (senderId && job.senderId !== senderId) return true;
      job.controller.abort(); job.resolve(false); count++; return false;
    });
    if (!lane.active && !lane.pending.length) this.lanes.delete(key);
    return count;
  }
  cancelChat(chatId: string): void {
    for (const key of this.lanes.keys()) {
      if (key === chatId || key.startsWith(`${chatId}_`)) this.cancel(key);
    }
  }
  close(): void {
    this.closed = true;
    for (const key of this.lanes.keys()) this.cancel(key);
  }
}
