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
 await db.query('TRUNCATE teams,people,staff,fields,turbo_sessions,match_ops,match_roster,metric_events,join_requests,login_limits,operation_requests,audit_log,event_control RESTART IDENTITY CASCADE');
 await db.query('INSERT INTO event_control(id) VALUES(1)');
 await db.query("INSERT INTO staff(telegram_id,display_name,role) VALUES(1,'Admin','admin'),(2,'Leitung','lead'),(3,'Helfer','helper'),(4,'Helfer zwei','helper')");
 await db.query('UPDATE settings SET winner_team_id=NULL,tournament_finished=false');
});
let seq=0;const key=()=>`test-${++seq}`;
async function fixture({guest=false}={}){
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
 await click('Bob');await click('Auswahl übernehmen');await click('Überspringen');await click('Helfer');
 assert.match(messages.at(-1).text,/Alice/);assert.match(messages.at(-1).text,/Bob/);await click('Speichern');
 const newest=(await db.query('SELECT id FROM match_ops ORDER BY id DESC LIMIT 1')).rows[0];const m=await getMatch(newest.id);assert.equal(m.status,'planned');assert.equal(m.roster.filter(r=>r.guest_name).length,1);assert.equal(m.roster.find(r=>r.guest_name).guest_name,'Gast nur jetzt');
});
