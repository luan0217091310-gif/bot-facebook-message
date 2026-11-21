import {DAY,inWindow,type Messenger} from './adapter.js';
import type {PageEvent} from './events.js';
export function notifications(m:Messenger,opts:{otn:boolean;log:(s:string)=>void;fallback?:(id:string,text:string)=>Promise<boolean>}) {
  const {db,graph}=m;
  async function plan(id:string,job:string,title:string,due?:number) {
    const last=db.get<number>(id,'last');
    if(due && last && due<last+DAY)return '';
    const info='Nếu không gửi được, bot sẽ báo khi bạn nhắn lại.';
    if(!opts.otn||!inWindow(last))return info;
    db.set(id,'request:'+job,true);
    try {
      await graph.send({recipient:{id},messaging_type:'RESPONSE',message:{attachment:{type:'template',payload:{
        template_type:'one_time_notif_req',title:('Nhắc tôi: '+title).slice(0,65),payload:job}}}},()=>m.guard(id));
      return 'Hãy chạm Nhắc tôi để cho phép một thông báo. '+info;
    } catch(e){opts.log(String(e));return info;}
  }
  function accept(e:Extract<PageEvent,{kind:'optin'}>) {
    if(!opts.otn||!db.get(e.user,'request:'+e.job))return;
    db.transaction(()=>{db.remove(e.user,'request:'+e.job);db.set(e.user,'otn:'+e.job,{token:e.token,until:e.at+365*DAY});});
  }
  async function notify(id:string,text:string,_topic?:number,job='notice') {
    try {
      if(inWindow(db.get(id,'last'))) {await m.text(id,text,undefined,'UPDATE');return;}
      const consent=db.get<{token:string;until:number}>(id,'otn:'+job);
      if(consent && opts.otn && consent.until>Date.now()) {
        // Thu hồi trước khi gọi mạng. Timeout không chứng minh Meta chưa gửi.
        db.remove(id,'otn:'+job);
        await graph.send({recipient:{one_time_notif_token:consent.token},message:{text:text.slice(0,1999)}});
        return;
      }
    } catch(e){opts.log(String(e));}
    try {if(await opts.fallback?.(id,text))return;}catch{opts.log('Gửi thông báo liên kết Telegram thất bại.');}
    db.set(id,'missed',[...(db.get<string[]>(id,'missed')??[]),text]);
  }
  async function flush(id:string){
    for (;;) {
      const items=db.get<string[]>(id,'missed')??[];
      if(!items.length)return;
      await m.text(id,'Bạn có lời nhắc hoặc cập nhật bị lỡ:\n'+items[0]);
      db.set(id,'missed',(db.get<string[]>(id,'missed')??[]).slice(1));
    }
  }
  return {plan,notify,accept,flush};
}
