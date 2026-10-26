import { ensureCatalog } from './catalog.js';
import { db } from './db.js';
import { transact } from './transactions.js';
import { LEADS, cleanName, requireThat } from './rules.js';
import { validatePalette } from './colors.js';
import { seedDemo, clearDemo } from './tournament.js';
export function telegramToHtml(text,entities=[]) {
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const open=new Map(),close=new Map();
 for(const e of entities){let tags={bold:['strong'],italic:['em'],underline:['u'],strikethrough:['s'],code:['code'],pre:['pre']}[e.type];
  if(e.type==='text_link'&&/^https?:\/\//i.test(e.url||''))tags=['a',` href="${esc(e.url)}"`];
  if(!tags||!Number.isInteger(e.offset)||!Number.isInteger(e.length)||e.offset<0||e.offset+e.length>text.length)continue;
  const [tag,attrs='']=tags;(open.get(e.offset)||open.set(e.offset,[]).get(e.offset)).push({length:e.length,html:`<${tag}${attrs}>`});(close.get(e.offset+e.length)||close.set(e.offset+e.length,[]).get(e.offset+e.length)).push({offset:e.offset,html:`</${tag}>`});
 }
 let out='';for(let i=0;i<=text.length;i++){for(const x of(close.get(i)||[]).sort((a,b)=>b.offset-a.offset))out+=x.html;for(const x of(open.get(i)||[]).sort((a,b)=>b.length-a.length))out+=x.html;if(i<text.length)out+=esc(text[i]);}return out.replaceAll('\n','<br>');
}
export async function savePage(actorId,kind,data,key){return transact(actorId,'page_'+kind,key,async(c,a)=>{
 requireThat(LEADS.includes(a.role),'Nur Turnierleitung.');
 if(data.expectedVersion!==undefined)requireThat(Number((await c.query('SELECT version FROM settings WHERE id=1')).rows[0].version)===Number(data.expectedVersion),'Seiteneinstellungen wurden inzwischen geändert. Bitte neu öffnen.');
 if(['title','description','ticker','logo','final_mode'].includes(kind)){
  let v=data.value;
  if(kind==='title')v=cleanName(v,120);
  if(kind==='description'||kind==='ticker'){requireThat(typeof v==='string'&&v.length<=500,'Höchstens 500 Zeichen.');}
  if(kind==='logo')requireThat(v===null||(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v)&&v.length<2800000),'Ungültiges Logo.');
  if(kind==='final_mode'){requireThat((await c.query('SELECT mode FROM event_control WHERE id=1')).rows[0].mode==='classic','Im Turbo-Modus gibt es keinen Finalmodus.');requireThat(['single','bo3'].includes(v),'Ungültiger Finalmodus.');requireThat(!(await c.query("SELECT id FROM games WHERE phase='knockout' AND NOT is_demo AND status<>'cancelled'")).rowCount,'Finalmodus nach Beginn der K.-o.-Phase gesperrt.');}
  await c.query(`UPDATE settings SET ${kind}=$1,version=version+1 WHERE id=1`,[v]);
  if(kind==='ticker')await c.query('UPDATE settings SET ticker_enabled=$1 WHERE id=1',[Boolean(v)]);
 }else if(kind==='branding'){
  const x=validatePalette(data.primary,data.secondary,data.accent);requireThat(x.ok,x.error);
  await c.query('UPDATE settings SET primary_color=$1,secondary_color=$2,accent_color=$3,version=version+1 WHERE id=1',[data.primary,data.secondary,data.accent]);
 }else if(kind==='rules'){
  requireThat(data.plain.length<=60000&&data.html.length<=120000,'Regelwerk ist zu lang.');
  await c.query('UPDATE settings SET rules=$1,rules_html=$2,version=version+1 WHERE id=1',[data.plain,data.html]);
 }else if(kind==='sponsor_add'||kind==='sponsor_edit'){
  const name=cleanName(data.name,120);let url=null;if(data.url){const u=new URL(data.url);requireThat(['https:','http:'].includes(u.protocol)&&data.url.length<=500,'Nur http/https-Links.');url=u.toString();}
  requireThat(data.logo==null||(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(data.logo)&&data.logo.length<2800000),'Ungültiges Logo.');
  if(kind==='sponsor_add')await c.query('INSERT INTO sponsors(name,url,logo) VALUES($1,$2,$3)',[name,url,data.logo||null]);
  else await c.query('UPDATE sponsors SET name=$1,url=$2,logo=$3 WHERE id=$4',[name,url,data.logo||null,data.id]);
 }else if(kind==='sponsor_delete')await c.query('DELETE FROM sponsors WHERE id=$1',[data.id]);
 else if(kind==='demo_seed'){await seedDemo(c);await ensureCatalog(c);}
 else if(kind==='demo_clear')await clearDemo(c);
 else if(kind==='onboarding'){
  const classic=(await c.query('SELECT mode FROM event_control WHERE id=1')).rows[0].mode==='classic';
  if(classic)requireThat(!(await c.query("SELECT id FROM games WHERE phase='knockout' AND NOT is_demo AND status<>'cancelled'")).rowCount,'Ersteinrichtung nach Beginn der K.-o.-Phase gesperrt.');
  const name=cleanName(data.title,120);requireThat(String(data.description||'').length<=500,'Beschreibung zu lang.');if(classic)requireThat(['single','bo3'].includes(data.final_mode),'Finalmodus fehlt.');
  const v=validatePalette(data.primary,data.secondary,data.accent);requireThat(v.ok,v.error);
  await c.query('UPDATE settings SET title=$1,description=$2,logo=$3,primary_color=$4,secondary_color=$5,accent_color=$6,final_mode=coalesce($7,final_mode),onboarding_done=true,version=version+1 WHERE id=1',[name,data.description||'',data.logo||null,data.primary,data.secondary,data.accent,classic?data.final_mode:null]);
 }else throw Error('Unbekannte Seiteneinstellung.');
 await c.query('UPDATE settings SET version=version+1 WHERE id=1');
 return {audit:{kind}};
});}
