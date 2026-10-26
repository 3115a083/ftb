import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import { database } from './harness.js';
import { migrate } from '../src/db.js';
import { actor, setup, createTurbo, getMatch, matchAction, metricAction, closeField, syncGames, repairPreview, repairResult } from '../src/operations.js';
import { changeRole, requestAdmission, setEventPassword, approveAdmission } from '../src/auth.js';
import { turboStats, statisticsCsv } from '../src/statistics.js';
import { statisticsPdf } from '../src/pdf.js';
import { createBotController } from '../src/bot.js';
let db,stop;
before(async()=>{({db,stop}=await database());});
after(async()=>{await stop();});
beforeEach(async()=>{
 await db.query('TRUNCATE bot_ui_messages,site_sessions,site_accounts,site_challenges,teams,people,staff,fields,turbo_sessions,match_ops,match_roster,metric_events,join_requests,login_limits,operation_requests,audit_log,event_control RESTART IDENTITY CASCADE');
 await db.query('INSERT INTO event_control(id) VALUES(1)');
 await db.query("INSERT INTO staff(telegram_id,display_name,role) VALUES(1,'Admin','admin'),(2,'Leitung','lead'),(3,'Helfer','helper'),(4,'Helfer zwei','helper')");
 await db.query('UPDATE settings SET winner_team_id=NULL,tournament_finished=false');
});
let seq=0;const key=()=>`test-${++seq}`;
async function fixture({guest=false}={}){
 await db.query("UPDATE event_control SET mode='turbo' WHERE id=1");
 const alice=await setup(1,'person_add',{name:'Alice'},key()),bob=await setup(1,'person_add',{name:'Bob'},key());
 await setup(1,'person_link',{userId:'3',personId:alice.id},key());await setup(1,'person_link',{userId:'4',personId:bob.id},key());
 const field=await setup(1,'field_add',{name:'Feld Nord'},key());
 const session=await setup(1,'session_add',{name:'Turbo',minGames:1},key());
 const game=await createTurbo(2,{sessionId:session.id,sideA:[{personId:alice.id},...(guest?[{guestName:'Gast nur Runde 1'}]:[])],sideB:[{personId:bob.id}],coordinatorId:'3'},key());
 await matchAction(2,game.id,'assign',{fieldId:field.id,helperId:'2'},key());await matchAction(2,game.id,'start',{},key());
 return {alice,bob,field,session,game};
}
test('additive migration is repeatable and keeps existing team results',async()=>{
 const a=await setup(1,'team_add',{name:'A'},key()),b=await setup(1,'team_add',{name:'B'},key());
 await db.query("INSERT INTO games(home_team_id,away_team_id,winner_team_id,status) VALUES($1,$2,$1,'finished')",[a.id,b.id]);
 await migrate();await syncGames();assert.equal((await db.query('SELECT winner_team_id FROM games')).rows[0].winner_team_id,a.id);
});
test('guests are round-local, aggregate separately, and never enter personal rankings',async()=>{
 const f=await fixture({guest:true}),m=await getMatch(f.game.id),alice=m.roster.find(x=>x.person_id===f.alice.id),guest=m.roster.find(x=>x.guest_name);
 await metricAction(3,m.id,alice.id,'hits','add',key());
 await metricAction(3,m.id,guest.id,'received','add',key());
 await metricAction(3,m.id,0,'round','add',key());await metricAction(3,m.id,alice.id,'empty_round','add',key());
 await metricAction(3,m.id,alice.id,'received','zero',key());
 await matchAction(3,m.id,'report',{side:'A'},key());
 assert.equal((await turboStats(f.session.id)).rows.length,0);
 await assert.rejects(()=>matchAction(3,m.id,'approve',{},key()),/Turnierleitung/);
 await matchAction(2,m.id,'approve',{},key());
 const stats=await turboStats(f.session.id);assert.equal(stats.rows.length,2);assert.equal(stats.guests.played,1);assert.equal(stats.guests.metrics.received,1);
 assert.equal(stats.rows.find(x=>x.id===f.alice.id).metrics.empty_round,2);assert.equal(stats.rows.find(x=>x.id===f.alice.id).metrics.received,0);
 assert.equal((await db.query('SELECT * FROM people')).rows.length,2);assert.match(statisticsCsv(stats),/Gäste gemeinsam/);
 const next=await createTurbo(2,{sessionId:f.session.id,sideA:[{personId:f.alice.id}],sideB:[{personId:f.bob.id}]},key());assert.equal((await getMatch(next.id)).roster.some(x=>x.guest_name),false);
 const pdf=await statisticsPdf(stats);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
});
test('participants cannot change other people, but coordinator handles guests and rounds',async()=>{
 const f=await fixture({guest:true}),m=await getMatch(f.game.id),bob=m.roster.find(x=>x.person_id===f.bob.id);
 await assert.rejects(()=>metricAction(3,m.id,bob.id,'hits','add',key()),/eigene Werte/);
 await assert.rejects(()=>metricAction(4,m.id,0,'round','add',key()),/Runden/);
 await metricAction(4,m.id,bob.id,'hits','add',key());
});
test('replayed Telegram update counts once, separate clicks count twice, own undo is audited',async()=>{
 const f=await fixture(),m=await getMatch(f.game.id),subject=m.roster[0].id,k=key();
 await metricAction(3,m.id,subject,'hits','add',k);await metricAction(3,m.id,subject,'hits','add',k);
 await metricAction(3,m.id,subject,'hits','add',key());
 let rows=(await db.query("SELECT * FROM metric_events WHERE metric='hits' AND undone_by IS NULL")).rows;assert.equal(rows.length,2);
 await metricAction(3,m.id,0,'_','undo',key());rows=(await db.query('SELECT * FROM metric_events WHERE undone_by IS NOT NULL')).rows;assert.equal(rows.length,1);
});
test('pause and field closure reserve the field and prevent unapproved resume',async()=>{
 const f=await fixture();await matchAction(2,f.game.id,'helper',{helperId:'3'},key());
 await matchAction(3,f.game.id,'pause',{},key());await closeField(2,f.field.id,'pause',key());
 await assert.rejects(()=>matchAction(3,f.game.id,'resume',{},key()),/geschlossen/);
 await assert.rejects(()=>metricAction(3,f.game.id,0,'round','add',key()),/verändert/);
 await closeField(2,f.field.id,'open',key());await matchAction(3,f.game.id,'resume',{},key());assert.equal((await getMatch(f.game.id)).status,'live');
 await matchAction(3,f.game.id,'report',{side:'B'},key());
 const another=await createTurbo(2,{sessionId:f.session.id,sideA:[{guestName:'X'}],sideB:[{guestName:'Y'}]},key());
 await assert.rejects(()=>matchAction(2,another.id,'assign',{fieldId:f.field.id,helperId:'2'},key()),/belegt/);
 await matchAction(2,f.game.id,'approve',{},key());await matchAction(2,another.id,'assign',{fieldId:f.field.id,helperId:'2'},key());
});
test('classic helper own-team assignment is rejected',async()=>{
 const a=await setup(1,'team_add',{name:'A'},key()),b=await setup(1,'team_add',{name:'B'},key());
 const person=await setup(1,'person_add',{name:'Playing helper',teamId:a.id},key());await setup(1,'person_link',{userId:'3',personId:person.id},key());
 await db.query('INSERT INTO games(home_team_id,away_team_id) VALUES($1,$2)',[a.id,b.id]);await syncGames();const mid=(await db.query('SELECT id FROM match_ops')).rows[0].id;
 const field=await setup(1,'field_add',{name:'Court'},key());await assert.rejects(()=>matchAction(2,mid,'assign',{fieldId:field.id,helperId:'3'},key()),/eigenen Teams/);
});
test('roles cannot self-escalate and the last administrator cannot be removed',async()=>{
 await assert.rejects(()=>changeRole(2,3,'admin',key()),/Administratoren/);
 await assert.rejects(()=>changeRole(1,1,'revoked',key()),/letzte Administrator/);
 await changeRole(1,2,'admin',key());await changeRole(1,1,'lead',key());assert.equal((await actor(2)).role,'admin');
});
test('shared password only creates a pending request, throttles persist, rotation invalidates pending requests',async()=>{
 await setEventPassword(1,'Example test password 43!',key());
 assert.equal(await requestAdmission({id:9,first_name:'New'},'Example test password 43!'),true);
 assert.equal(await actor(9),undefined);
 await approveAdmission(2,9,null,key());assert.equal((await actor(9)).role,'helper');
 assert.equal(await requestAdmission({id:10,first_name:'Pending'},'Example test password 43!'),true);
 await setEventPassword(2,'New example password 91!',key());await assert.rejects(()=>approveAdmission(2,10,null,key()),/gültig/);
 assert.equal(await requestAdmission({id:11,first_name:'Bad'},'incorrect-password'),false);
 const before=(await db.query("SELECT count FROM login_limits WHERE key='11'")).rows[0].count;
 assert.equal(await requestAdmission({id:11,first_name:'Bad'},'incorrect-password'),false);
 assert.equal((await db.query("SELECT count FROM login_limits WHERE key='11'")).rows[0].count,before);
 const audits=(await db.query('SELECT details FROM audit_log')).rows;assert.ok(!JSON.stringify(audits).includes('Example test password'));
});
test('stale approvals and revoked helpers cannot change state',async()=>{
 const f=await fixture(),before=await getMatch(f.game.id);await matchAction(3,f.game.id,'report',{side:'A',version:before.version},key());
 await assert.rejects(()=>matchAction(2,f.game.id,'approve',{version:before.version},key()),/Veralteter/);
 await matchAction(2,f.game.id,'approve',{},key());await assert.rejects(()=>matchAction(2,f.game.id,'approve',{},key()),/bearbeitet/);
 await changeRole(2,3,'revoked',key());await assert.rejects(()=>metricAction(3,f.game.id,0,'round','add',key()),/Berechtigung/);
});
test('repair previews protect against changed dependencies and preserve annulled results in audit',async()=>{
 const a=await setup(1,'team_add',{name:'A'},key()),b=await setup(1,'team_add',{name:'B'},key());
 await db.query("INSERT INTO games(home_team_id,away_team_id,winner_team_id,status,phase,round_no,round_label) VALUES($1,$2,$1,'finished','group',1,'Gruppe'),($1,$2,$1,'finished','knockout',2,'Finale')",[a.id,b.id]);await syncGames();
 const mid=(await db.query("SELECT o.id FROM match_ops o JOIN games g ON g.id=o.game_id WHERE g.phase='group'")).rows[0].id;
 const preview=await repairPreview(mid);assert.equal(preview.affected.length,1);
 await assert.rejects(()=>repairResult(3,mid,{side:'B',reason:'wrong',token:preview.token},key()),/Turnierleitung/);
 await db.query('UPDATE match_ops SET version=version+1 WHERE id=$1',[preview.affected[0].id]);
 await assert.rejects(()=>repairResult(2,mid,{side:'B',reason:'wrong',token:preview.token},key()),/Auswirkungen/);
 const fresh=await repairPreview(mid);await repairResult(2,mid,{side:'B',reason:'Verwechslung geprüft',token:fresh.token},key());
 assert.equal((await getMatch(fresh.affected[0].id)).status,'cancelled');
 const log=(await db.query("SELECT details FROM audit_log WHERE action='result_repaired'")).rows[0].details;assert.equal(log.annulled[0].winner_team_id,a.id);
});
test('bot role menus, real quick action path and stale draft rejection',async()=>{
 const f=await fixture();const sent=[];const bot={sendMessage:async(chat,text,options)=>{sent.push({chat,text,options});return{};},answerCallbackQuery:async()=>{},deleteMessage:async()=>{},sendDocument:async()=>{}};
 const controller=createBotController(bot),q=(data,id=3)=>({id:key(),data,from:{id,first_name:'Helfer'},message:{chat:{id,type:'private'}}});
 await controller.onCallback(q('home'));assert.ok(!sent.at(-1).options.reply_markup.inline_keyboard.flat().some(b=>b.text==='Verwaltung'));
 await controller.onCallback(q('subject:'+f.game.id+':'+(await getMatch(f.game.id)).roster[0].id));assert.match(sent.at(-1).text,/Schnellaktionen/);
 await controller.onCallback(q('p:title'));assert.match(sent.at(-1).text,/Turnierleitung/);
 await controller.onCallback(q('p:title',2));const token=controller.drafts.get('2').nonce;
 await controller.onMessage({message_id:20,from:{id:2},chat:{id:2,type:'private'},text:'New title'});
 await controller.onCallback(q('abort',2));await controller.onCallback(q('form:save:'+token,2));assert.match(sent.at(-1).text,/Veralteter/);
});
test('PostgreSQL serializes concurrent metric requests and duplicate approvals',{skip:!process.env.DATABASE_URL},async()=>{
 const f=await fixture(),m=await getMatch(f.game.id),subject=m.roster[0].id;
 await Promise.all(Array.from({length:10},()=>metricAction(3,m.id,subject,'hits','add',key())));
 assert.equal(Number((await db.query("SELECT sum(amount) n FROM metric_events WHERE metric='hits'")).rows[0].n),10);
 await matchAction(3,m.id,'report',{side:'A'},key());const results=await Promise.allSettled([matchAction(1,m.id,'approve',{},key()),matchAction(2,m.id,'approve',{},key())]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
});

test('public statistics, PDF and CSV use approved data without Telegram identities',async()=>{
 const f=await fixture({guest:true});await matchAction(3,f.game.id,'report',{side:'B'},key());await matchAction(2,f.game.id,'approve',{},key());
 const { app }=await import('../src/index.js');const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  const html=await fetch(base+'/statistik?s='+f.session.id).then(r=>r.text());assert.match(html,/Gäste gemeinsam/);assert.match(html,/Bob/);assert.ok(!html.includes('telegram_id'));
  const csv=await fetch(base+`/statistik/${f.session.id}.csv`);assert.match(csv.headers.get('content-type'),/text\/csv/);assert.match(await csv.text(),/Gäste gemeinsam/);
  const pdf=await fetch(base+`/statistik/${f.session.id}.pdf`);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
  assert.equal((await fetch(base+'/turnier.pdf')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('a completed session rejects starting a remaining planned match',async()=>{
 const f=await fixture();await matchAction(3,f.game.id,'report',{side:'A'},key());await matchAction(2,f.game.id,'approve',{},key());
 const next=await createTurbo(2,{sessionId:f.session.id,sideA:[{personId:f.alice.id}],sideB:[{personId:f.bob.id}]},key());await setup(2,'session_finish',{id:f.session.id},key());
 await assert.rejects(()=>matchAction(2,next.id,'assign',{fieldId:f.field.id,helperId:'2'},key()),/beendet/);
});

test('classic approval controls standings and final propagation atomically',async()=>{
 const {standings}=await import('../src/tournament.js');const teams=[];
 for(const name of ['AA','AB','BA','BB'])teams.push(await setup(1,'team_add',{name},key()));
 for(let i=0;i<teams.length;i++)await setup(1,'team_edit',{id:teams[i].id,field:'group_name',value:i<2?'A':'B'},key());
 await setup(2,'group_games',{},key());const field=await setup(2,'field_add',{name:'Finalfeld'},key());
 for(const row of (await db.query('SELECT id FROM match_ops ORDER BY id')).rows){
  await matchAction(2,row.id,'assign',{fieldId:field.id,helperId:'3'},key());await matchAction(3,row.id,'start',{},key());await matchAction(3,row.id,'report',{side:'A'},key());
  assert.ok((await standings()).flatMap(g=>g.teams).every(t=>t.wins===0)||row.id>1);
  await matchAction(2,row.id,'approve',{},key());
 }
 await setup(2,'knockout',{mode:'bo3'},key());
 for(let round=0;round<2;round++){
  const m=(await db.query("SELECT o.id FROM match_ops o JOIN games g ON g.id=o.game_id WHERE g.phase='knockout' AND o.status='planned' ORDER BY o.id LIMIT 1")).rows[0];
  assert.ok(m);await matchAction(2,m.id,'assign',{fieldId:field.id,helperId:'3'},key());await matchAction(3,m.id,'start',{},key());await matchAction(3,m.id,'report',{side:'A'},key());
  assert.equal((await db.query('SELECT tournament_finished FROM settings WHERE id=1')).rows[0].tournament_finished,false);
  await matchAction(2,m.id,'approve',{},key());
 }
 assert.equal((await db.query('SELECT tournament_finished FROM settings WHERE id=1')).rows[0].tournament_finished,true);
 assert.equal(Number((await db.query("SELECT count(*) n FROM games WHERE series_key='final' AND status<>'cancelled'")).rows[0].n),2);
});

test('separate guest appearances accumulate across rounds without becoming people',async()=>{
 const f=await fixture({guest:true});let m=await getMatch(f.game.id);
 await metricAction(3,m.id,m.roster.find(r=>r.guest_name).id,'hits','add',key());await matchAction(3,m.id,'report',{side:'A'},key());await matchAction(2,m.id,'approve',{},key());
 const next=await createTurbo(2,{sessionId:f.session.id,sideA:[{personId:f.alice.id}],sideB:[{personId:f.bob.id},{guestName:'Different guest'}],coordinatorId:'4'},key());
 await matchAction(2,next.id,'assign',{fieldId:f.field.id,helperId:'2'},key());await matchAction(2,next.id,'start',{},key());m=await getMatch(next.id);
 for(let i=0;i<2;i++)await metricAction(4,m.id,m.roster.find(r=>r.guest_name).id,'hits','add',key());
 await matchAction(4,m.id,'report',{side:'B'},key());await matchAction(2,m.id,'approve',{},key());
 const stats=await turboStats(f.session.id);assert.equal(stats.guests.played,2);assert.equal(stats.guests.metrics.hits,3);assert.equal(stats.rows.length,2);assert.ok(stats.rows.every(p=>p.played===2));
 assert.equal(Number((await db.query('SELECT count(*) n FROM people')).rows[0].n),2);
});

test('page drafts reject stale changes instead of overwriting another leader',async()=>{
 const {savePage}=await import('../src/page-settings.js');const version=(await db.query('SELECT version FROM settings WHERE id=1')).rows[0].version;
 await savePage(1,'title',{value:'First change',expectedVersion:version},key());
 await assert.rejects(()=>savePage(2,'title',{value:'Stale change',expectedVersion:version},key()),/inzwischen geändert/);
 assert.equal((await db.query('SELECT title FROM settings WHERE id=1')).rows[0].title,'First change');
});

test('an unlinked helper is not a participant merely because a guest has no person ID',async()=>{
 const f=await fixture({guest:true});await db.query("INSERT INTO staff(telegram_id,display_name,role) VALUES(5,'Unlinked helper','helper')");
 await assert.rejects(()=>matchAction(5,f.game.id,'report',{side:'A'},key()),/Meldeberechtigung/);
 await matchAction(2,f.game.id,'helper',{helperId:'5'},key());const m=await getMatch(f.game.id);
 await metricAction(5,m.id,m.roster.find(r=>r.person_id===f.alice.id).id,'hits','add',key());
});

test('Telegram wizard creates a round-local guest using names and buttons',async()=>{
 const f=await fixture(),messages=[];const bot={sendMessage:async(chat,text,options)=>{messages.push({text,options});return{};},answerCallbackQuery:async()=>{},deleteMessage:async()=>{}};
 const controller=createBotController(bot);const q=data=>({id:key(),data,from:{id:2},message:{chat:{id:2,type:'private'}}});
 const click=async label=>{const b=messages.at(-1).options.reply_markup.inline_keyboard.flat().find(x=>x.text===label);assert.ok(b,`Button ${label}`);await controller.onCallback(q(b.callback_data));};
 await controller.onCallback(q('turbo:'+f.session.id+':manual'));await click('Alice');await click('Auswahl übernehmen');
 await controller.onMessage({message_id:44,from:{id:2},chat:{id:2,type:'private'},text:'Gast nur jetzt'});
 await click('Bob');await click('Auswahl übernehmen');await click('Überspringen');await click('Überspringen');await click('Helfer');
 assert.match(messages.at(-1).text,/Alice/);assert.match(messages.at(-1).text,/Bob/);await click('Speichern');
 const newest=(await db.query('SELECT id FROM match_ops ORDER BY id DESC LIMIT 1')).rows[0];const m=await getMatch(newest.id);assert.equal(m.status,'planned');assert.equal(m.roster.filter(r=>r.guest_name).length,1);assert.equal(m.roster.find(r=>r.guest_name).guest_name,'Gast nur jetzt');
});

test('mode switches are admin-only, persist and refuse occupied fields',async()=>{
 const {configureSite,siteConfig}=await import('../src/site-control.js');
 await assert.rejects(()=>configureSite(2,{mode:'turbo'},key()),/Administrator/);
 await configureSite(1,{mode:'turbo',minGames:2,tiebreakers:['hits']},key());await migrate();assert.equal((await siteConfig()).mode,'turbo');assert.deepEqual((await turboStats(null)).session.tiebreakers,['hits']);
 const f=await fixture();await db.query("UPDATE event_control SET mode='classic' WHERE id=1");await configureSite(1,{mode:'turbo'},key());await assert.rejects(()=>configureSite(1,{mode:'classic'},key()),/abschließen/);
 await matchAction(1,f.game.id,'cancel',{reason:'Test beendet'},key());await configureSite(1,{mode:'classic'},key());
 const wrong=await createTurbo(1,{sessionId:f.session.id,sideA:[{personId:f.alice.id}],sideB:[{personId:f.bob.id}]},key());
 await assert.rejects(()=>matchAction(1,wrong.id,'assign',{fieldId:f.field.id,helperId:1},key()),/anderen Instanzmodus/);
});
test('year and day filters count only approved appearances, guests and exports in the selected period',async()=>{
 const f=await fixture({guest:true});await db.query("UPDATE match_ops SET played_on='2025-12-31' WHERE id=$1",[f.game.id]);
 await matchAction(1,f.game.id,'report',{side:'A'},key());await matchAction(1,f.game.id,'approve',{},key());
 let s=await turboStats(null,db,{year:'2026'});assert.equal(s.rows.length,0);assert.equal(s.guests.played,0);
 s=await turboStats(null,db,{year:'2025',day:'2025-12-31'});assert.equal(s.rows.length,2);assert.equal(s.guests.played,1);assert.equal(s.rows[0].qualified,false);assert.match(statisticsCsv(s),/Spieltag 2025-12-31/);
 await assert.rejects(()=>turboStats(null,db,{year:'2026',day:'2025-12-31'}),/passt nicht/);
});
test('public live data hides pending winners and exposes preliminary metrics without staff identities',async()=>{
 const f=await fixture({guest:true}),m=await getMatch(f.game.id);await metricAction(1,m.id,m.roster[0].id,'hits','add',key());await matchAction(1,m.id,'report',{side:'A'},key());
 const {app}=await import('../src/index.js'),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{
  const base=`http://127.0.0.1:${server.address().port}`,r=await fetch(base+'/api/live'),data=await r.json();assert.match(data.fieldsHtml,/Werte vorläufig/);assert.match(data.fieldsHtml,/Treffer/);assert.ok(!data.fieldsHtml.includes('Gewonnen:'));assert.ok(!JSON.stringify(data).includes('telegram_id'));
  await matchAction(1,m.id,'approve',{},key());assert.match((await fetch(base+'/api/live').then(r=>r.json())).fieldsHtml,/Wartet auf die nächste/);
 }finally{await new Promise(r=>server.close(r));}
});
async function loginServer(fn){
 process.env.ALLOW_HTTP_TEST='1';const {app}=await import('../src/index.js'),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{await fn(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(r=>server.close(r));delete process.env.TELEGRAM_BOT_USERNAME;}
}
const cookiePair=r=>(r.headers.getSetCookie?.()||[]).map(x=>x.split(';')[0]).join('; ');
const formToken=html=>/name="csrf" value="([\w-]+)"/.exec(html)?.[1]||/name="csrf-token" content="([\w-]+)"/.exec(html)?.[1];
test('combined website login protects exports, remembers sessions, prevents CSRF and revokes accounts',async()=>{
 const {configureSite,saveSiteAccount}=await import('../src/site-control.js');await configureSite(1,{password:'Shared website password!',methods:['password','account']},key());
 await saveSiteAccount(1,{username:'visitor',password:'Private account password!'},key());assert.equal(await actor(77),undefined);
 await loginServer(async base=>{
  assert.equal((await fetch(base+'/favicon.ico')).status,204);
  const locked=await fetch(base+'/statistik/gesamt.csv',{redirect:'manual'});assert.equal(locked.status,302);assert.equal(locked.headers.get('location'),'/login?next=%2Fstatistik%2Fgesamt.csv');
  const form=await fetch(base+'/login'),html=await form.text(),cookie=cookiePair(form),csrf=formToken(html);assert.equal(form.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  assert.equal((await fetch(base+'/login',{method:'POST',headers:{cookie,'Content-Type':'application/x-www-form-urlencoded',origin:'null'},body:new URLSearchParams({csrf,method:'account',username:'visitor',password:'Private account password!'}),redirect:'manual'})).status,403);
  assert.equal((await fetch(base+'/login',{method:'POST',headers:{cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({method:'account',username:'visitor',password:'Private account password!'}),redirect:'manual'})).status,403);
  const login=await fetch(base+'/login',{method:'POST',headers:{cookie,'Content-Type':'application/x-www-form-urlencoded',origin:base},body:new URLSearchParams({csrf,method:'account',username:'visitor',password:'Private account password!',remember:'1'}),redirect:'manual'});assert.equal(login.status,303);assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/Max-Age=2592000/);
  assert.equal(Number((await db.query("SELECT count FROM login_limits WHERE key LIKE 'site:%' AND key<>'site:global'")).rows[0].count),0);
  const session=cookiePair(login);assert.equal((await fetch(base+'/statistik/gesamt.csv',{headers:{cookie:session}})).status,200);
  const account=(await db.query("SELECT id FROM site_accounts WHERE username='visitor'")).rows[0];await saveSiteAccount(1,{id:account.id,active:false},key());assert.equal((await fetch(base+'/',{headers:{cookie:session},redirect:'manual'})).status,302);
  const publicAgain=await configureSite(1,{methods:[]},key());assert.ok(publicAgain);assert.equal((await fetch(base+'/')).status,200);
 });
});
test('Telegram website login requires allowed identity, explicit consent and the initiating browser',async()=>{
 const {configureSite,saveSiteAccount}=await import('../src/site-control.js');const {confirmWebLogin}=await import('../src/site-auth.js');
 await configureSite(1,{methods:['telegram']},key());await saveSiteAccount(1,{username:'telegram-viewer',telegramId:'77'},key());process.env.TELEGRAM_BOT_USERNAME='FtbTestBot';
 await loginServer(async base=>{
  const r=await fetch(base+'/login'),csrf=formToken(await r.text()),cookie=cookiePair(r);
  const start=await fetch(base+'/login/telegram',{method:'POST',headers:{cookie,'Content-Type':'application/x-www-form-urlencoded',origin:base},body:new URLSearchParams({csrf,remember:'1',next:'/personen/7?page=2'})});const html=await start.text(),token=/data-token="([\w-]+)"/.exec(html)?.[1];assert.ok(token);assert.match(html,/web_local_/);
  await assert.rejects(()=>confirmWebLogin(token,78,true),/freigegeben/);await confirmWebLogin(token,77,false);
  const check=extra=>fetch(base+'/login/telegram/check',{method:'POST',headers:{cookie:extra,'Content-Type':'application/x-www-form-urlencoded',origin:base},body:new URLSearchParams({csrf,token})});
  const bound=cookie+'; '+cookiePair(start);await configureSite(1,{minGames:3},key());assert.deepEqual(await check(bound).then(r=>r.json()),{ready:false});await confirmWebLogin(token,77,true);
  assert.equal((await check(cookie)).status,403);const finish=await check(bound);assert.deepEqual(await finish.json(),{ready:true,next:'/personen/7?page=2'});assert.ok(cookiePair(finish).includes('ftb-session='));assert.equal((await check(bound)).status,410);
 });
});
test('website brute-force limits survive new clients and rotation invalidates shared sessions',async()=>{
 const {configureSite}=await import('../src/site-control.js');const {reserveLogin}=await import('../src/site-auth.js');
 for(let i=0;i<8;i++)assert.equal(await reserveLogin('limit-test'),true);assert.equal(await reserveLogin('limit-test'),false);assert.equal(Number((await db.query("SELECT count FROM login_limits WHERE key='site:global'")).rows[0].count),8);
 await configureSite(1,{password:'Shared password old!',methods:['password']},key());await loginServer(async base=>{
  const r=await fetch(base+'/login'),csrf=formToken(await r.text()),cookie=cookiePair(r);
  const login=await fetch(base+'/login',{method:'POST',headers:{cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,method:'password',password:'Shared password old!'}),redirect:'manual'});assert.equal(login.status,303);assert.ok(!login.headers.get('set-cookie').includes('Max-Age'));
  const session=cookiePair(login);await configureSite(1,{password:'Shared password new!'},key());assert.equal((await fetch(base+'/',{headers:{cookie:session},redirect:'manual'})).status,302);
 });
});
test('website return destinations stay internal and preserve filters through failed and successful logins',async()=>{
 const {returnPath}=await import('../src/site-auth.js');
 for(const unsafe of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','/login','/internal/update','/%2f%2fevil.invalid','/statistik\n','/statistik/../../login'])assert.equal(returnPath(unsafe),'/',unsafe);
 for(const safe of ['/spiele/12','/personen/7?page=2','/statistik?year=2025&day=2025-12-31','/statistik/12.pdf','/statistik/gesamt.csv'])assert.equal(returnPath(safe),safe);
 const {configureSite}=await import('../src/site-control.js');await configureSite(1,{password:'Return destination password!',methods:['password']},key());
 await loginServer(async base=>{
  const target='/statistik?year=2025&day=2025-12-31',locked=await fetch(base+target,{redirect:'manual'});
  assert.equal(locked.headers.get('location'),'/login?next='+encodeURIComponent(target));
  const form=await fetch(base+locked.headers.get('location')),html=await form.text(),csrf=formToken(html),cookie=cookiePair(form);assert.match(html,/name="next" value="\/statistik\?year=2025&amp;day=2025-12-31"/);
  const submit=password=>fetch(base+'/login',{method:'POST',headers:{cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,method:'password',password,next:target}),redirect:'manual'});
  const failed=await submit('Wrong password');assert.equal(failed.status,401);assert.match(await failed.text(),/name="next" value="\/statistik\?year=2025&amp;day=2025-12-31"/);
  const login=await submit('Return destination password!');assert.equal(login.headers.get('location'),target);const session=cookiePair(login);
  await configureSite(1,{minGames:5,timezone:'Europe/Brussels',tiebreakers:['hits']},key());assert.equal((await fetch(base+target,{headers:{cookie:session},redirect:'manual'})).status,200);
  assert.equal((await fetch(base+'/login?next=//evil.invalid',{headers:{cookie:session},redirect:'manual'})).headers.get('location'),'/');
  await configureSite(1,{revokeSessions:true},key());assert.equal((await fetch(base+target,{headers:{cookie:session},redirect:'manual'})).status,302);
 });
});
test('expired Telegram challenges cannot issue sessions and explicit revocation cancels pending logins',async()=>{
 const {configureSite,saveSiteAccount}=await import('../src/site-control.js');const {confirmWebLogin,digest}=await import('../src/site-auth.js');
 await configureSite(1,{methods:['telegram']},key());await saveSiteAccount(1,{username:'telegram-viewer',telegramId:'77'},key());process.env.TELEGRAM_BOT_USERNAME='FtbTestBot';
 await loginServer(async base=>{
  const r=await fetch(base+'/login'),csrf=formToken(await r.text()),cookie=cookiePair(r);
  const start=async()=>{const r=await fetch(base+'/login/telegram',{method:'POST',headers:{cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,next:'//evil.invalid'})}),html=await r.text();assert.match(html,/data-expires="/);return {token:/data-token="([\w-]+)"/.exec(html)[1],bound:cookie+'; '+cookiePair(r)};};
  const check=c=>fetch(base+'/login/telegram/check',{method:'POST',headers:{cookie:c.bound,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,token:c.token})});
  const expired=await start();await confirmWebLogin(expired.token,77,true);await db.query("UPDATE site_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(expired.token)]);assert.equal((await check(expired)).status,410);assert.equal(Number((await db.query('SELECT count(*) FROM site_sessions')).rows[0].count),0);
  const revoked=await start();await configureSite(1,{revokeSessions:true},key());assert.equal((await check(revoked)).status,410);await assert.rejects(()=>confirmWebLogin(revoked.token,77,true),/abgelaufen/);
  const good=await start();await confirmWebLogin(good.token,77,true);assert.deepEqual(await check(good).then(r=>r.json()),{ready:true,next:'/'});
 });
});
test('gateway binds old buttons to their originating instance and user across switches and restarts',async()=>{
 const {createGateway,parseInstances}=await import('../src/gateway.js');
 const instances=parseInstances(JSON.stringify([{id:'one',name:'Erste',url:'http://one:3000',secret:'a'.repeat(48)},{id:'two',name:'Zweite',url:'http://two:3000',secret:'b'.repeat(48)}]));
 const messages=[],forwarded=[],bot={sendMessage:async(...args)=>{messages.push(args);return {message_id:1};},answerCallbackQuery:async()=>{}};
 const request=async(url,options)=>{forwarded.push({url,body:JSON.parse(options.body)});return {ok:true};};
 const gateway=await createGateway({bot,pool:db,instances,request});const server=gateway.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const from={id:1},message={chat:{id:1,type:'private'},message_id:2};try{
  const r=await fetch(`http://127.0.0.1:${server.address().port}/rpc/one`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+instances[0].secret},body:JSON.stringify({method:'sendMessage',args:[1,'Spiel prüfen',{reply_markup:{inline_keyboard:[[{text:'Freigeben',callback_data:'approve:12:2'}]]}}]})});assert.equal(r.status,200);const old=messages.at(-1)[2].reply_markup.inline_keyboard[0][0].callback_data;assert.ok(Buffer.byteLength(old)<=64);assert.match(messages.at(-1)[1],/Erste/);
  await gateway.onCallback({id:'select',from,message,data:'select:two'});assert.match(forwarded.at(-1).url,/two/);
  const restarted=await createGateway({bot,pool:db,instances,request});await restarted.onCallback({id:'old',from,message,data:old});assert.match(forwarded.at(-1).url,/one/);assert.equal(forwarded.at(-1).body.payload.data,'approve:12:2');
  const before=forwarded.length;await restarted.onCallback({id:'stolen',from:{id:2},message:{chat:{id:2,type:'private'}},data:old});assert.equal(forwarded.length,before);
  await restarted.onMessage({from,message_id:3,chat:message.chat,text:'/start web_one_'+'x'.repeat(32)});assert.match(forwarded.at(-1).url,/one/);
  const forbidden=await fetch(`http://127.0.0.1:${server.address().port}/rpc/one`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(forbidden.status,403);
 }finally{await new Promise(r=>server.close(r));}
});

test('LAN HTTP serves assets without upgrading them while production retains HTTPS protections',async()=>{
 const {app}=await import('../src/index.js'),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const old=process.env.ALLOW_HTTP_TEST;
 try{const base=`http://127.0.0.1:${server.address().port}`;
  process.env.ALLOW_HTTP_TEST='1';const testPage=await fetch(base+'/');assert.ok(!testPage.headers.get('content-security-policy').includes('upgrade-insecure-requests'));assert.equal(testPage.headers.get('strict-transport-security'),null);
  for(const [file,type] of [['site.css','text/css'],['site.js','javascript'],['theme.js','javascript']]){const r=await fetch(base+'/assets/'+file);assert.equal(r.status,200);assert.ok(r.headers.get('content-type').includes(type));assert.ok(!r.headers.get('content-security-policy').includes('upgrade-insecure-requests'));}
  delete process.env.ALLOW_HTTP_TEST;const secure=await fetch(base+'/');assert.match(secure.headers.get('content-security-policy'),/upgrade-insecure-requests/);assert.ok(secure.headers.get('strict-transport-security'));
 }finally{if(old===undefined)delete process.env.ALLOW_HTTP_TEST;else process.env.ALLOW_HTTP_TEST=old;await new Promise(r=>server.close(r));}
});
test('Turbo onboarding omits finals and approved games never finish the ongoing series',async()=>{
 const {savePage}=await import('../src/page-settings.js');await db.query("UPDATE event_control SET mode='turbo' WHERE id=1");
 const sent=[],controller=createBotController({sendMessage:async(chat,text,options)=>{sent.push({text,options});return{};},answerCallbackQuery:async()=>{},deleteMessage:async()=>{}});
 const q=data=>({id:key(),data,from:{id:1},message:{chat:{id:1,type:'private'}}});
 await controller.onCallback(q('p:onboarding'));assert.ok(!controller.drafts.get('1').fields.some(x=>x.key==='final_mode'));await controller.onCallback(q('abort'));
 await controller.onCallback(q('overview'));assert.match(sent.at(-1).text,/fortlaufende Spiele ohne Finalspiel/);assert.ok(!sent.at(-1).text.includes('Gruppen'));
 await savePage(1,'onboarding',{title:'Jahresrunde',primary:'#15803D',secondary:'#FFFFFF',accent:'#111111'},key());
 await assert.rejects(()=>savePage(1,'final_mode',{value:'bo3'},key()),/keinen Finalmodus/);await assert.rejects(()=>setup(1,'knockout',{mode:'single'},key()),/kein Finalspiel/);
 const f=await fixture();for(let i=0;i<3;i++){
  const game=i===0?f.game:await createTurbo(2,{sessionId:f.session.id,sideA:[{personId:f.bob.id}],sideB:[{personId:f.alice.id},{guestName:'Gast '+i}]},key());
  if(i){await matchAction(2,game.id,'assign',{fieldId:f.field.id,helperId:'2'},key());await matchAction(2,game.id,'start',{},key());}
  await matchAction(2,game.id,'report',{side:'A'},key());await matchAction(1,game.id,'approve',{},key());
  assert.equal((await db.query('SELECT finished FROM turbo_sessions WHERE id=$1',[f.session.id])).rows[0].finished,false);
 }
 assert.equal(Number((await db.query('SELECT count(*) FROM games')).rows[0].count),0);
 await db.query("UPDATE event_control SET mode='classic' WHERE id=1");await controller.onCallback(q('p:onboarding'));assert.ok(controller.drafts.get('1').fields.some(x=>x.key==='final_mode'));
});
test('Telegram logo uploads preserve PNG bytes and reject documents with misleading image types',async()=>{
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=','base64');
 const sent=[],controller=createBotController({sendMessage:async(chat,text)=>{sent.push(text);return{};},getFileLink:async()=> 'https://api.telegram.org/file/botTEST/logo.png',answerCallbackQuery:async()=>{},deleteMessage:async()=>{}}),q=data=>({id:key(),data,from:{id:1},message:{chat:{id:1,type:'private'}}});
 const realFetch=globalThis.fetch;try{
  await controller.onCallback(q('p:logo'));const nonce=controller.drafts.get('1').nonce;globalThis.fetch=async()=>new Response(bytes);
  await controller.onMessage({message_id:10,from:{id:1},chat:{id:1,type:'private'},document:{file_id:'png',file_size:bytes.length,mime_type:'image/png'}});
  assert.equal(controller.drafts.get('1').values.value,'data:image/png;base64,'+bytes.toString('base64'));await controller.onCallback(q('form:save:'+nonce));assert.equal((await db.query('SELECT logo FROM settings WHERE id=1')).rows[0].logo,'data:image/png;base64,'+bytes.toString('base64'));
  await controller.onCallback(q('p:logo'));await controller.onMessage({message_id:11,from:{id:1},chat:{id:1,type:'private'},document:{file_id:'svg',file_size:100,mime_type:'image/svg+xml'}});assert.match(sent.at(-1),/PNG- oder JPEG-Datei/);
  await controller.onMessage({message_id:12,from:{id:1},chat:{id:1,type:'private'},document:{file_id:'mismatch',file_size:bytes.length,mime_type:'image/jpeg'}});assert.match(sent.at(-1),/passen nicht zusammen/);
 }finally{globalThis.fetch=realFetch;}
});
test('bot navigation cleanup persists across restarts and only removes a menu after replacement succeeds',async()=>{
 let nextId=100,failSend=false,failDelete=false;const deleted=[],delivered=[];
 const bot={sendMessage:async(chat,text)=>{if(failSend)throw Error('Synthetic delivery failure');const id=++nextId;delivered.push({chat,id});return {message_id:id};},answerCallbackQuery:async()=>{},deleteMessage:async(chat,id)=>{deleted.push({chat,id});if(failDelete)throw Error('Synthetic delete denied');}};
 const q=(data,id=1)=>({id:key(),data,from:{id},message:{chat:{id,type:'private'}}});
 let controller=createBotController(bot);await controller.onCallback(q('home'));assert.deepEqual(deleted,[]);await controller.onCallback(q('help'));assert.deepEqual(deleted,[{chat:1,id:101}]);
 controller=createBotController(bot);await controller.onCallback(q('home'));assert.deepEqual(deleted.at(-1),{chat:1,id:102});
 await controller.onMessage({message_id:20,from:{id:1},chat:{id:1,type:'private'},text:'/start'});assert.deepEqual(deleted.slice(-2),[{chat:1,id:103},{chat:1,id:20}]);
 const before=deleted.length;failSend=true;await controller.onCallback(q('help'));assert.equal(deleted.length,before);assert.equal(Number((await db.query('SELECT message_id FROM bot_ui_messages WHERE chat_id=1')).rows[0].message_id),104);
 failSend=false;failDelete=true;await controller.onCallback(q('help'));assert.equal(Number((await db.query('SELECT message_id FROM bot_ui_messages WHERE chat_id=1')).rows[0].message_id),105);failDelete=false;
 await controller.onCallback(q('home',2));assert.ok(!deleted.some(x=>x.chat===2));
});
