import mammoth from 'mammoth';
const streams=[];
for await(const chunk of process.stdin) streams.push(chunk);
const bytes=Buffer.concat(streams);
if(bytes.length>12*1024*1024)throw new Error('Tệp quá lớn');
let text='';
if(bytes.subarray(0,5).toString()==='%PDF-') {
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:false,isEvalSupported:false,useWorkerFetch:false}).promise;
  try {
    for(let i=1;i<=Math.min(pdf.numPages,120) && text.length<80000;i++){
      const content=await (await pdf.getPage(i)).getTextContent();
      text+=content.items.map(x=>'str' in x?x.str:'').join(' ')+'\n';
    }
  } finally {await pdf.destroy();}
} else if(bytes.readUInt16BE(0)===0x504b) {
  text=(await mammoth.extractRawText({buffer:bytes})).value;
} else throw new Error('Chỉ nhận PDF, DOCX, TXT.');
process.stdout.write(text.slice(0,80000));
