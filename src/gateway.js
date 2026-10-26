// One polling connection for all isolated instances. Instance credentials never reach browsers.
import { pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import TelegramBot from 'node-telegram-bot-api';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const METHODS=new Set(['sendMessage','editMessageText','deleteMessage','answerCallbackQuery','sendDocument','getFileLink','getMe']);
export function parseInstances(raw){
 let values;try{values=JSON.parse(raw||'[]');}catch{throw Error('GATEWAY_INSTANCES enthält ungültiges JSON.');}if(!Array.isArray(values)||!values.length||values.length>30)throw Error('1 bis 30 Instanzen konfigurieren.');
 const ids=new Set(),secrets=new Set();for(const x of values){if(!/^[a-z0-9-]{1,12}$/.test(x.id)||ids.has(x.id)||typeof x.name!=='string'||x.name.length>80||!x.name||typeof x.secret!=='string'||x.secret.length<32||secrets.has(x.secret))throw Error('Ungültige oder doppelte Instanzkennung/Zugangsdaten.');const u=new URL(x.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Ungültige Instanzadresse.');x.url=u.origin;ids.add(x.id);secrets.add(x.secret);}
 return values;
}
export async function createGateway({bot,pool,instances,request=fetch}){
 await pool.query(`CREATE TABLE IF NOT EXISTS gateway_selection(actor_id bigint PRIMARY KEY,instance_id text NOT NULL);
 CREATE TABLE IF NOT EXISTS gateway_groups(chat_id bigint PRIMARY KEY,instance_id text NOT NULL);
 CREATE TABLE IF NOT EXISTS gateway_callbacks(token text PRIMARY KEY,actor_id bigint NOT NULL,instance_id text NOT NULL,data text NOT NULL,expires_at timestamptz NOT NULL);
 CREATE INDEX IF NOT EXISTS gateway_callback_expiry ON gateway_callbacks(expires_at);`);
 const app=express();app.disable('x-powered-by');app.use(express.json({limit:'12mb'}));
 async function keyboard(options,instance,chat){
  if(!options?.reply_markup?.inline_keyboard)return options;
  const clone=structuredClone(options);for(const row of clone.reply_markup.inline_keyboard)for(const b of row)if(b.callback_data){const token=randomBytes(12).toString('hex');await pool.query("INSERT INTO gateway_callbacks(token,actor_id,instance_id,data,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours')",[token,String(chat),instance.id,b.callback_data]);b.callback_data='g:'+token;}
  await pool.query('DELETE FROM gateway_callbacks WHERE expires_at<now()');return clone;
 }
 app.get('/healthz',(req,res)=>res.send('ok'));
 app.post('/rpc/:id',async(req,res)=>{
  const instance=instances.find(x=>x.id===req.params.id);if(!instance||!same(req.headers.authorization,'Bearer '+instance.secret))return res.sendStatus(403);
  const {method,args}=req.body||{};if(!METHODS.has(method)||!Array.isArray(args)||args.length>5)return res.sendStatus(400);
  try{
   if(method==='sendMessage'){args[1]=`[${instance.name}]\n${String(args[1]).slice(0,3950)}`;args[2]=await keyboard(args[2],instance,args[0]);}
   if(method==='editMessageText'){args[0]=`[${instance.name}]\n${String(args[0]).slice(0,3950)}`;args[1]=await keyboard(args[1],instance,args[1]?.chat_id);}
   if(method==='sendDocument'){if(!args[1]?.ftbBuffer||typeof args[1].ftbBuffer!=='string')return res.sendStatus(400);args[1]=Buffer.from(args[1].ftbBuffer,'base64');if(args[1].length>8*1024*1024)return res.sendStatus(413);}
   res.json({result:await bot[method](...args)});
  }catch{res.status(502).json({error:'Telegram-Aktion fehlgeschlagen.'});}
 });
 async function select(chat){return bot.sendMessage(chat,'Welche Instanz möchtest du bedienen?',{reply_markup:{inline_keyboard:instances.map(x=>[{text:x.name,callback_data:'select:'+x.id}])}});}
 async function forward(instance,type,payload){const response=await request(instance.url+'/internal/update',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+instance.secret},body:JSON.stringify({type,payload}),signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Instanz nicht erreichbar.');return typeof response.json==='function'?response.json():{};}
 async function handle(type,payload){
  const msg=type==='message'?payload:payload.message;const user=payload.from;if(!user?.id)return;
  if(['group','supergroup'].includes(msg?.chat?.type)){
   if(type!=='message'||!/^\/(?:ftb_verbinden|ftb_trennen|statistik|updates)(?:@\w+)?(?:\s|$)/.test(payload.text||''))return;
   const current=(await pool.query('SELECT instance_id FROM gateway_groups WHERE chat_id=$1',[String(msg.chat.id)])).rows[0]?.instance_id;
   const bind=/^\/ftb_verbinden(?:@\w+)?\s+([a-z0-9-]{1,12})\s+[a-f0-9]{36}$/.exec(payload.text||'');
   const instance=instances.find(x=>x.id===(bind?.[1]||current));if(!instance)return;
   if(current&&bind&&bind[1]!==current)return bot.sendMessage(msg.chat.id,'Zuerst /ftb_trennen für die bisherige Instanz senden.');
   try{const result=await forward(instance,type,payload);if(result.groupBound)await pool.query('INSERT INTO gateway_groups(chat_id,instance_id) VALUES($1,$2) ON CONFLICT(chat_id) DO UPDATE SET instance_id=EXCLUDED.instance_id',[String(msg.chat.id),instance.id]);if(result.groupUnbound)await pool.query('DELETE FROM gateway_groups WHERE chat_id=$1 AND instance_id=$2',[String(msg.chat.id),instance.id]);}catch{await bot.sendMessage(msg.chat.id,'Instanz derzeit nicht erreichbar.').catch(()=>{});}return;
  }
  if(msg?.chat?.type!=='private')return;
  const chat=msg.chat.id;try{
   if(type==='message'&&/^\/instanzen(?:@\w+)?(?:\s|$)/.test(payload.text||''))return select(chat);
   if(type==='callback'&&/^select:[a-z0-9-]{1,12}$/.test(payload.data||'')){
    const instance=instances.find(x=>x.id===payload.data.slice(7));if(!instance)return;await bot.answerCallbackQuery(payload.id).catch(()=>{});await pool.query('INSERT INTO gateway_selection(actor_id,instance_id) VALUES($1,$2) ON CONFLICT(actor_id) DO UPDATE SET instance_id=EXCLUDED.instance_id',[String(user.id),instance.id]);
    return forward(instance,'message',{...msg,from:user,text:'/start'});
   }
   let instance;
   if(type==='callback'){
    const token=/^g:([a-f0-9]{24})$/.exec(payload.data||'')?.[1];const saved=token?(await pool.query('SELECT * FROM gateway_callbacks WHERE token=$1 AND actor_id=$2 AND expires_at>now()',[token,String(user.id)])).rows[0]:null;
    if(!saved){await bot.answerCallbackQuery(payload.id,{text:'Button abgelaufen. Bitte /instanzen öffnen.'}).catch(()=>{});return;}
    instance=instances.find(x=>x.id===saved.instance_id);payload={...payload,data:saved.data};
   }else{
    const login=/^\/start(?:@\w+)? web_([a-z0-9-]{1,12})_[\w-]{32}$/.exec(payload.text||'');
    const selected=login?login[1]:(await pool.query('SELECT instance_id FROM gateway_selection WHERE actor_id=$1',[String(user.id)])).rows[0]?.instance_id;
    instance=instances.find(x=>x.id===selected);
   }
   if(!instance)return select(chat);return await forward(instance,type,payload);
  }catch{await bot.sendMessage(chat,'Instanz derzeit nicht erreichbar. Bitte später erneut versuchen.').catch(()=>{});}
 }
 app.use((err,req,res,next)=>{if(!res.headersSent)res.status(400).json({error:'Ungültige Anfrage.'});});
 return {app,onMessage:m=>handle('message',m),onCallback:q=>handle('callback',q)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const instances=parseInstances(process.env.GATEWAY_INSTANCES),pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
 if(!process.env.TELEGRAM_BOT_TOKEN)throw Error('TELEGRAM_BOT_TOKEN fehlt.');
 const bot=new TelegramBot(process.env.TELEGRAM_BOT_TOKEN,{polling:false}),gateway=await createGateway({bot,pool,instances});
 // One queue per user also keeps instance switches and forwarded forms in order.
 const queues=new Map(),counts=new Map();const enqueue=(type,payload)=>{const key=String(payload.from?.id||'');if((counts.get(key)||0)>=10||queues.size>=1000&&!queues.has(key))return;counts.set(key,(counts.get(key)||0)+1);const task=(queues.get(key)||Promise.resolve()).then(()=>gateway[type](payload)).catch(()=>{});queues.set(key,task);void task.finally(()=>{counts.set(key,counts.get(key)-1);if(!counts.get(key))counts.delete(key);if(queues.get(key)===task)queues.delete(key);});};
 bot.on('message',m=>enqueue('onMessage',m));bot.on('callback_query',q=>enqueue('onCallback',q));bot.on('polling_error',()=>console.error('Telegram-Verbindung fehlgeschlagen.'));
 await bot.setMyCommands([{command:'start',description:'Aktuelle Instanz öffnen'},{command:'instanzen',description:'Instanz auswählen'},{command:'spiele',description:'Meine Spiele'},{command:'verwaltung',description:'Verwaltung'},{command:'abbrechen',description:'Dialog abbrechen'}]);
 await bot.startPolling();
 const server=gateway.app.listen(Number(process.env.PORT||3000),'0.0.0.0');process.on('SIGTERM',async()=>{await bot.stopPolling();server.close();await pool.end();});
}
