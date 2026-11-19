import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_BOT_USERNAME: 'HieuBot', AI_API_KEY: 'k', ADMIN_TELEGRAM_IDS: ' 111, 222 ' };

describe('loadConfig', () => {
  it('throws listing every missing required var', () => {
    expect(() => loadConfig({})).toThrow(/TELEGRAM_BOT_TOKEN[\s\S]*TELEGRAM_BOT_USERNAME[\s\S]*AI_API_KEY[\s\S]*ADMIN_TELEGRAM_IDS/);
  });
  it('parses lists and applies defaults', () => {
    const c = loadConfig({ ...base, ALLOWED_GROUPS: '-100,-200', BOT_ALIASES: '@Goblin, bé' });
    expect([...c.adminIds]).toEqual(['111', '222']);
    expect(c.allowedGroups.has('-200')).toBe(true);
    expect(c.botAliases).toEqual(['goblin', 'bé']);
    expect(c).toMatchObject({ aiBaseUrl: 'https://api.openai.com/v1', aiModel: 'gpt-4o-mini', maxRounds: 5,
      dmPolicy: 'admin', dataDir: 'data', personaPath: 'config/persona.prompt.md' });
    expect(c.tavilyApiKey).toBeUndefined();
  });
  it('rejects invalid DM_POLICY and non-positive MAX_ROUNDS', () => {
    expect(() => loadConfig({ ...base, DM_POLICY: 'everyone' })).toThrow(/DM_POLICY/);
    expect(() => loadConfig({ ...base, MAX_ROUNDS: '0' })).toThrow(/MAX_ROUNDS/);
  });
  it('uses all-member replies by default and validates modes and resource limits', () => {
    expect(loadConfig(base).groupReplyMode).toBe('all');
    expect(loadConfig({ ...base, GROUP_REPLY_MODE: 'mention' }).groupReplyMode).toBe('mention');
    expect(() => loadConfig({ ...base, GROUP_REPLY_MODE: 'smart' })).toThrow(/GROUP_REPLY_MODE/);
    for (const key of ['MAX_CONCURRENT_AI', 'MAX_QUEUE_TOTAL', 'HISTORY_MAX_CHARS', 'AI_TIMEOUT_MS', 'MAX_INPUT_CHARS']) {
      for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '999999999']) {
        expect(() => loadConfig({ ...base, [key]: value })).toThrow(key);
      }
    }
  });
  it('rejects nonnumeric identity lists and credentials embedded in endpoints', () => {
    expect(() => loadConfig({ ...base, ADMIN_TELEGRAM_IDS: ',' })).toThrow(/ADMIN_TELEGRAM_IDS/);
    expect(() => loadConfig({ ...base, ADMIN_TELEGRAM_IDS: 'Hiếu' })).toThrow(/ADMIN_TELEGRAM_IDS/);
    expect(() => loadConfig({ ...base, ALLOWED_GROUPS: '@group' })).toThrow(/ALLOWED_GROUPS/);
    expect(() => loadConfig({ ...base, AI_BASE_URL: 'https://user:password@example.com' })).toThrow(/AI_BASE_URL/);
    expect(() => loadConfig({ ...base, AI_BASE_URL: 'file:///secret' })).toThrow(/AI_BASE_URL/);
  });
});
