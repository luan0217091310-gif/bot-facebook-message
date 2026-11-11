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
}

const list = (v: string | undefined): string[] =>
  (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const orDefault = (v: string | undefined, d: string): string => (v?.trim() ? v.trim() : d);

export function loadConfig(env: Record<string, string | undefined>): Config {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'AI_API_KEY', 'ADMIN_TELEGRAM_IDS'];
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

  return {
    telegramToken: env.TELEGRAM_BOT_TOKEN!.trim(),
    botUsername: env.TELEGRAM_BOT_USERNAME!.trim().replace(/^@/, ''),
    botAliases: list(env.BOT_ALIASES).map((a) => a.replace(/^@/, '').toLowerCase()),
    adminIds: new Set(list(env.ADMIN_TELEGRAM_IDS)),
    allowedGroups: new Set(list(env.ALLOWED_GROUPS)),
    dmPolicy,
    aiBaseUrl: orDefault(env.AI_BASE_URL, 'https://api.openai.com/v1'),
    aiApiKey: env.AI_API_KEY!.trim(),
    aiModel: orDefault(env.AI_MODEL, 'gpt-4o-mini'),
    maxRounds,
    tavilyApiKey: env.TAVILY_API_KEY?.trim() || undefined,
    dataDir: orDefault(env.DATA_DIR, 'data'),
    personaPath: orDefault(env.PERSONA_PATH, 'config/persona.prompt.md'),
  };
}
