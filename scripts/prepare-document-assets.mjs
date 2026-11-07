import { mkdir,copyFile,readdir } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
await mkdir(path.join(root,'public/vendor/pdf'),{recursive:true});
await mkdir(path.join(root,'public/vendor/ocr'),{recursive:true});
await copyFile(path.join(root,'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),path.join(root,'public/vendor/pdf/pdf.worker.min.mjs'));
await copyFile(path.join(root,'node_modules/tesseract.js/dist/worker.min.js'),path.join(root,'public/vendor/ocr/worker.min.js'));
for(const name of await readdir(path.join(root,'node_modules/tesseract.js-core'))) {
  if(/^tesseract-core.*\.(wasm|js)$/.test(name))await copyFile(path.join(root,'node_modules/tesseract.js-core',name),path.join(root,'public/vendor/ocr',name));
}
await copyFile(path.join(root,'node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz'),path.join(root,'public/vendor/ocr/por.traineddata.gz'));
console.log('Leitores de documentos preparados. Nenhum documento pessoal é usado.');
