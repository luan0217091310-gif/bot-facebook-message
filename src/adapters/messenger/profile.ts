import 'dotenv/config';
import {messengerConfig} from './config.js';
import {Graph} from './graph.js';

export const menu=[['Trợ giúp','/help'],['Dừng','/stop'],['Ghi nhớ','/memories'],['Lời nhắc','/reminders'],['Theo dõi web','/watches']];
export async function setup(graph:Graph) {
  const call_to_actions=menu.map(([title,payload])=>({type:'postback',title,payload}));
  await graph.post(graph.cfg.FB_PAGE_ID+'/messenger_profile',{
    greeting:[{locale:'default',text:'Xin chào! Bekane là chatbot AI của Page.'}],
    get_started:{payload:'/start'},
    persistent_menu:[{locale:'default',composer_input_disabled:false,call_to_actions}],
    ice_breakers:[{locale:'default',call_to_actions:[{question:'Bot giúp gì được?',payload:'/help'},{question:'Đặt lịch hẹn',payload:'/book'}]}],
  });
}
