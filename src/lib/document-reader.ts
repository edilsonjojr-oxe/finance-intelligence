// Documentos são processados em memória. Este módulo não faz uploads nem grava arquivos.
export async function documentDigest(bytes:Uint8Array) {
  const digest=await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function readPdfBytes(bytes:Uint8Array, progress:(message:string)=>void=()=>{},signal?:AbortSignal) {
  const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');
  if(typeof window!=='undefined') pdf.GlobalWorkerOptions.workerSrc='/vendor/pdf/pdf.worker.min.mjs';
  const loading=pdf.getDocument({data:bytes,useSystemFonts:true,disableFontFace:true,stopAtErrors:true,verbosity:0});
  const abort=()=>{void loading.destroy();};signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(abort,45_000);
  try {
    const doc=await loading.promise;
    if(doc.numPages>40)throw new Error('Limite de 40 páginas. Separe o documento antes de ler.');
    const lines:string[]=[];let chars=0;
    for(let i=1;i<=doc.numPages;i++) {
      if(signal?.aborted)throw new Error('Leitura cancelada.');progress(`Lendo página ${i} de ${doc.numPages}…`);
      const page=await doc.getPage(i);const content=await page.getTextContent();
      let line='',lastY:number|undefined;
      for(const item of content.items) {if(!('str' in item))continue;
        const y=item.transform[5];if(lastY!==undefined&&Math.abs(lastY-y)>3&&line){lines.push(line);line='';}
        line+=item.str+' ';lastY=y;if(item.hasEOL){lines.push(line);line='';lastY=undefined;}
      }
      if(line)lines.push(line);chars+=lines.slice(-content.items.length).join('').length;
      page.cleanup();if(chars>500_000)throw new Error('Documento excede o limite de texto para leitura.');
    }
    return lines.join('\n');
  } finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);await loading.destroy();if(bytes.byteLength)bytes.fill(0);}
}
export async function readImage(file:File,progress:(message:string)=>void,signal?:AbortSignal) {
  const { createWorker }=await import('tesseract.js');
  const image=await createImageBitmap(file);
  const pixels=image.width*image.height;image.close();
  if(pixels>16_000_000)throw new Error('Imagem muito grande. Use até 16 megapixels.');
  let worker:Awaited<ReturnType<typeof createWorker>>|undefined;
  let ended=false, rejectStop:(error:Error)=>void=()=>{};
  const stopped=new Promise<never>((_,reject)=>{rejectStop=reject;});
  const stop=()=>rejectStop(new Error('Leitura cancelada.'));
  const timeout=setTimeout(()=>rejectStop(new Error('A leitura excedeu 90 segundos. Use uma imagem menor.')),90_000);
  signal?.addEventListener('abort',stop,{once:true});
  try {
    if(signal?.aborted)throw new Error('Leitura cancelada.');
    const pending=createWorker('por',1,{workerPath:'/vendor/ocr/worker.min.js',corePath:'/vendor/ocr',langPath:'/vendor/ocr',cacheMethod:'none',logger:m=>{if(!ended&&m.status==='recognizing text')progress(`Lendo imagem: ${Math.round(m.progress*100)}%`);},errorHandler:()=>{}}).then(async value=>{if(ended){await value.terminate();throw new Error('Leitura encerrada.');}return value;});
    worker=await Promise.race([pending,stopped]);
    const result=await Promise.race([worker.recognize(file),stopped]);return result.data.text.slice(0,500_000);
  } finally {ended=true;clearTimeout(timeout);signal?.removeEventListener('abort',stop);await worker?.terminate();}
}
export async function readDocument(file:File,progress:(message:string)=>void,signal?:AbortSignal) {
  if(file.size>8_000_000||file.size===0)throw new Error('Use um arquivo de até 8 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const source_hash=await documentDigest(bytes);
  const pdf=String.fromCharCode(...bytes.slice(0,5))==='%PDF-';
  const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
  const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  try {
    let text='';
    if(pdf) text=await readPdfBytes(bytes,progress,signal);
    else if(png||jpg)text=await readImage(file,progress,signal);
    else if(/\.txt$/i.test(file.name))text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    else throw new Error('Use PDF com texto, PNG, JPEG ou TXT. O conteúdo não corresponde a um formato aceito.');
    if(!text.trim())throw new Error('Não foi possível ler texto. Para PDF digitalizado, envie a página como PNG/JPEG para OCR.');
    if(text.length>500_000)throw new Error('Texto muito longo. Divida o documento.');
    return {text,source_hash};
  }finally{if(bytes.byteLength)bytes.fill(0);}
}
