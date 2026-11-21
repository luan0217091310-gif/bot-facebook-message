import {randomUUID} from 'node:crypto';
import type {Repository} from '../repository.js';
type Draft={name?:string;phone?:string;time?:string};
export function booking(db:Repository,id:string,text:string,en:boolean,start:boolean){
  const draft=db.get<Draft>(id,'bookingDraft');
  if(start){db.set(id,'bookingDraft',{});return {text:en?'What is your name?':'Bạn tên gì?'};}
  if(!draft)return;
  if(/^(hủy|huỷ|cancel|thôi)$/i.test(text)){db.remove(id,'bookingDraft');return {text:en?'Cancelled.':'Đã huỷ.'};}
  if(!draft.name){
    if(text.trim().length<2||text.length>100)return {text:en?'Please enter your full name.':'Nhập tên từ 2 đến 100 ký tự.'};
    draft.name=text.trim();db.set(id,'bookingDraft',draft);
    return {text:en?'What phone number can we use?':'Bạn muốn Page liên hệ qua số điện thoại nào?'};
  }
  if(!draft.phone){
    if(!/^\+?[\d ()-]{8,20}$/.test(text)||text.replace(/\D/g,'').length<8)return {text:en?'Please check your phone number.':'Bạn kiểm tra lại số điện thoại nhé.'};
    draft.phone=text;db.set(id,'bookingDraft',draft);
    return {text:en?'What date and time would you prefer?':'Bạn muốn hẹn ngày nào, lúc mấy giờ?'};
  }
  if(!draft.time){
    if(text.length<3||text.length>120)return {text:en?'Enter the date and time.':'Vui lòng ghi ngày và giờ mong muốn.'};
    draft.time=text;db.set(id,'bookingDraft',draft);
  } else if(/^(ok|đồng ý|yes|confirm)$/i.test(text)){
    const ref=randomUUID();
    db.transaction(()=>{db.set(id,'booking:'+ref,draft);db.remove(id,'bookingDraft');});
    return {text:en?'Request saved. Staff will confirm availability.':'Đã lưu yêu cầu. Nhân viên sẽ xác nhận khung giờ còn trống.',ref};
  }
  return {text:[draft.name,draft.phone,draft.time].join(' · ')+(en?' — Save this request?':' — Lưu yêu cầu này?'),confirm:true};
}
