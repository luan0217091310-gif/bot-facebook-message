import type {Messenger} from '../adapters/messenger/adapter.js';
import {DAY,inWindow} from '../adapters/messenger/adapter.js';
import {attachment} from '../adapters/messenger/media.js';
import type {PageEvent} from '../adapters/messenger/events.js';
import {menu} from '../adapters/messenger/profile.js';
import type {createBrain} from '../brain.js';
import {booking} from './booking.js';
import {knowledge,extract} from './documents.js';
import {language} from './language.js';
import {accountLinks} from './links.js';

type Brain=ReturnType<typeof createBrain>;
interface PageOptions {
  alert:(s:string)=>Promise<void>; log:(s:string)=>void; handoffMinutes:number; comments:boolean;
  download?:typeof attachment; transcribe:(bytes:Buffer,mime:string,name:string)=>Promise<string>;
  summarize:(question:string,document:string,en:boolean)=>Promise<string>; linked:boolean; rate:number;
  clean:(s:string)=>string;
}
export function pageServices(m:Messenger,brain:Brain,opts:PageOptions) {
  const {db}=m, kb=knowledge(db), links=accountLinks(db);
  function transcript(id:string,role:string,text:string){
    const history=db.get<Array<{at:number;role:string;text:string}>>(id,'transcript')??[];
    db.set(id,'transcript',[...history.slice(-99),{at:Date.now(),role,text:opts.clean(text.slice(0,6000))}]);
  }
  m.observe((id,text)=>transcript(id,'page',text));
  const staff=(s:string)=>opts.alert(s).catch(e=>opts.log(String(e)));
  async function handoff(id:string,en:boolean) {
    db.set(id,'handoff',Date.now()+opts.handoffMinutes*60000);
    await m.text(id,en?'I’ve paused the bot and asked a staff member to join.':'Mình đã tạm dừng bot và báo nhân viên vào hỗ trợ bạn.');
    await staff('Cần nhân viên hỗ trợ hội thoại '+id);
  }
  function data(id:string){
    const fields=db.sql.prepare("SELECT name,value FROM state WHERE owner=? AND (name IN ('telegram','document','transcript','missed','bookingDraft','language','handoff') OR name LIKE 'booking:%')").all(id);
    return {psid:id,records:fields.map(r=>({name:r.name,value:JSON.parse(String(r.value))})),
      history:brain.history.recent(id),facts:brain.facts.search({threadId:id,senderId:id,isGroup:false},10000),
      reminders:brain.reminders.list(id),watches:brain.watches.list(id)};
  }
  function erase(id:string){
    brain.dispatcher.cancel(id);
    brain.history.clear(id);brain.facts.eraseThread(id);
    for(const r of brain.reminders.list(id))brain.reminders.remove(r.id,id);
    for(const w of brain.watches.list(id))brain.watches.remove(w.id,id);
    brain.settings.remove(id);
    db.transaction(()=>{ db.sql.prepare('DELETE FROM state WHERE owner=?').run(id);
      db.sql.prepare('DELETE FROM inbox WHERE owner=?').run(id);});
  }
  async function comment(e:Extract<PageEvent,{kind:'comment'}>) {
    if(!opts.comments || !inWindow(e.at,Date.now(),7*DAY) || !/\?|tư vấn|liên hệ|inbox|contact|help|giá/i.test(e.body))return;
    const en=language(e.body)==='en';
    for(const privateReply of [false,true]){
      const key=(privateReply?'private:':'public:')+e.comment;
      if(db.get(e.user,key))continue;
      // Chặn gửi lặp nếu Meta đã nhận nhưng kết nối mất trước khi trả kết quả.
      db.set(e.user,key,'sending');
      try{
        if(privateReply)await m.graph.send({recipient:{comment_id:e.comment},message:{text:en?'How can our Page help with your comment?':'Chào bạn, Page có thể hỗ trợ gì thêm cho bình luận của bạn?'}},()=>{if(!inWindow(e.at,Date.now(),7*DAY))throw new Error('Hết hạn Private Reply');});
        else await m.graph.post(e.comment+'/comments',{message:en?'Thanks for asking. Please check Messenger.':'Cảm ơn bạn đã hỏi. Bạn xem thêm trong Messenger nhé.'});
        db.set(e.user,key,'sent');
      }catch(err){await staff('Kiểm tra phản hồi bình luận '+e.comment+': '+String(err));}
    }
  }
  const suggest=(en:boolean)=>en?[{title:'Book an appointment',payload:'/book'},{title:'Talk to staff',payload:'/human'}]:
    [{title:'Đặt lịch hẹn',payload:'/book'},{title:'Gặp nhân viên',payload:'/human'},{title:'Trợ giúp',payload:'/help'}];
  async function handle(e:PageEvent):Promise<boolean>{
    if(e.kind==='comment'){await comment(e);return true;}
    if(e.kind!=='chat')return false;
    const id=e.user,msg=e.msg,t=msg.text.trim(),cmd=t.toLocaleLowerCase('vi');
    const en=language(t,db.get(id,'language'))==='en';db.set(id,'language',en?'en':'vi');
    const rate=db.get<{at:number;n:number}>(id,'rate');
    const bucket=rate && Date.now()-rate.at<60000?rate:{at:Date.now(),n:0};
    db.set(id,'rate',{at:bucket.at,n:++bucket.n});
    if(bucket.n>opts.rate && cmd!=='/stop'){
      if(bucket.n===opts.rate+1)await m.text(id,en?'Please wait one minute.':'Bạn đợi một phút rồi thử lại nhé.');
      return true;
    }
    transcript(id,'user',t || '['+(msg.attachments?.[0]?.kind??'attachment')+']');
    if(cmd==='/delete confirm' && (db.get<number>(id,'deleteUntil')??0)>Date.now()){
      await m.text(id,en?'Your deletion request is being processed.':'Mình đang xoá dữ liệu của bạn.');erase(id);return true;
    }
    if(['/delete','xoá dữ liệu của tôi','xóa dữ liệu của tôi','delete my data'].includes(cmd)){
      db.set(id,'deleteUntil',Date.now()+300000);
      await m.text(id,en?'Delete all your Page bot data?':'Xoá toàn bộ dữ liệu của bạn tại bot Page?',[
        {title:en?'Delete':'Đồng ý xoá',payload:'/delete confirm'},{title:en?'Cancel':'Huỷ',payload:'/cancel'}]);return true;
    }
    if(cmd==='/cancel'){db.remove(id,'deleteUntil');db.remove(id,'bookingDraft');await m.text(id,en?'Cancelled.':'Đã huỷ.');return true;}
    if(['/data','xem dữ liệu của tôi','show my data'].includes(cmd)){await m.text(id,JSON.stringify(data(id),null,2));return true;}
    if(cmd==='/unlink'){links.unlink(id);await m.text(id,en?'Telegram disconnected.':'Đã ngắt liên kết Telegram.');return true;}
    if(cmd==='/link' && opts.linked){await m.text(id,(en?'In a private chat with our Telegram bot, send: ':'Để nhận nhắc lỡ qua Telegram, trong chat riêng với bot Telegram gửi: ')+'/link '+links.issue(id));return true;}
    if((db.get<number>(id,'handoff')??0)>Date.now())return true;
    if(db.get(id,'handoff')){db.remove(id,'handoff');await m.text(id,en?'Bekane AI is back.':'Bekane, chatbot AI, đã tiếp quản lại.');}
    if(brain.settings.get(id).paused && !['/resume','/status','/id','/help','/stop'].includes(cmd))return true;
    if(['/human','gặp nhân viên','chuyển cho người thật','talk to a human','talk to staff'].includes(cmd)){await handoff(id,en);return true;}
    if(['/help','/start','trợ giúp','help'].includes(cmd)){
      await m.text(id,en?'I’m Bekane AI. Send a question, file or voice message. Use /book, /faq, /data, /delete or /human.':'Mình là Bekane AI. Gửi câu hỏi, tệp hoặc tin thoại. Gõ /book, /faq, /data, /delete hoặc /human. Dùng /id để lấy PSID.',
        menu.map(([title,payload])=>({title,payload})));return true;
    }
    const result=booking(db,id,t,en,['/book','đặt lịch hẹn','book an appointment'].includes(cmd));
    if(result){await m.text(id,result.text,result.confirm?[{title:en?'Confirm':'Đồng ý',payload:'ok'},{title:en?'Cancel':'Huỷ',payload:'/cancel'}]:undefined);
      if(result.ref)await staff('Có yêu cầu đặt lịch '+result.ref+' trong hội thoại '+id);return true;}
    const a=msg.attachments?.[0];
    if(a && ['audio','document'].includes(a.kind)){
      try{
        const f=await (opts.download??attachment)(a.fileId);
        if(a.kind==='audio') {msg.text=await opts.transcribe(f.bytes,f.mime,f.name); if(!msg.text.trim())throw new Error('Không nhận được lời nói.');return false;}
        if(f.mime.startsWith('image/')){a.kind='photo';return false;}
        const body=await extract(f.bytes,f.mime,f.name);
        if(!body.trim())throw new Error('Tệp không có lớp văn bản.');
        db.set(id,'document',{name:f.name,body});
        await m.text(id,await opts.summarize(t|| (en?'Summarize this document.':'Tóm tắt tài liệu này.'),body,en),suggest(en));return true;
      }catch(err){opts.log(String(err));await m.text(id,en?'I couldn’t read this file. Try TXT or a clearer recording.':'Mình chưa đọc được tệp. Bạn thử TXT hoặc gửi bản ghi âm rõ hơn nhé.');return true;}
    }
    if(cmd==='/close_file'){db.remove(id,'document');await m.text(id,en?'Document closed.':'Đã đóng tài liệu.');return true;}
    const doc=db.get<{body:string;name:string}>(id,'document');
    if(doc && !t.startsWith('/') && t && !a){await m.text(id,await opts.summarize(t,doc.body,en),suggest(en));return true;}
    const faq=/^\/faq(?:\s|$)/.test(cmd), hits=kb.search(t.replace(/^\/faq\s*/i,''));
    if(hits.length&&!t.startsWith('/')||faq&&hits.length){
      await m.text(id,hits.map(x=>x.passage+'\n'+(en?'Source: ':'Nguồn: ')+x.source).join('\n\n'),suggest(en));return true;}
    if(faq || /bảng giá|chính sách của (page|shop)|your pricing|your return policy/i.test(t)){
      await m.text(id,en?'I don’t have a source for that.':'Mình chưa có tài liệu xác nhận thông tin này.');await handoff(id,en);return true;}
    return false;
  }
  return {handle,data,erase,handoff,kb,links,suggest,transcript};
}
export type PageServices=ReturnType<typeof pageServices>;
