import { describe, it, expect } from 'vitest';
import { splitMessage } from '../src/adapters/telegram/split.js';

describe('splitMessage', () => {
  it('splits 9000 chars into parts <= 4000 that rejoin to the input', () => {
    const input = 'a'.repeat(9000);
    const parts = splitMessage(input);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4000)).toBe(true);
    expect(parts.join('')).toBe(input);
  });
  it('cuts right after the last newline within the first 4000 chars', () => {
    const input = 'a'.repeat(100) + '\n' + 'b'.repeat(100) + '\n' + 'c'.repeat(5000);
    const parts = splitMessage(input);
    expect(parts[0]).toBe('a'.repeat(100) + '\n' + 'b'.repeat(100) + '\n');
    expect(parts.join('')).toBe(input);
  });
  it('returns [input] for short text and [] for empty', () => {
    expect(splitMessage('hi')).toEqual(['hi']);
    expect(splitMessage('')).toEqual([]);
  });
  it('keeps emoji intact and rejects invalid chunk sizes', () => {
    const text = 'a'.repeat(3999) + '😀' + 'b'.repeat(10);
    const parts = splitMessage(text);
    expect(parts.join('')).toBe(text);
    expect(parts.every((part) => !/[\uD800-\uDBFF]$/.test(part))).toBe(true);
    for (const max of [0, -1, 1, 2.5]) expect(() => splitMessage('abc', max)).toThrow();
  });
});
