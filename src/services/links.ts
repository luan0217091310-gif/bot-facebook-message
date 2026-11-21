import { randomBytes, createHash } from 'node:crypto';
import type { Repository } from '../repository.js';
import type { IncomingMessage } from '../types.js';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');

export function accountLinks(db: Repository) {
  return {
    issue(psid: string) {
      const code = randomBytes(16).toString('hex');
      db.set(psid, 'linkChallenge', { hash: digest(code), until: Date.now() + 600000 });
      return code;
    },
    redeem(msg: IncomingMessage) {
      if (msg.isGroup || msg.threadId !== msg.senderId) return false;
      const match = /^\/link ([a-f\d]{32})$/.exec(msg.text.trim());
      if (!match) return false;
      return db.transaction(() => {
        const row = db.sql
          .prepare("SELECT owner FROM state WHERE name='linkChallenge' AND json_extract(value,'$.hash')=? AND json_extract(value,'$.until')>?")
          .get(digest(match[1]), Date.now());
        if (!row) return false;
        const psid = String(row.owner);
        db.sql.prepare("DELETE FROM state WHERE name='telegram' AND value=?").run(JSON.stringify(msg.senderId));
        db.set(psid, 'telegram', msg.senderId);
        db.remove(psid, 'linkChallenge');
        return true;
      });
    },
    linkedPsid(telegramUserId: string): string | undefined {
      const row = db.sql.prepare("SELECT owner FROM state WHERE name='telegram' AND value=?").get(JSON.stringify(telegramUserId));
      return row ? String(row.owner) : undefined;
    },
    unlinkTelegram(telegramUserId: string): boolean {
      const res = db.sql.prepare("DELETE FROM state WHERE name='telegram' AND value=?").run(JSON.stringify(telegramUserId));
      return Number(res.changes) > 0;
    },
    unlink(psid: string) {
      db.remove(psid, 'telegram');
      db.remove(psid, 'linkChallenge');
    },
  };
}
