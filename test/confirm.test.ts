import { describe, it, expect } from 'vitest';
import { classifyReply, PendingConfirmations } from '../src/core/confirm.js';
import type { PendingAction } from '../src/core/agent.js';

describe('HITL Confirmation', () => {
  it('classifies approve and reject replies accurately', () => {
    expect(classifyReply('OK!')).toBe('approve');
    expect(classifyReply(' tiến hành ')).toBe('approve');
    expect(classifyReply('đồng ý.')).toBe('approve');
    expect(classifyReply('Hủy')).toBe('reject');
    expect(classifyReply('huỷ!')).toBe('reject');
    expect(classifyReply('thôi')).toBe('reject');
    expect(classifyReply('ok nhưng đổi tên file đi')).toBeNull();
    expect(classifyReply('')).toBeNull();
  });

  it('stores, takes once, and expires after TTL', () => {
    let now = 1000;
    const store = new PendingConfirmations(5000, () => now);
    const dummy = { question: 'Xoá?' } as unknown as PendingAction;
    store.set('t1', dummy);
    expect(store.has('t1')).toBe(true);
    expect(store.take('t1')).toBe(dummy);
    expect(store.take('t1')).toBeUndefined();

    store.set('t2', dummy);
    now += 5001;
    expect(store.has('t2')).toBe(false);
    expect(store.take('t2')).toBeUndefined();
  });
});
