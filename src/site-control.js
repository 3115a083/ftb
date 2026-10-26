import { db } from './db.js';
import { transact } from './transactions.js';
import { hashPassword } from './auth.js';
import { BUSY, cleanName, requireThat, metricList } from './rules.js';
export async function siteConfig(c=db){return (await c.query('SELECT mode,timezone,turbo_min_games,turbo_tiebreakers,site_methods,site_epoch,site_version FROM event_control WHERE id=1')).rows[0];}
export async function configureSite(id,data,key){
 const a=(await db.query('SELECT role FROM staff WHERE telegram_id=$1',[String(id)])).rows[0];requireThat(a?.role==='admin','Nur Administratoren.');
 const hash=data.password?await hashPassword(data.password):null;
 return transact(id,'site_config',key,async(c,a)=>{
  requireThat(a.role==='admin','Nur Administratoren.');const before=await siteConfig(c);
  requireThat(data.version==null||Number(data.version)===before.site_version,'Website-Einstellungen inzwischen geändert. Dialog neu öffnen.');
  const mode=data.mode||before.mode;requireThat(['classic','turbo'].includes(mode),'Ungültiger Modus.');
  if(mode!==before.mode)requireThat(!(await c.query("SELECT id FROM match_ops WHERE status=ANY($1::text[]) AND (($2='turbo' AND game_id IS NOT NULL) OR ($2='classic' AND session_id IS NOT NULL))",[BUSY,mode])).rowCount,'Zuerst alle laufenden oder zugewiesenen Spiele abschließen.');
  const methods=data.methods??before.site_methods;requireThat(Array.isArray(methods)&&methods.every(x=>['password','account','telegram'].includes(x))&&new Set(methods).size===methods.length,'Ungültige Anmeldearten.');
  if(data.tiebreakers!=null)metricList(data.tiebreakers);
  if(data.minGames!=null)requireThat(Number.isInteger(data.minGames)&&data.minGames>=1&&data.minGames<=1000,'Mindestspielzahl: 1 bis 1000.');
  const current=(await c.query('SELECT site_password_hash FROM event_control WHERE id=1')).rows[0];
  requireThat(!methods.includes('password')||hash||current.site_password_hash,'Zuerst ein Seitenpasswort setzen.');
  if(data.timezone){try{new Intl.DateTimeFormat('de-DE',{timeZone:data.timezone}).format();}catch{throw Error('Ungültige Zeitzone.');}}
  const methodsChanged=JSON.stringify([...methods].sort())!==JSON.stringify([...before.site_methods].sort());
  const revoke=Boolean(hash||methodsChanged||data.revokeSessions);
  await c.query('UPDATE event_control SET mode=$1,mode_initialized=true,timezone=$2,site_methods=$3,site_password_hash=coalesce($4,site_password_hash),site_epoch=site_epoch+$5,site_version=site_version+1 WHERE id=1',[mode,data.timezone||before.timezone,JSON.stringify(methods),hash,revoke?1:0]);
  if(data.minGames!=null)await c.query('UPDATE event_control SET turbo_min_games=$1 WHERE id=1',[data.minGames]);
  if(data.tiebreakers!=null)await c.query('UPDATE event_control SET turbo_tiebreakers=$1 WHERE id=1',[JSON.stringify(data.tiebreakers)]);
  if(revoke){await c.query('DELETE FROM site_sessions');await c.query('DELETE FROM site_challenges');}
  return {audit:{mode,methods,timezone:data.timezone||before.timezone,minGames:data.minGames??before.turbo_min_games,tiebreakers:data.tiebreakers??before.turbo_tiebreakers,revokedSessions:revoke}};
 });
}
export async function saveSiteAccount(id,data,key){
 const a=(await db.query('SELECT role FROM staff WHERE telegram_id=$1',[String(id)])).rows[0];requireThat(a?.role==='admin','Nur Administratoren.');
 const hash=data.password?await hashPassword(data.password):null;
 return transact(id,'site_account',key,async(c,a)=>{
  requireThat(a.role==='admin','Nur Administratoren.');
  if(data.id){
   requireThat(typeof data.active==='boolean','Status fehlt.');
   await c.query('UPDATE site_accounts SET active=$1,version=version+1 WHERE id=$2',[data.active,data.id]);
   await c.query('DELETE FROM site_sessions WHERE account_id=$1',[data.id]);await c.query('DELETE FROM site_challenges WHERE account_id=$1',[data.id]);
  }else{
   const username=cleanName(data.username,80).toLowerCase();requireThat(/^[a-z0-9_.-]{3,80}$/.test(username),'Benutzername: 3 bis 80 Zeichen, a-z, 0-9, Punkt, Bindestrich oder Unterstrich.');
   requireThat(!data.telegramId||/^\d{1,18}$/.test(String(data.telegramId)),'Ungültige Telegram-ID.');requireThat(hash||data.telegramId,'Passwort oder Telegram-ID erforderlich.');
   await c.query('INSERT INTO site_accounts(username,password_hash,telegram_id) VALUES($1,$2,$3) ON CONFLICT(username) DO UPDATE SET password_hash=coalesce(EXCLUDED.password_hash,site_accounts.password_hash),telegram_id=coalesce(EXCLUDED.telegram_id,site_accounts.telegram_id),active=true,version=site_accounts.version+1',[username,hash,data.telegramId||null]);
  }
  return {audit:{account:data.id||data.username,active:data.active??true}};
 });
}
