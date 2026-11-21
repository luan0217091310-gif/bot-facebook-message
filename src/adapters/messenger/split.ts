// Giữ trọn khối Markdown vừa giới hạn. Khối quá dài được đóng và mở lại.
export function splitMessenger(text: string, max = 1999): string[] {
  if (max < 20 || !Number.isInteger(max)) throw new Error('Giới hạn tin nhắn không hợp lệ');
  const out: string[] = [];
  function plain(s: string, room: number) {
    const parts: string[]=[];
    while (s.length>room) {
      const window=s.slice(0,room);
      let cut=Math.max(window.lastIndexOf('\n'),window.lastIndexOf(' '))+1;
      if (!cut) cut=room-(/[\uD800-\uDBFF]$/.test(window)?1:0);
      parts.push(s.slice(0,cut)); s=s.slice(cut);
    }
    if (s) parts.push(s);
    return parts;
  }
  for (const block of text.split(/(```[^\n]*\n[\s\S]*?(?:\n?```|$))/g).filter(Boolean)) {
    if (block.length<=max) {out.push(block);continue;}
    if (block.startsWith('```')) {
      const first=block.indexOf('\n')+1, header=block.slice(0,first);
      if (header.length<max-8) {
        const body=block.slice(first).replace(/\n?```$/,'');
        for (const p of plain(body,max-header.length-4)) out.push(header+p+'\n```');
        continue;
      }
    }
    out.push(...plain(block,max));
  }
  return out;
}
