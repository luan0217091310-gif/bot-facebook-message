import { describe, it, expect, vi } from 'vitest';
import { QueueExpiredError, QueueFullError, WorkQueue } from '../src/core/queue.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('WorkQueue', () => {
  it('serializes a conversation while other conversations run concurrently', async () => {
    const queue = new WorkQueue(2, 4, 10, 10000);
    const first = gate();
    const events: string[] = [];
    const a = queue.add('a', '1', async () => { events.push('a1'); await first.promise; events.push('a1done'); });
    const b = queue.add('a', '2', async () => { events.push('a2'); });
    const c = queue.add('b', '3', async () => { events.push('b1'); });
    await c;
    expect(events).toEqual(['a1', 'b1']);
    first.release(); await Promise.all([a, b]);
    expect(events).toEqual(['a1', 'b1', 'a1done', 'a2']);
    expect(queue.size).toBe(0);
  });
  it('enforces per-conversation and global bounds', async () => {
    const queue = new WorkQueue(1, 1, 2, 10000);
    const hold = gate();
    const a = queue.add('a', '1', () => hold.promise);
    const b = queue.add('b', '2', async () => {});
    await expect(queue.add('a', '3', async () => {})).rejects.toBeInstanceOf(QueueFullError);
    await expect(queue.add('c', '3', async () => {})).rejects.toBeInstanceOf(QueueFullError);
    hold.release(); await Promise.all([a, b]);
  });
  it('cancels only the requested member and keeps the lane usable', async () => {
    const queue = new WorkQueue(1, 5, 5, 10000);
    const a = queue.add('a', '1', (signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve())));
    const cancelled = vi.fn();
    const b = queue.add('a', '1', cancelled);
    const c = queue.add('a', '2', async () => {});
    expect(queue.cancel('a', '1')).toBe(2);
    expect(await a).toBe(false); expect(await b).toBe(false); expect(await c).toBe(true);
    expect(cancelled).not.toHaveBeenCalled();
    expect(await queue.add('a', '1', async () => {})).toBe(true);
  });
  it('expires stale questions without running them and recovers after errors', async () => {
    let now = 0;
    const queue = new WorkQueue(1, 4, 10, 100, () => now);
    const hold = gate();
    const a = queue.add('a', '1', () => hold.promise);
    const staleRun = vi.fn();
    const b = queue.add('a', '2', staleRun);
    const expired = expect(b).rejects.toBeInstanceOf(QueueExpiredError);
    now = 101; hold.release(); await a; await expired;
    expect(staleRun).not.toHaveBeenCalled();
    await expect(queue.add('a', '1', async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    expect(await queue.add('a', '1', async () => {})).toBe(true);
  });
  it('cancelChat covers all topics and close rejects new work', async () => {
    const queue = new WorkQueue(2, 3, 10, 10000);
    const run = (signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
    const jobs = [queue.add('-100_1', '1', run), queue.add('-100_2', '2', run)];
    queue.cancelChat('-100');
    expect(await Promise.all(jobs)).toEqual([false, false]);
    queue.close();
    await expect(queue.add('a', '1', async () => {})).rejects.toBeInstanceOf(QueueFullError);
  });
});
