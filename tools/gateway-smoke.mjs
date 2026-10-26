import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { createGateway } from '../src/gateway.js';
if(!process.env.DATABASE_URL||!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))throw Error('Dedicated PostgreSQL test database required.');
const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),children=[],pools=[],names=['ftb_gateway_smoke_test','ftb_classic_smoke_test','ftb_turbo_smoke_test'];let server;
const database=name=>{const u=new URL(process.env.DATABASE_URL);u.pathname='/'+name;return u.href;};
try{
 for(const name of names){await admin.query(`CREATE DATABASE ${name}`);pools.push(new pg.Pool({connectionString:database(name)}));}
 const instances=[{id:'classic',name:'Tagesturnier',url:'http://127.0.0.1:3141',secret:'a'.repeat(48)},{id:'turbo',name:'Jahresrunde',url:'http://127.0.0.1:3142',secret:'b'.repeat(48)}];
 const messages=[],bot={getMe:async()=>({username:'FtbSyntheticBot'}),sendMessage:async(chat,text,options)=>{messages.push({chat,text,options});return {message_id:messages.length};},answerCallbackQuery:async()=>{},deleteMessage:async()=>{}};
 const gateway=await createGateway({bot,pool:pools[0],instances});server=gateway.app.listen(3143,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 for(const [i,instance]of instances.entries()){
  const child=spawn(process.execPath,['src/index.js'],{env:{...process.env,DATABASE_URL:database(names[i+1]),PORT:String(3141+i),INSTANCE_ID:instance.id,INSTANCE_SECRET:instance.secret,INSTANCE_MODE:i?'turbo':'classic',SITE_URL:instance.url,ALLOW_HTTP_TEST:'1',TELEGRAM_ADMIN_IDS:'1',TELEGRAM_BOT_TOKEN:'',BOT_GATEWAY_URL:'http://127.0.0.1:3143'},stdio:['ignore','ignore','pipe']});children.push(child);child.stderr.on('data',()=>{});
 }
 for(const instance of instances){let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(instance.url+'/healthz')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,150));}assert.ok(ready,'Instance must start through the gateway');}
 assert.match(await fetch(instances[0].url).then(r=>r.text()),/Teamturnier/);assert.match(await fetch(instances[1].url).then(r=>r.text()),/Turbo/);
 const message={chat:{id:1,type:'private'},message_id:100};const q=data=>({id:'synthetic-'+messages.length,from:{id:1},message,data});
 const click=async text=>{const b=messages.at(-1).options.reply_markup.inline_keyboard.flat().find(b=>b.text===text);assert.ok(b,'Missing button '+text);await gateway.onCallback(q(b.callback_data));};
 await gateway.onCallback(q('select:classic'));const originalFields=messages.at(-1).options.reply_markup.inline_keyboard.flat().find(b=>b.text==='Spielfelder').callback_data;
 await gateway.onCallback(q(originalFields));await click('Feld hinzufügen');await gateway.onMessage({from:{id:1},chat:message.chat,message_id:101,text:'Echtes RPC-Testfeld'});await click('Speichern');
 assert.equal((await pools[1].query('SELECT name FROM fields')).rows[0].name,'Echtes RPC-Testfeld');assert.equal((await pools[2].query('SELECT count(*)::int n FROM fields')).rows[0].n,0);
 await gateway.onCallback(q('select:turbo'));assert.match(messages.at(-1).text,/Jahresrunde/);await gateway.onCallback(q(originalFields));assert.match(messages.at(-1).text,/Tagesturnier/);assert.ok(messages.at(-1).options.reply_markup.inline_keyboard.flat().some(b=>b.text.includes('RPC-Testfeld')));
 const forbidden=await fetch(instances[0].url+'/internal/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'callback',payload:q('field_add')})});assert.equal(forbidden.status,403);
 console.log('OK: one gateway, two real app processes, separate PostgreSQL databases, authenticated RPC and instance-bound callbacks');
}finally{
 for(const child of children)child.kill('SIGTERM');await Promise.all(children.map(c=>c.exitCode!==null?Promise.resolve():new Promise(r=>c.once('exit',r))));
 if(server)await new Promise(r=>server.close(r));await Promise.all(pools.map(p=>p.end()));for(const name of names)await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();
}
