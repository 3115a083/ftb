import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { checkPassword } from './auth.js';
import { siteConfig } from './site-control.js';
import { requireThat } from './rules.js';
export const digest=v=>createHash('sha256').update(String(v)).digest('hex');
const fresh=()=>randomBytes(24).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split(/=(.*)/s)).filter(x=>x.length>1).map(([k,v])=>[k,v]));}
const secure=()=>process.env.ALLOW_HTTP_TEST!=='1';
const cookieName=kind=>(secure()?'__Host-':'')+'ftb-'+kind;
function setCookie(res,kind,value,{maxAge,httpOnly=true}={}){res.cookie(cookieName(kind),value,{httpOnly,secure:secure(),sameSite:'lax',path:'/',...(maxAge==null?{}:{maxAge})});}
const readCookie=(req,kind)=>cookies(req)[cookieName(kind)];
export function csrf(req,res){let token=readCookie(req,'csrf');if(!/^[\w-]{32}$/.test(token||'')){token=fresh();setCookie(res,'csrf',token);}return token;}
export function csrfValid(req){
 const expected=process.env.SITE_URL||`${req.protocol}://${req.get('host')}`;
 return (!req.headers.origin||req.headers.origin===new URL(expected).origin)&&equal(readCookie(req,'csrf'),req.body?.csrf);
}
let hashes=0;
// Limit before scrypt; database-backed windows survive restarts and cover all HTTP workers.
export async function reserveLogin(ip){
 const c=await db.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM event_control WHERE id=1 FOR UPDATE');
  const keys=['site:global','site:'+digest(ip)];
  for(const key of keys){await c.query('INSERT INTO login_limits(key) VALUES($1) ON CONFLICT DO NOTHING',[key]);await c.query("UPDATE login_limits SET count=0,window_start=now() WHERE key=$1 AND window_start<now()-($2::int*interval '1 second')",[key,key==='site:global'?60:900]);const l=(await c.query('SELECT count FROM login_limits WHERE key=$1',[key])).rows[0];if(l.count>=(key==='site:global'?120:8)){await c.query('COMMIT');return false;}}
  for(const key of keys)await c.query('UPDATE login_limits SET count=count+1 WHERE key=$1',[key]);await c.query('COMMIT');return true;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function authenticate(req){
 const config=await siteConfig();if(!config.site_methods.length)return {config,session:null};
 const raw=readCookie(req,'session');if(!/^[\w-]{32}$/.test(raw||''))return {config,session:null};
 const s=(await db.query(`SELECT s.* FROM site_sessions s LEFT JOIN site_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.epoch=$2 AND (s.account_id IS NULL OR (a.active AND a.version=s.account_version))`,[digest(raw),config.site_epoch])).rows[0];return {config,session:s||null};
}
async function clearLoginFailures(ip){await db.query('UPDATE login_limits SET count=0 WHERE key=$1',['site:'+digest(ip)]);}
async function issueSession(res,config,account,remember){
 const raw=fresh(),duration=remember?30*86400000:12*3600000;
 // Recheck account and config in the INSERT to avoid concurrent revocation races.
 const result=await db.query(`INSERT INTO site_sessions(token_hash,account_id,account_version,epoch,expires_at) SELECT $1,$2,$3,$4,now()+($5::int*interval '1 second') FROM event_control e WHERE e.id=1 AND e.site_epoch=$4 AND ($2::int IS NULL OR EXISTS(SELECT 1 FROM site_accounts a WHERE a.id=$2 AND a.active AND a.version=$3)) RETURNING token_hash`,[digest(raw),account?.id||null,account?.version||null,config.site_epoch,duration/1000]);
 requireThat(result.rowCount,'Zugang inzwischen geändert. Bitte erneut anmelden.');
 setCookie(res,'session',raw,{maxAge:remember?duration:undefined});
 await db.query('DELETE FROM site_sessions WHERE expires_at<now()');await db.query('DELETE FROM site_challenges WHERE expires_at<now()');
}
export async function confirmWebLogin(token,user,approve=false){
 requireThat(/^[\w-]{32}$/.test(token),'Anmeldung ungültig.');
 const config=await siteConfig();requireThat(config.site_methods.includes('telegram'),'Telegram-Anmeldung ist deaktiviert.');
 const account=(await db.query('SELECT * FROM site_accounts WHERE telegram_id=$1 AND active',[String(user)])).rows[0];requireThat(account,'Für diese Telegram-ID ist kein Website-Zugang freigegeben.');
 const challenge=(await db.query('SELECT * FROM site_challenges WHERE token_hash=$1 AND expires_at>now() AND epoch=$2',[digest(token),config.site_epoch])).rows[0];requireThat(challenge&&!challenge.approved,'Anmeldung abgelaufen oder bereits bestätigt.');
 if(approve){const r=await db.query('UPDATE site_challenges SET approved=true,account_id=$1,account_version=$2,telegram_id=$3 WHERE token_hash=$4 AND NOT approved AND expires_at>now()',[account.id,account.version,String(user),digest(token)]);requireThat(r.rowCount,'Anmeldung bereits bearbeitet.');}
 return {code:token.slice(-6).toUpperCase(),site:process.env.SITE_URL||'FTB'};
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Only known read-only website destinations may survive authentication.
export function returnPath(value){
 if(typeof value!=='string'||value.length>2000||!value.startsWith('/')||value.startsWith('//')||/[\\\x00-\x20\x7f]/.test(value))return '/';
 try{const url=new URL(value,'https://ftb.invalid');if(url.origin!=='https://ftb.invalid'||!/^\/(?:|spielplan|teams(?:\/[^/#?]+)?|personen(?:\/[^/#?]+){0,2}|spiele\/\d+|statistik(?:\/(?:(?:\d+|gesamt)\.(?:pdf|csv)))?|regelwerk(?:\.pdf)?|turnier\.pdf)$/.test(url.pathname))return '/';return url.pathname+url.search;}catch{return '/';}
}
const destination=req=>returnPath(req.method==='GET'?req.query.next:req.body?.next);
function page(req,res,methods,message='',challenge=null){
 const token=csrf(req,res),next=destination(req),nextField=`<input type="hidden" name="next" value="${esc(next)}">`;res.type('html').send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FTB · Anmelden</title><meta name="csrf-token" content="${token}"><link rel="stylesheet" href="/assets/site.css"><script src="/assets/theme.js"></script><script src="/assets/site.js" defer></script></head><body><main class="auth wrap"><div class="card"><span class="eyebrow">FTB · Geschützte Website</span><h1>Willkommen zurück</h1><p>Melde dich an, um Spiele und Statistiken anzusehen.</p>${message?`<p role="alert">${esc(message)}</p>`:''}${challenge?`<section id="telegram-login" data-token="${esc(challenge.token)}" data-expires="${esc(challenge.expires)}"><p>Vergleiche im Bot diesen Code: <strong>${esc(challenge.token.slice(-6).toUpperCase())}</strong></p><a class="button" href="${esc(challenge.url)}" target="_blank" rel="noopener">In Telegram bestätigen</a><p id="login-state" role="status">Warte auf deine Bestätigung …</p><a class="secondary" href="/login?next=${esc(encodeURIComponent(next))}">Anmeldung neu starten</a></section>`:`${methods.includes('password')?`<form method="post" action="/login">${nextField}<input type="hidden" name="csrf" value="${token}"><input type="hidden" name="method" value="password"><label>Seitenpasswort<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><label class="check"><input type="checkbox" name="remember" value="1">30 Tage angemeldet bleiben</label><button>Anmelden</button></form>`:''}${methods.includes('account')?`<form method="post" action="/login">${nextField}<input type="hidden" name="csrf" value="${token}"><input type="hidden" name="method" value="account"><label>Benutzername<input name="username" autocomplete="username" required maxlength="80"></label><label>Passwort<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><label class="check"><input type="checkbox" name="remember" value="1">30 Tage angemeldet bleiben</label><button>Mit Benutzerkonto anmelden</button></form>`:''}${methods.includes('telegram')?`<form method="post" action="/login/telegram">${nextField}<input type="hidden" name="csrf" value="${token}"><label class="check"><input type="checkbox" name="remember" value="1">30 Tage angemeldet bleiben</label><button>Mit Telegram anmelden</button></form>`:''}`}</div><button id="theme-toggle" class="secondary theme-toggle" type="button" aria-label="Darstellung: Automatisch" title="Darstellung: Automatisch">◐</button></main></body></html>`);
}
export function installSiteAuth(app,getBotName){
 app.use((req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 app.get('/login',async(req,res)=>{const {config,session}=await authenticate(req);if(session||!config.site_methods.length)return res.redirect(destination(req));page(req,res,config.site_methods);});
 app.post('/login',async(req,res)=>{
  const config=await siteConfig();if(!csrfValid(req))return res.status(403).send('Formular abgelaufen. Bitte Anmeldung neu öffnen.');
  if(!config.site_methods.includes(req.body.method))return res.sendStatus(403);
  if(!await reserveLogin(req.ip)||hashes>=2)return res.status(429).send('Zu viele Anmeldeversuche. Bitte später versuchen.');
  let account=null,hash=null;if(req.body.method==='account'){account=(await db.query('SELECT * FROM site_accounts WHERE username=$1 AND active',[String(req.body.username||'').toLowerCase()])).rows[0];hash=account?.password_hash;}else hash=(await db.query('SELECT site_password_hash FROM event_control WHERE id=1')).rows[0].site_password_hash;
  let valid=false;hashes++;try{valid=await checkPassword(req.body.password,hash);}finally{hashes--;}
  if(!valid){res.status(401);return page(req,res,config.site_methods,'Anmeldung fehlgeschlagen.');}
  await issueSession(res,config,account,req.body.remember==='1');await clearLoginFailures(req.ip);return res.redirect(303,destination(req));
 });
 app.post('/login/telegram',async(req,res)=>{
  const config=await siteConfig();if(!csrfValid(req)||!config.site_methods.includes('telegram'))return res.sendStatus(403);
  if(!await reserveLogin(req.ip))return res.sendStatus(429);
  const username=await getBotName();if(!username)return res.status(503).send('Telegram-Anmeldung ist noch nicht eingerichtet.');
  const token=fresh(),binding=fresh();setCookie(res,'binding',binding,{maxAge:300000});
  await db.query('DELETE FROM site_challenges WHERE expires_at<now()');
  const challenge=(await db.query("INSERT INTO site_challenges(token_hash,binding_hash,remember,expires_at,epoch,next_path) VALUES($1,$2,$3,now()+interval '5 minutes',$4,$5) RETURNING expires_at",[digest(token),digest(binding),req.body.remember==='1',config.site_epoch,destination(req)])).rows[0];
  const instance=process.env.INSTANCE_ID||'local';requireThat(/^[a-z0-9-]{1,12}$/.test(instance),'Instanzkennung ungültig.');
  page(req,res,config.site_methods,'',{token,expires:new Date(challenge.expires_at).toISOString(),url:`https://t.me/${username}?start=web_${instance}_${token}`});
 });
 app.post('/login/telegram/check',async(req,res)=>{
  if(!csrfValid(req))return res.sendStatus(403);const config=await siteConfig();
  if(!config.site_methods.includes('telegram')||!/^[\w-]{32}$/.test(req.body.token||''))return res.sendStatus(403);
  const binding=readCookie(req,'binding');if(!binding)return res.sendStatus(403);
  // Atomic consume, bound to the initiating browser and current configuration.
  const row=(await db.query('DELETE FROM site_challenges WHERE token_hash=$1 AND binding_hash=$2 AND epoch=$3 AND approved AND expires_at>now() RETURNING *',[digest(req.body.token),digest(binding),config.site_epoch])).rows[0];
  if(!row){const pending=await db.query('SELECT 1 FROM site_challenges WHERE token_hash=$1 AND binding_hash=$2 AND epoch=$3 AND expires_at>now()',[digest(req.body.token),digest(binding),config.site_epoch]);return pending.rowCount?res.json({ready:false}):res.status(410).json({ready:false,expired:true});}
  await issueSession(res,config,{id:row.account_id,version:row.account_version},row.remember);await clearLoginFailures(req.ip);res.json({ready:true,next:returnPath(row.next_path)});
 });
 app.post('/logout',async(req,res)=>{if(!csrfValid(req))return res.sendStatus(403);await db.query('DELETE FROM site_sessions WHERE token_hash=$1',[digest(readCookie(req,'session'))]);setCookie(res,'session','',{maxAge:0});res.redirect(303,'/login');});
 app.use(async(req,res,next)=>{const auth=await authenticate(req);req.site=auth.config;req.siteSession=auth.session;if(auth.config.site_methods.length&&!auth.session){if(req.path.startsWith('/api/'))return res.sendStatus(401);return res.redirect('/login?next='+encodeURIComponent(returnPath(req.originalUrl)));}next();});
}
