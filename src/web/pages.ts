const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function privacyHtml(p: { owner: string; contact: string }): string {
  const owner = esc(p.owner), contact = esc(p.contact);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chính sách bảo mật</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 16px;color:#1d1d1f;background:#fff}h1,h2{line-height:1.25}</style></head><body>
<h1>Chính sách bảo mật — Bekane Bot</h1>
<p>Bekane là chatbot AI (trợ lý tự động) do <b>${owner}</b> vận hành trên Facebook Messenger và Telegram.</p>
<h2>Dữ liệu chúng tôi thu thập</h2>
<ul><li>ID theo Page (PSID) hoặc ID Telegram, nội dung tin nhắn, tệp, ảnh và tin thoại bạn gửi cho bot.</li>
<li>Thông tin bạn chủ động cung cấp (ví dụ tên, số điện thoại, thời gian khi đặt lịch hẹn) và các ghi nhớ bạn yêu cầu bot lưu.</li>
<li>Số liệu kỹ thuật ẩn danh: số tin nhắn, thời gian phản hồi, lỗi.</li></ul>
<h2>Mục đích sử dụng</h2>
<p>Chỉ để trả lời bạn, thực hiện nhắc lịch/theo dõi website bạn yêu cầu, chuyển cho nhân viên khi cần và cải thiện chất lượng dịch vụ. Chúng tôi không bán dữ liệu và không dùng để quảng cáo.</p>
<h2>Bên thứ ba</h2>
<p>Nội dung tin nhắn được gửi tới nhà cung cấp mô hình AI (OpenAI hoặc Google Gemini) và công cụ tìm kiếm web để tạo câu trả lời, theo điều khoản của các nhà cung cấp đó.</p>
<h2>Lưu trữ và xoá</h2>
<p>Lịch sử hội thoại chỉ giữ số tin nhắn gần nhất. Bạn có thể gõ <b>/data</b> (xem dữ liệu của tôi) hoặc <b>/delete</b> (xoá dữ liệu của tôi) bất cứ lúc nào trong Messenger. Bạn cũng có thể gỡ app trong Cài đặt Facebook; yêu cầu xoá sẽ được xử lý trong vòng 30 ngày.</p>
<h2>Liên hệ</h2><p>${contact}</p></body></html>`;
}

/** Dashboard một trang, không dùng thư viện ngoài. Mọi nội dung người dùng được gán bằng textContent để chống XSS. */
export function dashboardHtml(): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bekane Dashboard</title><style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1c1e21;--muted:#65676b;--line:#dadde1;--accent:#0866ff;--warn:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#18191a;--card:#242526;--fg:#e4e6eb;--muted:#b0b3b8;--line:#3a3b3c;--accent:#4b8dff;--warn:#ff6b5e}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;gap:12px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--card);flex-wrap:wrap}
header b{margin-right:auto}nav button,button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:6px 10px;cursor:pointer}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}button.danger{color:var(--warn)}
main{padding:16px;max-width:1200px;margin:auto}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.kpi b{display:block;font-size:22px}
.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:12px}@media(max-width:760px){.split{grid-template-columns:1fr}}
.row{padding:8px;border-bottom:1px solid var(--line);cursor:pointer}.row:hover{background:var(--bg)}.muted{color:var(--muted)}
.msg{padding:6px 10px;border-radius:10px;margin:4px 0;max-width:85%;white-space:pre-wrap;word-break:break-word}.user{background:var(--bg)}.assistant{background:var(--accent);color:#fff;margin-left:auto}
textarea,input{width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);font:inherit}
.tag{font-size:12px;padding:1px 6px;border-radius:10px;border:1px solid var(--line);margin-left:4px}table{width:100%;border-collapse:collapse}td{padding:4px;border-bottom:1px solid var(--line)}
</style></head><body>
<div id="login" class="card" style="max-width:360px;margin:15vh auto"><h2>Đăng nhập dashboard</h2>
<input id="pw" type="password" placeholder="DASHBOARD_PASSWORD" autocomplete="current-password"><p></p><button class="primary" id="go">Đăng nhập</button><p id="lerr" class="muted"></p></div>
<div id="app" hidden><header><b>Bekane Dashboard</b><nav><button data-v="stats">Thống kê</button> <button data-v="convos">Hội thoại</button> <button data-v="kb">Kho kiến thức</button></nav><button id="out">Đăng xuất</button></header><main id="view"></main></div>
<script>
const $=(t,p={},...c)=>{const e=document.createElement(t);for(const[k,v]of Object.entries(p))k.startsWith('on')?e.addEventListener(k.slice(2),v):k==='text'?e.textContent=v:e.setAttribute(k,v);e.append(...c);return e};
async function api(path,opt={}){const r=await fetch('/dashboard/api'+path,{...opt,headers:{'x-bekane':'1','content-type':'application/json'}});
 if(r.status===401){show(false);throw new Error('401')}const j=await r.json().catch(()=>({}));if(!r.ok){alert(j.error||r.status);throw new Error(j.error)}return j}
const view=()=>document.getElementById('view');const t=ms=>ms?new Date(ms).toLocaleString('vi-VN'):'—';
function show(on){document.getElementById('login').hidden=on;document.getElementById('app').hidden=!on;if(on)stats()}
document.getElementById('go').onclick=async()=>{const r=await fetch('/dashboard/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});
 if(r.ok)show(true);else document.getElementById('lerr').textContent=(await r.json()).error};
document.getElementById('out').onclick=async()=>{await fetch('/dashboard/logout',{method:'POST'});show(false)};
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>({stats,convos,kb})[b.dataset.v]());
async function stats(){const s=await api('/stats?days=7');const v=view();v.replaceChildren($('h2',{text:'Thống kê 7 ngày'}));
 for(const[ch,m]of Object.entries(s)){if(!m){v.append($('p',{class:'muted',text:ch+': chưa có số liệu (STORAGE=file)'}));continue}
  const k=(l,x)=>$('div',{class:'card kpi'},$('span',{class:'muted',text:l}),$('b',{text:String(x)}));
  v.append($('h3',{text:ch}),$('div',{class:'grid'},k('Tin nhắn đến',m.messagesIn),k('Tin đã gửi',m.messagesOut),k('Người dùng hoạt động',m.activeUsers),
   k('Phản hồi TB (ms)',m.avgLatencyMs),k('P95 (ms)',m.p95LatencyMs),k('Token',m.tokens),k('Chi phí ước tính ($)',m.estimatedCostUsd),k('Lỗi',m.errors)),
   $('div',{class:'card'},$('b',{text:'Tool dùng nhiều nhất'}),$('table',{},...m.topTools.map(x=>$('tr',{},$('td',{text:x.name}),$('td',{text:String(x.count)}))))),
   $('div',{class:'card'},$('b',{text:'Theo ngày'}),$('table',{},...m.daily.map(x=>$('tr',{},$('td',{text:x.day}),$('td',{text:x.messages+' tin'}),$('td',{text:x.users+' người'}))))))}}
async function convos(){const list=await api('/conversations');const left=$('div',{class:'card'}),right=$('div',{class:'card'},$('p',{class:'muted',text:'Chọn một hội thoại.'}));
 view().replaceChildren($('div',{class:'split'},left,right));
 if(!list.length)left.append($('p',{class:'muted',text:'Chưa có hội thoại (cần STORAGE=sqlite).'}));
 for(const c of list)left.append($('div',{class:'row',onclick:()=>open(c.channel,c.id,right)},$('b',{text:c.id}),$('span',{class:'tag',text:c.channel}),
  c.paused?$('span',{class:'tag',text:'tạm dừng'}):'',c.handoff?$('span',{class:'tag',text:'người thật'}):'',$('div',{class:'muted',text:t(c.lastAt)+' · '+c.preview})))}
async function open(ch,id,box){const c=await api('/conversations/'+ch+'/'+id);const reload=()=>open(ch,id,box);
 const post=(p,b)=>api('/conversations/'+ch+'/'+id+p,{method:'POST',body:JSON.stringify(b)}).then(reload);
 const del=(k,i)=>confirm('Xoá?')&&api('/items/'+ch+'/'+k+'/'+encodeURIComponent(i),{method:'DELETE'}).then(reload);
 const ta=$('textarea',{rows:'3',placeholder:'Trả lời với tư cách nhân viên…'});
 box.replaceChildren($('h3',{text:ch+' · '+id}),
  $('p',{},$('button',{onclick:()=>post('/pause',{paused:!c.paused}),text:c.paused?'Bật lại bot':'Tắt bot với người này'}),' ',
   ch==='messenger'?$('button',{onclick:()=>post('/handoff',{minutes:c.handoffUntil>Date.now()?0:60}),text:c.handoffUntil>Date.now()?'Kết thúc chuyển người thật':'Chuyển người thật 60 phút'}):'',
   $('span',{class:'muted',text:ch==='messenger'?' · Khách nhắn lần cuối: '+t(c.lastUserAt):''})),
  $('div',{},...c.history.map(h=>$('div',{class:'msg '+h.role,title:t(h.at),text:h.text}))),
  ta,$('p',{},$('button',{class:'primary',onclick:()=>ta.value.trim()&&post('/reply',{text:ta.value}),text:'Gửi'})),
  $('h4',{text:'Ghi nhớ'}),$('table',{},...c.facts.map(f=>$('tr',{},$('td',{text:f.text||f.content||JSON.stringify(f)}),$('td',{},$('button',{class:'danger',onclick:()=>del('fact',f.id),text:'Xoá'}))))),
  $('h4',{text:'Lời nhắc'}),$('table',{},...c.reminders.map(r=>$('tr',{},$('td',{text:t(r.dueAt)}),$('td',{text:r.note}),$('td',{},$('button',{class:'danger',onclick:()=>del('reminder',r.id),text:'Huỷ'}))))),
  $('h4',{text:'Website theo dõi'}),$('table',{},...c.watches.map(w=>$('tr',{},$('td',{text:w.label}),$('td',{text:w.url}),$('td',{},$('button',{class:'danger',onclick:()=>del('watch',w.id),text:'Bỏ'}))))))}
async function kb(){const list=await api('/kb');const src=$('input',{placeholder:'Tên nguồn (vd: Bảng giá 2026)'}),body=$('textarea',{rows:'10',placeholder:'Dán nội dung FAQ / bảng giá / chính sách…'});
 view().replaceChildren($('h2',{text:'Kho kiến thức'}),$('p',{class:'muted',text:'Bot chỉ trả lời từ tài liệu này kèm nguồn; nội dung được coi là dữ liệu, không phải lệnh.'}),
  $('div',{class:'card'},src,$('p'),body,$('p',{},$('button',{class:'primary',onclick:async()=>{await api('/kb',{method:'POST',body:JSON.stringify({source:src.value,body:body.value})});kb()},text:'Nạp / thay thế'}))),
  $('table',{},...list.map(k=>$('tr',{},$('td',{text:k.source}),$('td',{text:k.passages+' đoạn'}),$('td',{},$('button',{class:'danger',onclick:async()=>{if(confirm('Xoá nguồn?')){await api('/kb/'+encodeURIComponent(k.source),{method:'DELETE'});kb()}},text:'Xoá'}))))))}
api('/stats?days=1').then(()=>show(true),()=>{});
</script></body></html>`;
}
