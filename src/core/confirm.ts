import type { PendingAction } from './agent.js';

const APPROVE_WORDS = new Set([
  'ok', 'oke', 'okay', 'ừ', 'ừm', 'uh', 'có', 'đồng ý', 'tiến hành', 'yes', 'y', 'duyệt', 'chốt',
]);
const REJECT_WORDS = new Set([
  'thôi', 'huỷ', 'hủy', 'không', 'ko', 'no', 'cancel', 'dừng', 'bỏ',
]);

export function classifyReply(text: string): 'approve' | 'reject' | null {
  const cleaned = text
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[.!?,;~]+$/g, '')
    .trim();
  if (!cleaned) return null;
  if (APPROVE_WORDS.has(cleaned)) return 'approve';
  if (REJECT_WORDS.has(cleaned)) return 'reject';
  return null;
}

export class PendingConfirmations {
  private readonly store = new Map<string, { at: number; pending: PendingAction }>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  set(key: string, pending: PendingAction): void {
    this.store.set(key, { at: this.now(), pending });
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.now() - entry.at > this.ttlMs) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  take(key: string): PendingAction | undefined {
    if (!this.has(key)) return undefined;
    const entry = this.store.get(key);
    this.store.delete(key);
    return entry?.pending;
  }
}
