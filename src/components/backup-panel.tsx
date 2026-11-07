'use client';
import { useState,type FormEvent } from 'react';
export default function BackupPanel(){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;const passphrase=new FormData(form).get('passphrase');setBusy(true);setMessage('');
    try{const response=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passphrase})});
      if(!response.ok)throw new Error((await response.json()).error);
      const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='finance-backup.fib';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);form.reset();setMessage('Backup criptografado gerado. Guarde a senha separadamente.');
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="panel settings-card"><h2>Backup dos seus dados</h2><p>Contas, lançamentos, contratos e histórico em um arquivo criptografado. Não inclui documentos originais, mensagens completas ou sessões de acesso.</p><form onSubmit={submit}><label className="field"><span>Senha exclusiva do backup</span><input name="passphrase" type="password" autoComplete="new-password" minLength={12} maxLength={128} required placeholder="Pelo menos 12 caracteres"/></label><button className="button" disabled={busy}>{busy?'Gerando…':'Baixar backup criptografado'}</button></form>{message&&<p role="status">{message}</p>}<p>A restauração é feita em uma base separada, sem sobrescrever seus dados. A senha não pode ser recuperada.</p></section>;
}
