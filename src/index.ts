import 'dotenv/config';
import { createBrain } from './brain.js';
import { createTelegram } from './adapters/telegram/client.js';
import { loadConfig } from './config.js';
import { redact } from './core/redact.js';
import { enabledChannels } from './channel.js';

const clean = (s: string) => redact(s, Object.entries(process.env)
  .filter(([k,v]) => v && /TOKEN|SECRET|API_KEY|PASSWORD/.test(k)).map(([,v]) => v!));
const log = (s: string) => console.log(clean(s));

async function main() {
  const channels = enabledChannels(process.env.ENABLED_CHANNELS);
  if (channels.includes('messenger')) throw new Error('Adapter Messenger chưa được cài.');
  const cfg = loadConfig(process.env);
  const adapter = createTelegram(cfg, clean, log);
  const brain = createBrain(cfg, adapter, clean, log);
  const stop = () => adapter.stop();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try { await adapter.start(brain.dispatcher.handle); }
  finally { stop(); await brain.close(); await adapter.close(); }
}
main().catch(error => { log(String(error)); process.exitCode = 1; });
