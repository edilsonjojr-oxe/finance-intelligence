import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { readPdfBytes,readDocument } from '../src/lib/document-reader';
import { extractEntries } from '../src/lib/document-extraction';
const lines=['Descricao: Internet sintetica','Vencimento: 12/11/2026','Valor: R$ 129,90'];
function pdf(){
  const content=lines.map((s,i)=>`BT /F1 18 Tf 50 ${750-i*35} Td (${s}) Tj ET`).join('\n');
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let out='%PDF-1.4\n';const offsets=[0];
  objects.forEach((s,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${s}\nendobj\n`;});
  const start=out.length;out+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(out,'ascii');
}
async function main(){
  const folder=path.resolve('artifacts','synthetic-documents');await mkdir(folder,{recursive:true});
  const bytes=pdf();await writeFile(path.join(folder,'synthetic.pdf'),bytes);
  const text=await readPdfBytes(new Uint8Array(bytes));
  assert.match(text,/Internet sintetica/);assert.equal(extractEntries(text)[0].amount,'129.90');
  console.log('PASS PDF real sintético: leitor utilizado pela aplicação + campos extraídos');
  await assert.rejects(()=>readDocument(new File(['secret'],'fake.pdf'),()=>{}),/formato/);
  await assert.rejects(()=>readDocument(new File([new Uint8Array(8_000_001)],'large.txt'),()=>{}),/8 MB/);
  const txt=await readDocument(new File([lines.join('\n')],'synthetic.txt'),()=>{});assert.equal(txt.source_hash.length,64);assert.equal(extractEntries(txt.text)[0].date,'2026-11-12');
  console.log('PASS TXT, hash, limite de tamanho e assinatura de arquivo');
  const canvas=createCanvas(1400,360),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1400,360);ctx.fillStyle='black';ctx.font='42px Arial';lines.forEach((line,i)=>ctx.fillText(line,45,80+i*90));
  const png=canvas.toBuffer('image/png');await writeFile(path.join(folder,'synthetic.png'),png);
  const worker=await createWorker('por',1,{langPath:path.resolve('public/vendor/ocr'),cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});
  try {const result=await worker.recognize(png);const [row]=extractEntries(result.data.text);assert.equal(row.amount,'129.90');assert.equal(row.date,'2026-11-12');assert.match(row.description,/Internet/i);}
  finally{await worker.terminate();}
  console.log('PASS OCR real em PNG sintético, modelo português local, sem cache de documentos');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
