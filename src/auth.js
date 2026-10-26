import { telegramName } from './groups.js';
import { randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';
import { transact } from './transactions.js';
import { LEADS, cleanName, requireThat } from './rules.js';
const scrypt=promisify(derive);
const options={N:131072,r:8,p:1,maxmem:192*1024*1024};
export async function hashPassword(password) {
 requireThat(typeof password==='string'&&password.length>=12&&password.length<=200,'Passwort: 12 bis 200 Zeichen.');
 const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,32,options);
 return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function checkPassword(password,stored) {
 if(typeof password!=='string'||password.length>200||!stored)return false;
 const [algorithm,salt,hex]=stored.split('$');if(algorithm!=='scrypt'||!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{64}$/.test(hex))return false;
 const key=await scrypt(password,salt,32,options);return timingSafeEqual(key,Buffer.from(hex,'hex'));
}
export async function setEventPassword(actor,password,requestId) {
 const staff=(await db.query('SELECT role FROM staff WHERE telegram_id=$1',[String(actor)])).rows[0];
 requireThat(LEADS.includes(staff?.role),'Keine Berechtigung.');
 const hash=await hashPassword(password);
 return transact(actor,'password_changed',requestId,async(c,a)=>{requireThat(LEADS.includes(a.role),'Keine Berechtigung.');
 await c.query('UPDATE event_control SET password_hash=$1,password_epoch=password_epoch+1 WHERE id=1',[hash]);
 await c.query("UPDATE join_requests SET status='expired' WHERE status='pending'");return {audit:{}};});
}
// Persistent counters are checked before expensive password hashing. Global limits affect
// new admissions only; existing authorized staff can continue operating the tournament.
let hashing=0;
export async function requestAdmission(user,password) {
 const id=String(user.id);requireThat(/^\d+$/.test(id),'Ungültige Telegram-ID.');
 const permit=await transact(id,'admission_attempt',null,async(c)=>{
  const current=(await c.query('SELECT * FROM event_control WHERE id=1')).rows[0];
  for(const key of ['global',id]){
   await c.query('INSERT INTO login_limits(key) VALUES($1) ON CONFLICT DO NOTHING',[key]);
   const l=(await c.query('SELECT *,now() AS now FROM login_limits WHERE key=$1 FOR UPDATE',[key])).rows[0];
   const now=+new Date(l.now),window=key==='global'?60000:900000;
   if(now-+new Date(l.window_start)>=window){await c.query('UPDATE login_limits SET count=0,window_start=now() WHERE key=$1',[key]);l.count=0;}
   if(+new Date(l.blocked_until)>now||l.count>=(key==='global'?30:5))return {allowed:false};
  }
  await c.query("UPDATE login_limits SET count=count+1 WHERE key='global' OR key=$1",[id]);
  return {allowed:Boolean(current.password_hash),hash:current.password_hash,epoch:current.password_epoch};
 },{anonymous:true});
 if(!permit.allowed||hashing>=2)return false;
 let valid=false;hashing++;try{valid=await checkPassword(password,permit.hash);}finally{hashing--;}
 return transact(id,'admission_result',null,async(c)=>{
  const current=(await c.query('SELECT password_epoch FROM event_control WHERE id=1')).rows[0];
  if(valid&&current.password_epoch===permit.epoch){
   const existing=(await c.query('SELECT role FROM staff WHERE telegram_id=$1',[id])).rows[0];
   if(existing&&existing.role!=='revoked')return true;
   await c.query("INSERT INTO join_requests(telegram_id,display_name,password_epoch) VALUES($1,$2,$3) ON CONFLICT(telegram_id) DO UPDATE SET display_name=EXCLUDED.display_name,password_epoch=EXCLUDED.password_epoch,status='pending',created_at=now()",[id,cleanName(telegramName(user)||'Helfer'),permit.epoch]);
   return true;
  }
  const l=(await c.query('SELECT count FROM login_limits WHERE key=$1',[id])).rows[0];
  await c.query("UPDATE login_limits SET blocked_until=now()+($2::int*interval '1 second') WHERE key=$1",[id,Math.min(900,2**Math.min(l.count,10))]);return false;
 },{anonymous:true});
}
export async function approveAdmission(actor,target,personId,requestId) {
 return transact(actor,'admission_approved',requestId,async(c,a)=>{requireThat(LEADS.includes(a.role),'Keine Berechtigung.');
 const r=(await c.query("SELECT j.* FROM join_requests j,event_control e WHERE e.id=1 AND j.telegram_id=$1 AND j.status='pending' AND j.password_epoch=e.password_epoch",[String(target)])).rows[0];
 requireThat(r,'Anfrage nicht mehr gültig.');
 if(personId)requireThat((await c.query('SELECT id FROM people WHERE id=$1 AND active',[personId])).rowCount,'Person fehlt.');
 const existing=(await c.query('SELECT role FROM staff WHERE telegram_id=$1',[String(target)])).rows[0];
 requireThat(!existing||existing.role==='revoked','Person besitzt bereits Rechte.');
 await c.query("INSERT INTO staff(telegram_id,display_name,role,person_id,telegram_known) VALUES($1,$2,'helper',$3,true) ON CONFLICT(telegram_id) DO UPDATE SET display_name=EXCLUDED.display_name,role='helper',person_id=EXCLUDED.person_id,telegram_known=true",[String(target),r.display_name,personId||null]);
 await c.query("UPDATE join_requests SET status='approved' WHERE telegram_id=$1",[String(target)]);return {audit:{target:String(target),personId}};});
}
export async function changeRole(actor,target,role,requestId) {
 requireThat(['admin','lead','helper','revoked'].includes(role),'Ungültige Rolle.');
 return transact(actor,'role_changed',requestId,async(c,a)=>{
  const old=(await c.query('SELECT * FROM staff WHERE telegram_id=$1',[String(target)])).rows[0];requireThat(old,'Person fehlt.');
  requireThat(a.role==='admin'||(a.role==='lead'&&old.role==='helper'&&role==='revoked'),'Nur Administratoren vergeben Leitungsrechte.');
  if(old.role==='admin'&&role!=='admin')requireThat(Number((await c.query("SELECT count(*) n FROM staff WHERE role='admin'")).rows[0].n)>1,'Der letzte Administrator muss erhalten bleiben.');
  await c.query('UPDATE staff SET role=$1 WHERE telegram_id=$2',[role,String(target)]);
  return {audit:{target:String(target),before:old.role,after:role}};
 });
}
export async function rejectAdmission(actor,target,key){return transact(actor,'admission_rejected',key,async(c,a)=>{
 requireThat(LEADS.includes(a.role),'Nur Turnierleitung.');const result=await c.query("UPDATE join_requests SET status='rejected' WHERE telegram_id=$1 AND status='pending' RETURNING telegram_id",[String(target)]);requireThat(result.rowCount,'Anfrage bereits bearbeitet.');return {audit:{target:String(target)}};
});}
