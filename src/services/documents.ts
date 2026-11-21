import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Repository} from '../repository.js';
export async function extract(bytes:Buffer,mime:string,name:string):Promise<string>{
  if(!bytes.length||bytes.length>12*1024*1024)throw new Error('Tệp rỗng hoặc quá lớn.');
  if(mime.startsWith('text/plain')||/\.txt$/i.test(name))return new TextDecoder('utf8',{fatal:true}).decode(bytes).slice(0,80000);
  return new Promise((resolve,reject)=>{
    const worker=execFile(process.execPath,['--max-old-space-size=192',fileURLToPath(new URL('../../scripts/extract.mjs',import.meta.url))],
      {timeout:20000,maxBuffer:1024*1024,windowsHide:true},(err,out)=>err?reject(new Error('Không đọc được PDF/DOCX.')):resolve(out.trim()));
    worker.stdin?.on('error',()=>{});worker.stdin?.end(bytes);
  });
}
export function knowledge(db:Repository) {
  db.sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS knowledge USING fts5(source UNINDEXED, passage, tokenize='unicode61 remove_diacritics 2')");
  const normalize=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  const stops=new Set('toi cua cho mot nhung la va the of what how much is gia bao nhieu hoi ve xin duoc does it'.split(' '));
  return {
    put(source:string,body:string){
      if(!source.trim()||!body.trim())throw new Error('Cần tên nguồn và nội dung.');
      db.transaction(()=>{
        db.sql.prepare('DELETE FROM knowledge WHERE source=?').run(source);
        const insert=db.sql.prepare('INSERT INTO knowledge(source,passage) VALUES(?,?)');
        for(const p of body.slice(0,80000).match(/[\s\S]{1,850}(?:\s|$)|[\s\S]{1,850}/g)??[])insert.run(source,p.trim());
      });
    },
    search(q:string){
      const words=[...new Set(normalize(q).match(/[\p{L}\d]+/gu)??[])].filter(w=>w.length>1&&!stops.has(w)).slice(0,12);
      if(!words.length)return [];
      return db.sql.prepare('SELECT source,passage FROM knowledge WHERE knowledge MATCH ? ORDER BY rank LIMIT 3')
        .all(words.map(w=>'"'+w+'"').join(' AND ')).map(r=>({source:String(r.source),passage:String(r.passage)}));
    }
  };
}
