import Fastify from 'fastify';
import {createHash,timingSafeEqual} from 'node:crypto';
import type {ChannelAdapter,Choice} from '../../channel.js';
import type {IncomingMessage} from '../../types.js';
import type {Repository} from '../../repository.js';
import {Graph} from './graph.js';
import {parseEvents,validSignature,type PageEvent} from './events.js';
import {splitMessenger} from './split.js';
import {attachment} from './media.js';

export const DAY=86400000;
export function inWindow(at:number|undefined,now=Date.now(),duration=DAY) {
  return at!==undefined && at<=now && now-at<duration;
}
export function createMessenger(graph:Graph,db:Repository,log:(s:string)=>void) {
  const app=Fastify({bodyLimit:2*1024*1024,logger:false});
  const cfg=graph.cfg;
  let onEvent:((event:PageEvent)=>Promise<boolean>)|undefined;
  let afterChat:((msg:IncomingMessage)=>Promise<void>)|undefined;
  let onText:((id:string,text:string)=>void)|undefined;
  let receive:((msg:IncomingMessage)=>Promise<void>)|undefined;
  let stopped=false, timer:ReturnType<typeof setInterval>|undefined;
  const active=new Map<string,Promise<void>>(), busy=new Set<string>();
  const hash=(s:string)=>createHash('sha256').update(s).digest();
  app.get('/health',()=>{db.sql.prepare('SELECT 1').get();return {ok:true};});
  app.get<{Querystring:Record<string,string>}>('/webhooks/messenger',(req,res)=>{
    const q=req.query;
    if(q['hub.mode']!=='subscribe'||typeof q['hub.verify_token']!=='string'||typeof q['hub.challenge']!=='string'||
      !timingSafeEqual(hash(q['hub.verify_token']),hash(cfg.FB_VERIFY_TOKEN)))return res.code(403).send();
    return res.type('text/plain').send(q['hub.challenge']);
  });
  app.register(async hook=>{
    hook.removeContentTypeParser('application/json');
    hook.addContentTypeParser('application/json',{parseAs:'buffer'},(_req,body,done)=>done(null,body));
    hook.post('/webhooks/messenger',(req,res)=>{
      const raw=req.body as Buffer;
      if(!validSignature(raw,req.headers['x-hub-signature-256'],cfg.FB_APP_SECRET))return res.code(403).send();
      let events;
      try {events=parseEvents(JSON.parse(raw.toString('utf8')),cfg.FB_PAGE_ID);}catch{return res.code(400).send();}
      db.enqueue(events);
      setImmediate(pump);
      return res.send('EVENT_RECEIVED');
    });
  });
  const guard=(id:string)=>{if(!inWindow(db.get<number>(id,'last')))throw new Error('Hết cửa sổ Messenger 24h');};
  const send=(id:string,message:object,type='RESPONSE')=>graph.send({recipient:{id},messaging_type:type,message},()=>guard(id));
  const action=(id:string,sender_action:string)=>graph.send({recipient:{id},sender_action},()=>guard(id));
  async function text(id:string,body:string,options?:Choice[],type='RESPONSE',signal?:AbortSignal) {
    const parts=splitMessenger(body);
    for(const [i,part] of parts.entries()) {
      signal?.throwIfAborted();
      const quick=options?.map(o=>({content_type:'text',title:o.title,payload:o.payload}));
      await send(id,{text:part,...(quick?.length && i===parts.length-1 ? {quick_replies:quick}:{})},type);
    }
    onText?.(id,body);
  }
  async function handle(e:PageEvent) {
    if(e.kind==='chat'||e.kind==='reaction') {
      // Webhook cũ chỉ được cập nhật theo thời điểm sự kiện, không theo thời điểm nhận.
      if(e.at<=Date.now()) db.set(e.user,'last',Math.max(db.get<number>(e.user,'last')??0,e.at));
    }
    if(e.kind==='chat'&&!inWindow(db.get<number>(e.user,'last')))return;
    if(e.kind==='chat'&&!db.get(e.user,'welcomed')) {
      await text(e.user,'Xin chào! Mình là Bekane, chatbot AI của Page. I’m the Page’s AI assistant.');
      db.set(e.user,'welcomed',true);
    }
    if(await onEvent?.(e))return;
    if(e.kind!=='chat'||!receive)return;
    await action(e.user,'mark_seen').catch(err=>log(String(err)));
    try { await receive(e.msg); await afterChat?.(e.msg); }
    finally {await action(e.user,'typing_off').catch(err=>log(String(err)));}
  }
  function pump() {
    if(!receive||stopped)return;
    for(const e of db.pending()) {
      const stop=e.kind==='chat'&&e.msg.text==='/stop';
      if(active.size>=8 || active.has(e.key) || busy.has(e.user)&&!stop)continue;
      if(!stop)busy.add(e.user);
      const task=handle(e).then(()=>db.done(e.key),err=>{log(String(err));db.retry(e.key);})
        .finally(()=>{active.delete(e.key);if(!stop)busy.delete(e.user);});
      active.set(e.key,task);
    }
  }
  let finish:()=>void=()=>{};
  const lifetime=new Promise<void>(resolve=>{finish=resolve;});
  const adapter:ChannelAdapter={
    channel:'messenger',maxText:1999,split:splitMessenger,
    send:(m,s,signal)=>text(m.threadId,s,replyChoices?.(m,s),'RESPONSE',signal),
    choices:(m,s,options)=>text(m.threadId,s,options),
    media:(id,type,url)=>send(id,{attachment:{type,payload:{url}}}),
    notify:(id,s)=>text(id,s,undefined,'UPDATE'),
    typing:(m)=>action(m.threadId,'typing_on'),
    async downloadImage(a,signal) {const f=await attachment(a.fileId,signal);
      if(!/^image\/(png|jpe?g|gif|webp)$/.test(f.mime))return null;
      return 'data:'+f.mime+';base64,'+f.bytes.toString('base64');},
    async start(handler){receive=handler;await app.listen({port:cfg.PORT,host:'0.0.0.0'});timer=setInterval(pump,250);await lifetime;},
    stop(){stopped=true;clearInterval(timer);finish();},
    async close(){stopped=true;clearInterval(timer);await app.close();await Promise.allSettled(active.values());},
  };
  let replyChoices:((msg:IncomingMessage,text:string)=>Choice[]|undefined)|undefined;
  return {adapter,app,db,graph,text,guard, pump,bind(handler:NonNullable<typeof receive>){receive=handler;},
    suggestions(handler:NonNullable<typeof replyChoices>){replyChoices=handler;},
    use(handler:NonNullable<typeof onEvent>){onEvent=handler;},after(handler:NonNullable<typeof afterChat>){afterChat=handler;},
    observe(handler:NonNullable<typeof onText>){onText=handler;},
    async template(id:string,template_type:'button'|'generic',body:object) {await send(id,{attachment:{type:'template',payload:{template_type,...body}}});}};
}
export type Messenger = ReturnType<typeof createMessenger>;
