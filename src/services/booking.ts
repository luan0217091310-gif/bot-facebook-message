import {randomUUID} from 'node:crypto';
import type {Repository} from '../repository.js';
type Draft={name?:string;phone?:string;time?:string;misses?:number};

/** Câu cho phép thoát khỏi luồng đặt lịch ở bất kỳ bước nào. */
const CANCEL=/^(\/cancel|\/stop|hủy|huỷ|cancel|thôi|dừng|stop)\b|không (đặt|muốn đặt)( lịch)?( nữa)?|huỷ đặt|hủy đặt|thôi không/i;
const MAX_MISSES=3;
/** Khách không muốn để lại số: liên hệ qua Messenger thay thế. */
const NO_PHONE=/bỏ qua|bo qua|skip|không có|khong co|không muốn|theo web|qua web|nhắn (qua|ở) đây|qua messenger|qua mess|nhắn tin|inbox|no phone/i;

/**
 * Tìm số điện thoại trong câu tự do: chấp nhận dấu chấm, gạch, cách, ngoặc và tiền tố +84.
 * Ví dụ: "sđt mình 0912.345.678", "+84 912 345 678", "(028) 3822-1234".
 */
export function findPhone(text:string):string|undefined{
  for(const m of text.matchAll(/\+?\d[\d .()\-]{6,20}\d/g)){
    const digits=m[0].replace(/\D/g,'');
    if(digits.length>=9 && digits.length<=12)return (m[0].trim().startsWith('+')?'+':'')+digits;
  }
  return undefined;
}

export function booking(db:Repository,id:string,text:string,en:boolean,start:boolean){
  const draft=db.get<Draft>(id,'bookingDraft');
  if(start){db.set(id,'bookingDraft',{});return {text:en?'What is your name? (type "cancel" to stop)':'Bạn tên gì? (gõ "huỷ" để dừng)'};}
  if(!draft)return;
  const t=text.trim();
  if(CANCEL.test(t)){db.remove(id,'bookingDraft');return {text:en?'Booking cancelled.':'Đã huỷ đặt lịch.'};}
  // Lệnh khác (/help, /memories…) thoát luồng đặt lịch để lệnh đó chạy bình thường.
  if(t.startsWith('/')){db.remove(id,'bookingDraft');return;}

  // Sai nhiều lần liên tiếp thì thoát, tránh kẹt người dùng trong vòng hỏi lại.
  const miss=(vi:string,enText:string)=>{
    draft.misses=(draft.misses??0)+1;
    if(draft.misses>=MAX_MISSES){db.remove(id,'bookingDraft');
      return {text:en?'Let’s stop the booking for now. Type /book to start again or /human to reach staff.':'Mình tạm dừng đặt lịch nhé. Gõ /book để làm lại hoặc /human để gặp nhân viên.'};}
    db.set(id,'bookingDraft',draft);return {text:en?enText:vi};
  };
  const ok=()=>{draft.misses=0;db.set(id,'bookingDraft',draft);};

  if(!draft.name){
    if(t.length<2||t.length>100)return miss('Nhập tên từ 2 đến 100 ký tự.','Please enter your full name.');
    const phone=findPhone(t);
    draft.name=(phone?t.replace(/\+?\d[\d .()\-]{6,20}\d/,'').replace(/[,;:\-–]+\s*$/,'').trim():t)||t;
    if(phone)draft.phone=phone;
    ok();
    if(!draft.phone)return {text:en?'What phone number can we use?':'Bạn muốn Page liên hệ qua số điện thoại nào?'};
    return {text:en?'What date and time would you prefer?':'Bạn muốn hẹn ngày nào, lúc mấy giờ?'};
  }
  if(!draft.phone){
    const phone=findPhone(t) ?? (NO_PHONE.test(t)?(en?'Contact via Messenger':'Liên hệ qua Messenger'):undefined);
    if(!phone)return miss('Mình chưa thấy số điện thoại. Bạn gửi dạng 0912 345 678, gõ "bỏ qua" để Page nhắn qua Messenger, hoặc "huỷ" để dừng.',
      'I couldn’t find a phone number. Send it like +84 912 345 678, type "skip" to be contacted on Messenger, or "cancel" to stop.');
    draft.phone=phone;ok();
    return {text:en?'What date and time would you prefer?':'Bạn muốn hẹn ngày nào, lúc mấy giờ?'};
  }
  if(!draft.time){
    if(t.length<3||t.length>120)return miss('Vui lòng ghi ngày và giờ mong muốn, ví dụ "9h sáng thứ 7".','Enter the date and time, e.g. "Saturday 9am".');
    draft.time=t;ok();
  } else if(/^(ok|đồng ý|dong y|yes|confirm|lưu|xác nhận)$/i.test(t)){
    const ref=randomUUID();
    const {misses:_,...saved}=draft;
    db.transaction(()=>{db.set(id,'booking:'+ref,saved);db.remove(id,'bookingDraft');});
    return {text:en?'Request saved. Staff will confirm availability.':'Đã lưu yêu cầu. Nhân viên sẽ xác nhận khung giờ còn trống.',ref};
  }
  return {text:[draft.name,draft.phone,draft.time].join(' · ')+(en?' — Save this request?':' — Lưu yêu cầu này?'),confirm:true};
}
