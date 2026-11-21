export async function attachment(url: string, signal?: AbortSignal) {
  const source=new URL(url);
  if (source.protocol!=='https:' || source.username || source.password || source.port ||
      !/(^|\.)(fbcdn\.net|fbsbx\.com|facebook\.com)$/.test(source.hostname)) throw new Error('URL tệp đính kèm ngoài CDN Meta.');
  const res=await fetch(source,{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])])});
  if (!res.ok || !res.body) throw new Error('Không tải được tệp từ Meta.');
  const max=12*1024*1024, parts:Buffer[]=[]; let size=0;
  const reader=res.body.getReader();
  try {
    for (;;) {const item=await reader.read(); if (item.done) break;
      size+=item.value.length;
      if (size>max) throw new Error('Tệp vượt quá 12 MiB.');
      parts.push(Buffer.from(item.value));
    }
  } finally {await reader.cancel();}
  return {bytes:Buffer.concat(parts),mime:(res.headers.get('content-type')??'').split(';')[0],name:source.pathname.split('/').pop()??'file'};
}
