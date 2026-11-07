// Servidor de teste: loopback, base sintética exclusiva e encerramento automático.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
const origin='http://127.0.0.1:3001';
async function main(){
  const port=await fetch(origin+'/api/health').catch(()=>null);
  if(port)throw new Error('Porta de teste ocupada. Nenhum servidor existente será modificado.');
  const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3001'],{stdio:'inherit',env:{...process.env,DATABASE_URL:'',FINANCE_DATA_DIR:path.resolve('.data',`test-http-${randomUUID()}`),APP_ORIGIN:origin,SETUP_TOKEN:'',CLOUD_DEPLOYMENT:'',COOKIE_SECURE:'false'}});
  const stop=()=>server.kill('SIGTERM');process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    let ready=false;for(let i=0;i<60;i++){try{const r=await fetch(origin+'/api/health');if(r.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
    if(!ready)throw new Error('Servidor sintético não iniciou.');
    const test=spawn(process.execPath,['--import','tsx','tests/http.ts'],{stdio:'inherit',env:{...process.env,FINANCE_TEST_URL:origin}});
    const code=await new Promise<number|null>(resolve=>test.once('exit',resolve));if(code!==0)throw new Error('Validação HTTP falhou.');
    if(process.argv.includes('--preview')){console.log('PREVIEW SINTÉTICO: http://127.0.0.1:3001 — encerramento automático em 15 minutos.');await new Promise(resolve=>setTimeout(resolve,15*60_000));}
  }finally{stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
