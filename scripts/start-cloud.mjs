import { spawn } from 'node:child_process';
const required=['DATABASE_URL','APP_ORIGIN','SETUP_TOKEN'];
for(const key of required)if(!process.env[key])throw new Error(`Configuração obrigatória: ${key}`);
if(new URL(process.env.APP_ORIGIN).protocol!=='https:')throw new Error('APP_ORIGIN deve usar HTTPS na nuvem.');
if(process.env.SETUP_TOKEN.length<32)throw new Error('SETUP_TOKEN deve ter pelo menos 32 caracteres aleatórios.');
process.env.COOKIE_SECURE='true';process.env.CLOUD_DEPLOYMENT='true';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',process.env.PORT||'3000'],{stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
