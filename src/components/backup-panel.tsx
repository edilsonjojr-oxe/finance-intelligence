'use client';
import { useState,type FormEvent } from 'react';
export default function BackupPanel(){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;const passphrase=new FormData(form).get('passphrase');setBusy(true);setMessage('');
    try{const response=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passphrase})});
      if(!response.ok)throw new Error((await response.json()).error);
      const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=`finance-backup-${new Date().toISOString().slice(0,10)}.fib`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);form.reset();setMessage('Backup criptografado gerado. Guarde a senha separadamente.');
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="panel settings-card"><h2>Backup</h2><p>Cópia criptografada para recuperar seus dados: contas, lançamentos, contratos e histórico. Não inclui documentos lidos nem sessões.</p><form onSubmit={submit}><label className="field"><span>Senha do backup</span><input name="passphrase" type="password" autoComplete="new-password" minLength={12} maxLength={128} required placeholder="Pelo menos 12 caracteres"/></label><button className="button" disabled={busy}>{busy?'Gerando…':'Gerar backup'}</button></form>{message&&<p role="status">{message}</p>}<p className="form-help">Guarde a senha: ela não pode ser recuperada. A restauração usa uma base separada e não sobrescreve seus dados.</p></section>;
}
