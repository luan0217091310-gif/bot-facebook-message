import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PageEvent } from './adapters/messenger/events.js';

export class Repository {
  readonly sql: DatabaseSync;
  constructor(path: string) {
    if (path!==':memory:') mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.sql=new DatabaseSync(path);
    this.sql.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS state(owner TEXT, name TEXT, value TEXT NOT NULL, PRIMARY KEY(owner,name));
      CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY,owner TEXT NOT NULL,body TEXT,attempts INTEGER DEFAULT 0,available INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS inbox_pending ON inbox(available) WHERE body IS NOT NULL;
      INSERT OR IGNORE INTO migrations VALUES(1);`);
  }
  transaction<T>(work:()=>T): T {
    this.sql.exec('BEGIN IMMEDIATE');
    try {const value=work(); this.sql.exec('COMMIT'); return value;}
    catch(error) {this.sql.exec('ROLLBACK');throw error;}
  }
  get<T>(owner:string,name:string): T|undefined {
    const row=this.sql.prepare('SELECT value FROM state WHERE owner=? AND name=?').get(owner,name);
    return row ? JSON.parse(String(row.value)) as T : undefined;
  }
  set(owner:string,name:string,value:unknown) {
    this.sql.prepare('INSERT INTO state VALUES(?,?,?) ON CONFLICT(owner,name) DO UPDATE SET value=excluded.value').run(owner,name,JSON.stringify(value));
  }
  remove(owner:string,name:string) {this.sql.prepare('DELETE FROM state WHERE owner=? AND name=?').run(owner,name);}
  enqueue(events:PageEvent[]) {
    const insert=this.sql.prepare('INSERT OR IGNORE INTO inbox(id,owner,body) VALUES(?,?,?)');
    this.transaction(()=>{ for (const e of events) insert.run(e.key,e.user,JSON.stringify(e)); });
  }
  pending(): PageEvent[] {
    return this.sql.prepare('SELECT body FROM inbox WHERE body IS NOT NULL AND available<=? ORDER BY rowid LIMIT 128')
      .all(Date.now()).map(r=>JSON.parse(String(r.body)) as PageEvent);
  }
  done(id:string) {this.sql.prepare('UPDATE inbox SET body=NULL WHERE id=?').run(id);}
  retry(id:string) {
    this.sql.prepare('UPDATE inbox SET attempts=attempts+1, available=? + min(60000,1000*(1 << min(attempts,6))) WHERE id=?').run(Date.now(),id);
  }
  close() {this.sql.close();}
}
