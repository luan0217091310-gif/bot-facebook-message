import {createHmac} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {MessengerConfig} from './config.js';

export class GraphError extends Error {
  constructor(readonly category: 'window'|'credential'|'blocked'|'rate'|'temporary'|'invalid', readonly code: number) {
    super('Graph API: '+category+' ('+code+')');
  }
}
export class Graph {
  constructor(readonly cfg: MessengerConfig, private http: typeof fetch = fetch) {}
  async post(path: string, data: object, guard?: () => void) {
    const proof=createHmac('sha256',this.cfg.FB_APP_SECRET).update(this.cfg.FB_PAGE_ACCESS_TOKEN).digest('hex');
    for (let attempt=0;;attempt++) {
      guard?.();
      const response=await this.http('https://graph.facebook.com/'+this.cfg.GRAPH_API_VERSION+'/'+path+'?appsecret_proof='+proof,{
        method:'POST',headers:{Authorization:'Bearer '+this.cfg.FB_PAGE_ACCESS_TOKEN,'Content-Type':'application/json'},
        body:JSON.stringify(data),signal:AbortSignal.timeout(12000),redirect:'error'});
      const body=await response.json() as {error?:{code:number;error_subcode?:number;is_transient?:boolean}};
      if (response.ok && !body.error) return;
      const code=body.error?.code ?? response.status, sub=body.error?.error_subcode;
      const category=code===190 ? 'credential' : sub===2018278 || code===10 && sub===2018065 ? 'window'
        : code===551 ? 'blocked' : [4,17,32,613,429].includes(code) || response.status===429 ? 'rate'
        : body.error?.is_transient || response.status>=500 ? 'temporary' : 'invalid';
      if (attempt>=2 || !['rate','temporary'].includes(category)) throw new GraphError(category,code);
      const wait=Math.max(250*2**attempt,Number(response.headers.get('retry-after') ?? 0)*1000);
      if (wait>30000) throw new GraphError(category,code);
      await delay(wait+Math.random()*100);
    }
  }
  send(body: object, guard?:()=>void) { return this.post(this.cfg.FB_PAGE_ID+'/messages',body,guard); }
}
