// Chuyển dữ liệu JSON/JSONL cũ trong data/ sang SQLite (data/bot.sqlite và data/messenger/<PAGE_ID>/bot.sqlite).
// An toàn để chạy nhiều lần: tài liệu đã có trong DB sẽ được bỏ qua, file cũ KHÔNG bị xoá.
// Dùng: npm run data:migrate            (đọc DATA_DIR trong .env, mặc định ./data)
import 'dotenv/config';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteDocStore, importTree } from '../src/core/docstore.js';

const root = process.env.DATA_DIR?.trim() || 'data';
const walk = (dir: string, skip: (p: string) => boolean): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (skip(p)) return [];
  return statSync(p).isDirectory() ? walk(p, skip) : /\.jsonl?$/.test(n) ? [p] : [];
});

if (!existsSync(root)) { console.log(`Không có thư mục ${root}, không có gì để chuyển.`); process.exit(0); }
const targets = [root];
const pages = join(root, 'messenger');
if (existsSync(pages)) for (const id of readdirSync(pages)) if (statSync(join(pages, id)).isDirectory()) targets.push(join(pages, id));

for (const dir of targets) {
  const files = walk(dir, (p) => p === pages || p.endsWith('.tmp'));
  const db = new SqliteDocStore(join(dir, 'bot.sqlite'));
  const n = importTree(db, dir, files);
  db.close();
  console.log(`✔ ${dir}: nhập ${n}/${files.length} tệp vào bot.sqlite`);
}
console.log('Xong. Đặt STORAGE=sqlite (mặc định) rồi khởi động lại bot. File cũ vẫn được giữ để dự phòng.');
