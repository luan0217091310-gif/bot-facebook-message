import 'dotenv/config';
import {join} from 'node:path';
import {createBrain} from './brain.js';
import {createTelegram} from './adapters/telegram/client.js';
import {createMessenger} from './adapters/messenger/adapter.js';
import {messengerConfig,pageBrainConfig} from './adapters/messenger/config.js';
import {Graph} from './adapters/messenger/graph.js';
import {notifications} from './adapters/messenger/notifications.js';
import {Repository} from './repository.js';
import {loadConfig,type Config} from './config.js';
import {redact} from './core/redact.js';
import {enabledChannels,type ChannelAdapter} from './channel.js';

const clean=(s:string)=>redact(s,Object.entries(process.env).filter(([k,v])=>v && /TOKEN|SECRET|API_KEY|PASSWORD/.test(k)).map(([,v])=>v!));
const log=(s:string)=>console.log(clean(s));
async function main() {
  const entries:Array<{adapter:ChannelAdapter;brain:ReturnType<typeof createBrain>}>=[];
  let db:Repository|undefined;
  const add=(cfg:Config,adapter:ChannelAdapter)=>{
    const brain=createBrain(cfg,adapter,clean,log);
    entries.push({adapter,brain}); return brain;
  };
  const stop=()=>entries.forEach(e=>e.adapter.stop());
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try {
    for(const channel of enabledChannels(process.env.ENABLED_CHANNELS)) {
      if(channel==='telegram') {
        const cfg=loadConfig(process.env);
        add(cfg,createTelegram(cfg,clean,log));
      } else {
        const page=messengerConfig(process.env), cfg=pageBrainConfig(process.env,page);
        db=new Repository(join(cfg.dataDir,'page.sqlite'));
        const messenger=createMessenger(new Graph(page),db,log);
        const notices=notifications(messenger,{otn:process.env.FB_OTN_ENABLED==='true',log});
        Object.assign(messenger.adapter,{notify:notices.notify,plan:notices.plan});
        add(cfg,messenger.adapter);
        messenger.use(async e=>{
          if(e.kind==='optin'){notices.accept(e);return true;}
          if(e.kind!=='chat')return true;
          await notices.flush(e.user);
          if(e.msg.text.toLocaleLowerCase('vi')==='trợ giúp')e.msg.text='/help';
          return false;
        });
      }
    }
    await Promise.race(entries.map(e=>e.adapter.start(e.brain.dispatcher.handle)));
  } finally {
    stop();
    await Promise.allSettled(entries.map(async e=>{await e.brain.close();await e.adapter.close();}));
    db?.close();
  }
}
main().catch(error=>{log(String(error));process.exitCode=1;});
