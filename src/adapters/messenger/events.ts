import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FileAttachment, IncomingMessage } from '../../types.js';

export function validSignature(raw: Buffer, header: unknown, secret: string) {
  if (typeof header !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  return timingSafeEqual(createHmac('sha256', secret).update(raw).digest(), Buffer.from(header.slice(7), 'hex'));
}
const id = z.string().regex(/^\d+$/);
const who = z.object({id});
const item = z.object({
  sender: who, recipient: who, timestamp: z.number().int().positive(),
  message: z.object({mid: z.string(), text: z.string().optional(), is_echo: z.boolean().optional(),
    quick_reply: z.object({payload: z.string()}).optional(),
    attachments: z.array(z.object({type: z.string(), payload: z.object({url: z.string().optional(), sticker_id: z.union([z.number(),z.string()]).optional()})})).optional()}).optional(),
  postback: z.object({mid: z.string().optional(), payload: z.string()}).optional(),
  optin: z.object({type: z.string().optional(),payload: z.string().optional(), one_time_notif_token: z.string().optional()}).optional(),
  reaction: z.object({mid: z.string(), action: z.string()}).optional(), read: z.unknown(), delivery: z.unknown(),
});
const envelope = z.object({object: z.string(), entry: z.array(z.object({id, messaging: z.array(z.unknown()).optional(), changes: z.array(z.unknown()).optional()}))});
export type PageEvent = {key: string; user: string; at: number} & (
  {kind: 'chat'; msg: IncomingMessage} | {kind: 'optin'; token: string; job: string} |
  {kind: 'reaction' | 'read' | 'delivery'} | {kind: 'comment'; comment: string; body: string});
const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const kinds: Record<string,FileAttachment['kind']> = {image:'photo',file:'document',audio:'audio',video:'video'};
const change = z.object({field:z.literal('feed'),value:z.object({item:z.literal('comment'),verb:z.literal('add'),
  comment_id:z.string().regex(/^[\d_]+$/),from:who,created_time:z.number(),message:z.string().default('')})});
export function parseEvents(raw: unknown, page: string): PageEvent[] {
  const batch = envelope.parse(raw);
  const out: PageEvent[] = [];
  if (batch.object !== 'page') return out;
  for (const e of batch.entry) {
    if (e.id !== page) continue;
    for (const v of e.changes ?? []) {
      const c=change.safeParse(v);
      if (!c.success || c.data.value.from.id === page) continue;
      const obj=c.data.value;
      out.push({kind:'comment', key:'comment:'+obj.comment_id, user:obj.from.id, at:obj.created_time*1000, comment:obj.comment_id,body:obj.message});
    }
    for (const v of e.messaging ?? []) {
      const result = item.safeParse(v);
      if (!result.success) continue;
      const m = result.data, user=m.sender.id;
      if (m.recipient.id !== page || user === page || m.message?.is_echo) continue;
      const base = {user, at:m.timestamp, key:fingerprint(v)};
      if (m.message || m.postback) {
        const key=m.message?.mid || m.postback?.mid || base.key;
        const attachments: FileAttachment[]=[];
        for (const a of m.message?.attachments ?? []) {
          const kind=a.payload.sticker_id ? 'sticker' : kinds[a.type];
          if (kind && a.payload.url) attachments.push({kind,fileId:a.payload.url});
        }
        out.push({...base,key,kind:'chat',msg:{threadId:user,senderId:user,msgId:key,isGroup:false,mentionsBot:false,
          text:m.message?.quick_reply?.payload ?? m.postback?.payload ?? m.message?.text ?? '',attachments}});
      } else if (m.optin?.one_time_notif_token && m.optin.payload) {
        out.push({...base,kind:'optin',token:m.optin.one_time_notif_token,job:m.optin.payload});
      } else if (m.reaction || m.read || m.delivery) out.push({...base,kind:m.reaction ? 'reaction' : m.read ? 'read' : 'delivery'});
    }
  }
  return out;
}
