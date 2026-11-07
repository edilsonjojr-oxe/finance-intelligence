import { mkdir,writeFile } from 'node:fs/promises';
const response=await fetch('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400..700&family=Manrope:wght@400..800&display=swap',{headers:{'User-Agent':'Mozilla/5.0'}});
if(!response.ok)throw new Error('Fontes indisponíveis.');
let css=await response.text();await mkdir('public/fonts',{recursive:true});
for(const match of [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)]) {
  const url=match[1];const name=new URL(url).pathname.split('/').at(-1);const font=await fetch(url);if(!font.ok)throw new Error('Falha ao obter fonte.');
  await writeFile(`public/fonts/${name}`,new Uint8Array(await font.arrayBuffer()));css=css.replaceAll(url,`/fonts/${name}`);
}
await writeFile('public/fonts/fonts.css',css);console.log('Fontes existentes copiadas para uso local.');
