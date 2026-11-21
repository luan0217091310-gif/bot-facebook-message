export interface Config {
  telegramToken: string;
  botUsername: string;
  botAliases: string[]; // lowercase, no '@'
  adminIds: Set<string>;
  allowedGroups: Set<string>;
  dmPolicy: 'admin' | 'open';
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  maxRounds: number;
  tavilyApiKey?: string;
  dataDir: string;
  personaPath: string;
  groupReplyMode: 'all' | 'mention';
  historyLimit: number;
  historyMaxChars: number;
  maxInputChars: number;
  maxReplyChars: number;
  maxOutputTokens: number;
  aiTimeoutMs: number;
  maxConcurrentAi: number;
  maxQueuePerThread: number;
  maxQueueTotal: number;
  maxQueueWaitMs: number;
  userMessagesPerMinute: number;
}

const list = (v: string | undefined): string[] =>
  (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const orDefault = (v: string | undefined, d: string): string => (v?.trim() ? v.trim() : d);

export function loadConfig(env: Record<string, string | undefined>, channel: 'telegram' | 'messenger' = 'telegram'): Config {
  const required = channel === 'messenger' ? ['AI_API_KEY'] : ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'AI_API_KEY', 'ADMIN_TELEGRAM_IDS'];
  const missing = required.filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

  const dmPolicy = orDefault(env.DM_POLICY, 'admin');
  if (dmPolicy !== 'admin' && dmPolicy !== 'open') {
    throw new Error(`Invalid DM_POLICY "${dmPolicy}": must be "admin" or "open"`);
  }

  const maxRounds = Number(orDefault(env.MAX_ROUNDS, '5'));
  if (!Number.isInteger(maxRounds) || maxRounds <= 0) {
    throw new Error(`Invalid MAX_ROUNDS "${env.MAX_ROUNDS}": must be a positive integer`);
  }

  const groupReplyMode = orDefault(env.GROUP_REPLY_MODE, 'all');
  if (groupReplyMode !== 'all' && groupReplyMode !== 'mention') {
    throw new Error('Invalid GROUP_REPLY_MODE: must be all or mention');
  }
  const positive = (name: string, fallback: number, ceiling: number): number => {
    const value = Number(orDefault(env[name], String(fallback)));
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
      throw new Error(`Invalid ${name}: must be an integer from 1 to ${ceiling}`);
    }
    return value;
  };
  const adminIds = list(env.ADMIN_TELEGRAM_IDS);
  const allowedGroups = list(env.ALLOWED_GROUPS);
  if (channel === 'telegram' && (!adminIds.length || adminIds.some((id) => !/^[1-9]\d*$/.test(id)))) {
    throw new Error('Invalid ADMIN_TELEGRAM_IDS: use numeric Telegram user IDs');
  }
  if (allowedGroups.some((id) => !/^-\d+$/.test(id))) {
    throw new Error('Invalid ALLOWED_GROUPS: use negative Telegram group IDs');
  }
  const botUsername = (env.TELEGRAM_BOT_USERNAME ?? 'bekane').trim().replace(/^@/, '');
  if (!/^[a-z0-9_]+$/i.test(botUsername)) throw new Error('Invalid TELEGRAM_BOT_USERNAME');
  const aiBaseUrl = orDefault(env.AI_BASE_URL, 'https://api.openai.com/v1');
  const endpoint = new URL(aiBaseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('Invalid AI_BASE_URL: use an HTTP(S) URL without credentials');
  }

  return {
    telegramToken: (env.TELEGRAM_BOT_TOKEN ?? '').trim(),
    botUsername,
    botAliases: list(env.BOT_ALIASES).map((a) => a.replace(/^@/, '').toLowerCase()),
    adminIds: new Set(adminIds),
    allowedGroups: new Set(allowedGroups),
    dmPolicy,
    aiBaseUrl,
    aiApiKey: env.AI_API_KEY!.trim(),
    aiModel: orDefault(env.AI_MODEL, 'gpt-4o-mini'),
    maxRounds,
    tavilyApiKey: env.TAVILY_API_KEY?.trim() || undefined,
    dataDir: orDefault(env.DATA_DIR, 'data'),
    personaPath: orDefault(env.PERSONA_PATH, 'config/persona.prompt.md'),
    groupReplyMode,
    historyLimit: positive('HISTORY_LIMIT', 40, 200),
    historyMaxChars: positive('HISTORY_MAX_CHARS', 16000, 100000),
    maxInputChars: positive('MAX_INPUT_CHARS', 6000, 20000),
    maxReplyChars: positive('MAX_REPLY_CHARS', 3500, 12000),
    maxOutputTokens: positive('MAX_OUTPUT_TOKENS', 600, 8000),
    aiTimeoutMs: positive('AI_TIMEOUT_MS', 30000, 180000),
    maxConcurrentAi: positive('MAX_CONCURRENT_AI', 3, 20),
    maxQueuePerThread: positive('MAX_QUEUE_PER_THREAD', 10, 100),
    maxQueueTotal: positive('MAX_QUEUE_TOTAL', 100, 1000),
    maxQueueWaitMs: positive('MAX_QUEUE_WAIT_MS', 90000, 600000),
    userMessagesPerMinute: positive('USER_MESSAGES_PER_MINUTE', 10, 120),
  };
}
