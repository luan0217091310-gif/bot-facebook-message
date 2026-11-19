import { describe, it, expect } from 'vitest';
import { redact } from '../src/core/redact.js';

describe('redaction', () => {
  it('removes configured credentials and common secret forms from replies and errors', () => {
    const secret = 'configured-secret-value';
    const text = `${secret} sk-12345678901234567890 password: hiddenvalue Bearer abcdefghijklmnop 123456789:abcdefghijklmnopqrstuvwxyz123456789`;
    const result = redact(text, [secret]);
    for (const value of [secret, 'sk-12345678901234567890', 'hiddenvalue', 'abcdefghijklmnop', 'abcdefghijklmnopqrstuvwxyz123456789']) {
      expect(result).not.toContain(value);
    }
    expect(result).toContain('[ĐÃ ẨN]');
    expect(redact('bình thường abc', ['abc'])).toBe('bình thường abc');
  });
});
