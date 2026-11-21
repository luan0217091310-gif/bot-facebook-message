import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

/**
 * Lớp repository tối giản cho mọi store của lõi (history, facts, reminders, watches, settings).
 * Mỗi "tài liệu" có tên logic dạng đường dẫn tương đối (vd `facts.json`, `threads/123/history.jsonl`).
 * Logic nghiệp vụ chỉ gọi read/write nên muốn đổi sang PostgreSQL chỉ cần viết thêm một DocStore.
 */
export interface DocStore {
  read(name: string): string;
  write(name: string, text: string): void;
  list?(prefix: string): string[];
}

export class FileDocStore implements DocStore {
  constructor(private readonly root: string) {}
  private path(name: string) { return join(this.root, name); }
  read(name: string): string {
    try { return readFileSync(this.path(name), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
  }
  write(name: string, text: string): void {
    const path = this.path(name);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, path);
  }
}

/** Danh sách migration theo thứ tự; chỉ được thêm vào cuối, không sửa bản cũ. */
const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS documents(name TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS metrics(at INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT, value REAL NOT NULL DEFAULT 1, user TEXT);
   CREATE INDEX IF NOT EXISTS metrics_at ON metrics(at)`,
];

export function migrate(sql: DatabaseSync): number {
  sql.exec('CREATE TABLE IF NOT EXISTS core_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const row = sql.prepare('SELECT max(version) AS v FROM core_migrations').get() as { v: number | null };
  let version = row.v ?? 0;
  for (; version < MIGRATIONS.length; version++) {
    sql.exec('BEGIN');
    try {
      sql.exec(MIGRATIONS[version]!);
      sql.prepare('INSERT INTO core_migrations VALUES(?,?)').run(version + 1, Date.now());
      sql.exec('COMMIT');
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  }
  return version;
}

/**
 * SQLite backend. Nếu một tài liệu chưa có trong DB nhưng file cũ tồn tại trong `legacyDir`,
 * nó được nhập vào DB ở lần đọc đầu tiên (không xoá file cũ → có thể quay lại STORAGE=file).
 */
export class SqliteDocStore implements DocStore {
  readonly sql: DatabaseSync;
  private readonly legacy?: FileDocStore;
  constructor(path: string, legacyDir?: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.sql = new DatabaseSync(path);
    this.sql.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
    migrate(this.sql);
    if (legacyDir) this.legacy = new FileDocStore(legacyDir);
  }
  read(name: string): string {
    const row = this.sql.prepare('SELECT body FROM documents WHERE name=?').get(name) as { body: string } | undefined;
    if (row) return row.body;
    const old = this.legacy?.read(name) ?? '';
    if (old) this.write(name, old);
    return old;
  }
  write(name: string, text: string): void {
    this.sql.prepare('INSERT INTO documents VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at')
      .run(name, text, Date.now());
  }
  list(prefix: string): string[] {
    return (this.sql.prepare("SELECT name FROM documents WHERE substr(name,1,?)=? ORDER BY name").all(prefix.length, prefix) as { name: string }[])
      .map((r) => r.name);
  }
  close() { this.sql.close(); }
}

/** Tiện ích cho store cũ nhận đường dẫn file: trả về (store, tên) tương ứng. */
export interface DocRef { store: DocStore; name: string }
export function docRef(target: string | DocRef): DocRef {
  if (typeof target !== 'string') return target;
  return { store: new FileDocStore(dirname(target)), name: basename(target) };
}

/** Nhập toàn bộ file trong data/ vào SQLite (dùng cho script migrate). */
export function importTree(db: SqliteDocStore, dir: string, files: string[]): number {
  let n = 0;
  for (const file of files) {
    const name = relative(dir, file).split(sep).join('/');
    if (!existsSync(file) || db.sql.prepare('SELECT 1 FROM documents WHERE name=?').get(name)) continue;
    db.write(name, readFileSync(file, 'utf8')); n++;
  }
  return n;
}
