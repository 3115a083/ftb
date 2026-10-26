import { assignPath, ensureCatalog } from './catalog.js';
import { parseImport, importEntries } from './imports.js';
import { db } from './db.js';
import { transact } from './transactions.js';
import { BUSY, LEADS, METRICS, cleanName, metricList, requireThat } from './rules.js';
import { advanceKnockout, createGroupGames, createKnockout, qualificationPlan, assignGroups, setTieOrder } from './tournament.js';
const lead=a=>requireThat(LEADS.includes(a?.role),'Nur die Turnierleitung darf das.');
const one=async(c,sql,args=[])=> (await c.query(sql,args)).rows[0];
export async function syncGames(c=db) {
 if(c===db){const client=await db.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM event_control WHERE id=1 FOR UPDATE');await syncGames(client);await client.query('COMMIT');return;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}

 await ensureCatalog(c);
 const rows=(await c.query(`INSERT INTO match_ops(game_id,status,winning_side)
 SELECT id,CASE status WHEN 'finished' THEN 'finished' WHEN 'live' THEN 'paused' WHEN 'cancelled' THEN 'cancelled' ELSE 'planned' END,
 CASE WHEN winner_team_id=home_team_id THEN 'A' WHEN winner_team_id=away_team_id THEN 'B' ELSE NULL END
 FROM games WHERE NOT is_demo ON CONFLICT(game_id) DO NOTHING RETURNING *`)).rows;
 for(const m of rows) {
  const g=await one(c,'SELECT * FROM games WHERE id=$1',[m.game_id]);
  await c.query("INSERT INTO match_roster(match_id,side,team_id) VALUES($1,'A',$2),($1,'B',$3)",[m.id,g.home_team_id,g.away_team_id]);
 }
}
export async function actor(id,c=db){return one(c,"SELECT * FROM staff WHERE telegram_id=$1 AND role<>'revoked'",[String(id)]);}
export async function getMatch(id,c=db){
 const m=await one(c,`SELECT m.*,f.name field_name,f.closed field_closed,s.name session_name,g.round_label,g.group_name,g.phase,
 h.display_name helper_name FROM match_ops m LEFT JOIN fields f ON f.id=m.field_id LEFT JOIN turbo_sessions s ON s.id=m.session_id
 LEFT JOIN games g ON g.id=m.game_id LEFT JOIN staff h ON h.telegram_id=m.helper_id WHERE m.id=$1`,[id]);
 requireThat(m,'Spiel nicht gefunden.');
 m.roster=(await c.query(`SELECT r.*,coalesce(st.display_name,p.name,t.name,r.guest_name) name FROM match_roster r LEFT JOIN people p ON p.id=r.person_id LEFT JOIN teams t ON t.id=r.team_id LEFT JOIN staff st ON st.person_id=p.id AND st.role<>'revoked' AND st.telegram_known WHERE r.match_id=$1 ORDER BY side,r.id`,[id])).rows;
 return m;
}
export async function listMatches(){
 await syncGames();
 const matches=(await db.query(`SELECT m.*,f.name field_name,f.closed field_closed,s.name session_name,g.round_label,g.group_name,g.phase,h.display_name helper_name
  FROM match_ops m LEFT JOIN fields f ON f.id=m.field_id LEFT JOIN turbo_sessions s ON s.id=m.session_id
  LEFT JOIN games g ON g.id=m.game_id LEFT JOIN staff h ON h.telegram_id=m.helper_id
  ORDER BY CASE m.status WHEN 'pending' THEN 0 WHEN 'correction' THEN 1 WHEN 'live' THEN 2 WHEN 'paused' THEN 3 WHEN 'assigned' THEN 4 WHEN 'planned' THEN 5 ELSE 6 END,m.id DESC`)).rows;
 const roster=(await db.query(`SELECT r.*,coalesce(st.display_name,p.name,t.name,r.guest_name) name FROM match_roster r LEFT JOIN people p ON p.id=r.person_id LEFT JOIN teams t ON t.id=r.team_id LEFT JOIN staff st ON st.person_id=p.id AND st.role<>'revoked' AND st.telegram_known ORDER BY r.side,r.id`)).rows;
 const byMatch=new Map();for(const row of roster){if(!byMatch.has(row.match_id))byMatch.set(row.match_id,[]);byMatch.get(row.match_id).push(row);}
 return matches.map(m=>({...m,roster:byMatch.get(m.id)||[]}));
}

function controller(a,m){return LEADS.includes(a.role)||String(m.helper_id)===String(a.telegram_id);}
function canReport(a,m){return controller(a,m)||(m.session_id&&m.roster.some(x=>x.person_id&&x.person_id===a.person_id));}
async function checkHelper(c,helper,m){
 const h=await actor(helper,c);requireThat(h,'Helfer ist nicht freigegeben.');
 if(!m.session_id&&h.person_id){const p=await one(c,'SELECT team_id FROM people WHERE id=$1',[h.person_id]);requireThat(!m.roster.some(r=>r.team_id&&r.team_id===p?.team_id),'Helfer darf keine Begegnung des eigenen Teams betreuen.');}
 return h;
}
async function checkField(c,field,m){
 const f=await one(c,'SELECT * FROM fields WHERE id=$1',[field]);requireThat(f&&!f.closed,'Spielfeld ist geschlossen oder fehlt.');
 requireThat(!(await c.query('SELECT id FROM match_ops WHERE field_id=$1 AND id<>$2 AND status=ANY($3::text[])',[field,m.id,BUSY])).rowCount,'Spielfeld ist noch belegt.');
}
async function checkTeams(c,m){
 if(m.game_id){const g=await one(c,'SELECT * FROM games WHERE id=$1',[m.game_id]);
 requireThat(!(await c.query('SELECT id FROM teams WHERE id=ANY($1::int[]) AND disqualified',[[g.home_team_id,g.away_team_id]])).rowCount,'Disqualifiziertes Team.');
 requireThat(!(await c.query(`SELECT o.id FROM match_ops o JOIN games g ON g.id=o.game_id WHERE o.id<>$1 AND o.status=ANY($2::text[]) AND (g.home_team_id=ANY($3::int[]) OR g.away_team_id=ANY($3::int[]))`,[m.id,BUSY,[g.home_team_id,g.away_team_id]])).rowCount,'Ein Team ist bereits in einer anderen Begegnung gebunden.');}
 const ids=m.roster.filter(x=>x.person_id).map(x=>x.person_id);
 if(ids.length)requireThat(!(await c.query('SELECT o.id FROM match_ops o JOIN match_roster r ON r.match_id=o.id WHERE o.id<>$1 AND o.status=ANY($2::text[]) AND r.person_id=ANY($3::int[])',[m.id,BUSY,ids])).rowCount,'Eine Person spielt bereits in einer anderen Begegnung.');
}
export async function setup(actorId,action,data,key){return transact(actorId,action,key,async(c,a)=>{lead(a);
 if(action==='bulk_import')return importEntries(c,data.kind,parseImport(data.text,data.kind));
 if(action==='field_rename'){await c.query('UPDATE fields SET name=$1,version=version+1 WHERE id=$2',[cleanName(data.name,80),data.id]);return {audit:data};}
 if(action==='field_add'){const row=await one(c,'INSERT INTO fields(name) VALUES($1) RETURNING id',[cleanName(data.name,80)]);return row;}
 if(action==='person_add'){if(data.teamId)requireThat((await c.query('SELECT id FROM teams WHERE id=$1 AND NOT is_demo',[data.teamId])).rowCount,'Team fehlt.');const row=await one(c,'INSERT INTO people(name,team_id) VALUES($1,$2) RETURNING id',[cleanName(data.name),data.teamId||null]);await assignPath(c,'person',row.id);return row;}
 if(action==='person_link'){requireThat((await c.query('SELECT id FROM people WHERE id=$1 AND active',[data.personId])).rowCount,'Person fehlt.');requireThat((await c.query('SELECT telegram_id FROM staff WHERE telegram_id=$1',[String(data.userId)])).rowCount,'Helfer fehlt.');await c.query('UPDATE staff SET person_id=$1 WHERE telegram_id=$2',[data.personId,String(data.userId)]);return {audit:{userId:String(data.userId),personId:data.personId}};}
 if(action==='person_team'){await c.query('UPDATE people SET team_id=$1 WHERE id=$2',[data.teamId||null,data.personId]);await assignPath(c,'person',data.personId,{refresh:true});return {audit:data};}
 if(action==='classic_guests'){
  const m=await getMatch(data.id,c);requireThat(m.game_id&&['planned','assigned'].includes(m.status),'Gäste nur vor Spielbeginn bei Teambegegnungen ändern.');
  requireThat(data.version==null||m.version===data.version,'Spiel inzwischen geändert.');
  const aNames=(data.guestA||[]).map(x=>cleanName(x,100)),bNames=(data.guestB||[]).map(x=>cleanName(x,100));requireThat(aNames.length+bNames.length<=30,'Höchstens 30 Gäste pro Spiel.');
  requireThat(new Set([...aNames,...bNames].map(n=>n.toLowerCase())).size===aNames.length+bNames.length,'Gästenamen müssen in diesem Spiel eindeutig sein.');
  await c.query('DELETE FROM match_roster WHERE match_id=$1 AND guest_name IS NOT NULL',[m.id]);for(const [side,names] of [['A',aNames],['B',bNames]])for(const name of names)await c.query('INSERT INTO match_roster(match_id,side,guest_name) VALUES($1,$2,$3)',[m.id,side,name]);await c.query('UPDATE match_ops SET version=version+1 WHERE id=$1',[m.id]);return {audit:{match:m.id,guestA:aNames,guestB:bNames}};
 }
 if(action==='session_add'){const row=await one(c,'INSERT INTO turbo_sessions(name,min_games) VALUES($1,$2) RETURNING id',[cleanName(data.name),data.minGames||3]);return row;}
 if(action==='session_config'){
  const s=await one(c,'SELECT * FROM turbo_sessions WHERE id=$1',[data.id]);requireThat(s&&!s.finished,'Turbo-Sitzung fehlt oder ist beendet.');
  requireThat(!(await c.query("SELECT id FROM match_ops WHERE session_id=$1 AND status<>'planned'",[s.id])).rowCount,'Wertung kann nach Spielbeginn nicht geändert werden.');
  const metrics=metricList(data.metrics),ties=metricList(data.tiebreakers);requireThat(ties.every(x=>metrics.includes(x)),'Tiebreaker muss aktiviert sein.');
  await c.query('UPDATE turbo_sessions SET min_games=$1,metrics=$2,tiebreakers=$3 WHERE id=$4',[data.minGames,JSON.stringify(metrics),JSON.stringify(ties),s.id]);return {audit:data};}
 if(action==='classic_metrics'){const metrics=metricList(data.metrics),ties=metricList(data.tiebreakers);requireThat(ties.every(x=>metrics.includes(x)),'Tiebreaker muss aktiviert sein.');requireThat(!(await c.query("SELECT id FROM match_ops WHERE game_id IS NOT NULL AND status NOT IN ('planned','cancelled')")).rowCount,'Wertung nach Spielbeginn gesperrt.');await c.query('UPDATE event_control SET metrics=$1,tiebreakers=$2 WHERE id=1',[JSON.stringify(metrics),JSON.stringify(ties)]);return {audit:data};}
 if(action==='session_finish'){requireThat(!(await c.query('SELECT id FROM match_ops WHERE session_id=$1 AND status=ANY($2::text[])',[data.id,BUSY])).rowCount,'Es sind noch Spiele offen.');await c.query('UPDATE turbo_sessions SET finished=true WHERE id=$1',[data.id]);return {audit:data};}
 if(action==='team_add'){const row=await one(c,'INSERT INTO teams(name) VALUES($1) RETURNING id',[cleanName(data.name)]);await assignPath(c,'team',row.id);return row;}
 if(action==='team_edit'){
  const team=await one(c,'SELECT * FROM teams WHERE id=$1 AND NOT is_demo',[data.id]);requireThat(team,'Team fehlt.');
  const allowed=['name','group_name','logo','disqualified'];requireThat(allowed.includes(data.field),'Ungültiges Feld.');
  if(data.field==='group_name')requireThat(!(await c.query("SELECT id FROM games WHERE NOT is_demo AND status<>'cancelled'",[])).rowCount,'Zuerst den ungespielten Gruppenplan verwerfen. Bereits gespielte Gruppen bleiben erhalten.');
  if(data.field==='disqualified'&&data.value){
   requireThat(!(await c.query("SELECT id FROM games WHERE phase='knockout' AND NOT is_demo AND status<>'cancelled' AND (home_team_id=$1 OR away_team_id=$1)",[team.id])).rowCount,'K.-o.-Spiele betroffen. Zuerst im Reparaturdialog behandeln.');
   const affected=(await c.query("SELECT o.* FROM match_ops o JOIN games g ON g.id=o.game_id WHERE (g.home_team_id=$1 OR g.away_team_id=$1) AND o.status NOT IN ('finished','cancelled')",[team.id])).rows;
   for(const m of affected){await c.query("UPDATE match_ops SET status='cancelled',reason='Team disqualifiziert',version=version+1 WHERE id=$1",[m.id]);await c.query("UPDATE games SET status='cancelled',winner_team_id=NULL,version=version+1 WHERE id=$1",[m.game_id]);}
   await c.query('INSERT INTO audit_log(telegram_user_id,action,details) VALUES($1,$2,$3)',[String(actorId),'dq_affected_games',{team:team.id,matches:affected}]);
  }
  if(data.field==='name')data.value=cleanName(data.value);
  if(data.field==='group_name')data.value=data.value?cleanName(data.value,40):null;
  if(data.field==='disqualified')requireThat(typeof data.value==='boolean','Ungültige Disqualifikation.');
  if(data.field==='logo')requireThat(data.value===null||/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(data.value),'Ungültiges Bild.');
  await c.query(`UPDATE teams SET ${data.field}=$1,version=version+1 WHERE id=$2`,[data.value,team.id]);if(data.field==='name'){await assignPath(c,'team',team.id,{refresh:true});for(const p of (await c.query('SELECT id FROM people WHERE team_id=$1',[team.id])).rows)await assignPath(c,'person',p.id,{refresh:true});}return {audit:{team:team.id,field:data.field}};
 }
 if(action==='groups_auto'){
  requireThat(!(await c.query("SELECT id FROM games WHERE NOT is_demo AND status<>'cancelled'")).rowCount,'Gruppen nur vor Erzeugung der Spiele neu einteilen.');
  requireThat(Number.isInteger(data.count)&&data.count>=1&&data.count<=26,'1 bis 26 Gruppen.');await assignGroups(data.count,false,c);return {audit:data};}
 if(action==='groups_reset'){
  requireThat(!(await c.query("SELECT o.id FROM match_ops o JOIN games g ON g.id=o.game_id WHERE NOT g.is_demo AND o.status NOT IN ('planned','assigned','cancelled')")).rowCount,'Spielplan wurde bereits begonnen. Reparaturdialog erforderlich.');
  await c.query("UPDATE match_ops SET status='cancelled',reason='Ungespielter Gruppenplan verworfen',version=version+1 WHERE game_id IN (SELECT id FROM games WHERE NOT is_demo AND phase='group')");
  await c.query("UPDATE games SET status='cancelled',version=version+1 WHERE NOT is_demo AND phase='group'");return {};
 }
 if(action==='group_games'){await createGroupGames({client:c});await syncGames(c);return {};}
 if(action==='knockout'){requireThat((await one(c,'SELECT mode FROM event_control WHERE id=1')).mode==='classic','Im Turbo-Modus gibt es keine K.-o.-Phase und kein Finalspiel.');
  requireThat(!(await c.query("SELECT id FROM games WHERE phase='knockout' AND NOT is_demo AND status<>'cancelled'")).rowCount,'K.-o.-Phase existiert bereits. Keine Neuerzeugung über diesen Weg.');
  requireThat(!(await c.query("SELECT id FROM games WHERE phase='group' AND NOT is_demo AND status NOT IN ('finished','cancelled')")).rowCount,'Zuerst alle Gruppenergebnisse freigeben.');
  await createKnockout(data.mode||'single',c);await syncGames(c);return {};}
 if(action==='tie_order'){await setTieOrder(data.group,data.ids,c);return {audit:data};}
 throw Error('Unbekannte Aktion.');
});}
export async function createTurbo(actorId,{sessionId,sideA,sideB,coordinatorId,playedOn},key){return transact(actorId,'turbo_created',key,async(c,a)=>{lead(a);
 const session=await one(c,'SELECT * FROM turbo_sessions WHERE id=$1 AND NOT finished',[sessionId]);requireThat(session,'Aktive Turbo-Sitzung fehlt.');
 requireThat(Array.isArray(sideA)&&Array.isArray(sideB)&&sideA.length&&sideB.length&&sideA.length+sideB.length<=40,'Beide Seiten brauchen Teilnehmer, insgesamt höchstens 40.');
 const personIds=[...sideA,...sideB].filter(x=>x.personId).map(x=>x.personId);requireThat(new Set(personIds).size===personIds.length,'Person doppelt ausgewählt.');
 for(const id of personIds)requireThat((await c.query('SELECT id FROM people WHERE id=$1 AND active',[id])).rowCount,'Teilnehmer fehlt.');
 if(coordinatorId){const u=await actor(coordinatorId,c);requireThat(u&&personIds.includes(u.person_id),'Rundenzähler muss beteiligt sein.');}
 const tz=(await one(c,'SELECT timezone FROM event_control WHERE id=1')).timezone;
 const day=playedOn||new Intl.DateTimeFormat('sv-SE',{timeZone:tz}).format(new Date());
 requireThat(/^\d{4}-\d{2}-\d{2}$/.test(day)&&!isNaN(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day,'Ungültiger Spieltag.');
 const m=await one(c,'INSERT INTO match_ops(session_id,coordinator_id,played_on) VALUES($1,$2,$3) RETURNING id',[sessionId,coordinatorId||null,day]);
 for(const [side,roster] of [['A',sideA],['B',sideB]])for(const p of roster)await c.query('INSERT INTO match_roster(match_id,side,person_id,guest_name) VALUES($1,$2,$3,$4)',[m.id,side,p.personId||null,p.personId?null:cleanName(p.guestName)]);
 return {id:m.id,audit:{sessionId,matchId:m.id}};
});}
export async function matchAction(actorId,id,action,data={},key){return transact(actorId,'match_'+action,key,async(c,a)=>{
 const m=await getMatch(id,c);
 if(['assign','start'].includes(action)){const mode=(await one(c,'SELECT mode FROM event_control WHERE id=1')).mode;requireThat(mode===(m.session_id?'turbo':'classic'),'Spiel gehört zum anderen Instanzmodus.');}
 if(m.session_id&&action!=='cancel')requireThat(!(await one(c,'SELECT finished FROM turbo_sessions WHERE id=$1',[m.session_id])).finished,'Turbo-Sitzung ist beendet.');
 if(data.version!==undefined)requireThat(m.version===Number(data.version),'Veralteter Button. Bitte den aktuellen Spielstand öffnen.');
 const privileged=LEADS.includes(a.role);
 if(action==='assign'){
  lead(a);requireThat(['planned','assigned'].includes(m.status),'Nur vor Spielbeginn zuweisen.');await checkField(c,data.fieldId,m);await checkHelper(c,data.helperId,m);await checkTeams(c,m);
  await c.query("UPDATE match_ops SET field_id=$1,helper_id=$2,status='assigned',version=version+1 WHERE id=$3",[data.fieldId,String(data.helperId),m.id]);
 }else if(action==='start'){
  requireThat(controller(a,m),'Nicht für dieses Spiel zuständig.');requireThat(m.status==='assigned','Spiel ist nicht startbereit.');await checkHelper(c,m.helper_id,m);await checkField(c,m.field_id,m);await checkTeams(c,m);
  await c.query("UPDATE match_ops SET status='live',started_at=now(),version=version+1 WHERE id=$1",[m.id]);
 }else if(action==='pause'){
  requireThat(controller(a,m),'Nicht für dieses Spiel zuständig.');requireThat(m.status==='live','Spiel läuft nicht.');
  await c.query("UPDATE match_ops SET status='paused',reason=$1,version=version+1 WHERE id=$2",[cleanName(data.reason||'Grund wird ergänzt.',500),m.id]);
 }else if(action==='resume'){
  requireThat(controller(a,m),'Nicht für dieses Spiel zuständig.');requireThat(m.status==='paused','Spiel ist nicht pausiert.');await checkField(c,m.field_id,m);requireThat(!m.resume_locked||privileged,'Fortsetzung durch Leitung gesperrt.');
  await c.query("UPDATE match_ops SET status='live',resume_locked=false,version=version+1 WHERE id=$1",[m.id]);
 }else if(action==='report'){
  requireThat(canReport(a,m),'Keine Meldeberechtigung.');if(!privileged&&m.game_id)await checkHelper(c,actorId,m);requireThat(['live','paused','correction'].includes(m.status),'Meldung momentan nicht möglich.');requireThat(['A','B'].includes(data.side),'Gewinner fehlt.');
  await c.query("UPDATE match_ops SET status='pending',winning_side=$1,reporter_id=$2,ended_at=coalesce(ended_at,now()),version=version+1 WHERE id=$3",[data.side,String(actorId),m.id]);
 }else if(action==='return'){
  lead(a);requireThat(m.status==='pending','Meldung bereits bearbeitet.');await c.query("UPDATE match_ops SET status='correction',reason=$1,version=version+1 WHERE id=$2",[cleanName(data.reason,500),m.id]);
 }else if(action==='approve'){
  lead(a);requireThat(m.status==='pending','Meldung bereits bearbeitet.');
  const side=data.side||m.winning_side;requireThat(['A','B'].includes(side),'Gewinner fehlt.');if(side!==m.winning_side)cleanName(data.reason,500);
  await c.query("UPDATE match_ops SET status='finished',winning_side=$1,approved_by=$2,reason=$3,version=version+1 WHERE id=$4",[side,String(actorId),data.reason||'',m.id]);
  if(m.game_id){const winner=m.roster.find(r=>r.side===side&&r.team_id).team_id;await c.query("UPDATE games SET status='finished',winner_team_id=$1,version=version+1 WHERE id=$2",[winner,m.game_id]);await advanceKnockout(m.game_id,c);await syncGames(c);}
 }else if(action==='move'){
  lead(a);requireThat(BUSY.includes(m.status),'Spiel kann nicht verlegt werden.');await checkField(c,data.fieldId,m);await c.query('UPDATE match_ops SET field_id=$1,version=version+1 WHERE id=$2',[data.fieldId,m.id]);
 }else if(action==='helper'){
  lead(a);requireThat(BUSY.includes(m.status),'Spiel nicht aktiv.');await checkHelper(c,data.helperId,m);await c.query('UPDATE match_ops SET helper_id=$1,version=version+1 WHERE id=$2',[String(data.helperId),m.id]);
 }else if(action==='coordinator'){
  lead(a);requireThat(m.session_id,'Nur Turbo.');const u=await actor(data.userId,c);requireThat(u&&m.roster.some(x=>x.person_id&&x.person_id===u.person_id),'Person muss beteiligt sein.');await c.query('UPDATE match_ops SET coordinator_id=$1,version=version+1 WHERE id=$2',[String(data.userId),m.id]);
 }else if(action==='lock_resume'){
  lead(a);requireThat(m.status==='paused','Spiel ist nicht pausiert.');await c.query('UPDATE match_ops SET resume_locked=true,version=version+1 WHERE id=$1',[m.id]);
 }else if(action==='cancel'){
  lead(a);requireThat(m.status!=='finished','Abgeschlossenes Spiel benötigt eine Korrektur.');cleanName(data.reason,500);
  await c.query("UPDATE match_ops SET status='cancelled',reason=$1,version=version+1 WHERE id=$2",[data.reason,m.id]);if(m.game_id)await c.query("UPDATE games SET status='cancelled',winner_team_id=NULL,version=version+1 WHERE id=$1",[m.game_id]);
 }else if(action==='problem'){
  requireThat(canReport(a,m),'Keine Berechtigung.');requireThat(BUSY.includes(m.status),'Spiel nicht aktiv.');await c.query('UPDATE match_ops SET reason=$1 WHERE id=$2',[cleanName(data.reason,500),m.id]);
 }else throw Error('Unbekannte Aktion.');
 if(m.game_id&&['start','pause','resume'].includes(action))await c.query('UPDATE games SET status=$1,version=version+1 WHERE id=$2',[action==='pause'?'paused':'live',m.game_id]);
 return {id:m.id,notify:true,audit:{matchId:m.id,action,...data}};
});}
export async function closeField(actorId,id,mode,key){return transact(actorId,'field_state',key,async(c,a)=>{lead(a);
 requireThat(['finish','pause','open'].includes(mode),'Ungültige Feldaktion.');requireThat(await one(c,'SELECT id FROM fields WHERE id=$1',[id]),'Feld fehlt.');
 await c.query('UPDATE fields SET closed=$1,version=version+1 WHERE id=$2',[mode!=='open',id]);
 if(mode==='pause'){
  const rows=(await c.query("UPDATE match_ops SET status='paused',resume_locked=true,reason='Spielfeld geschlossen',version=version+1 WHERE field_id=$1 AND status='live' RETURNING game_id",[id])).rows;
  for(const r of rows)if(r.game_id)await c.query("UPDATE games SET status='paused',version=version+1 WHERE id=$1",[r.game_id]);
 }
 return {audit:{fieldId:id,mode}};
});}
export async function metricAction(actorId,id,subjectId,metric,kind,key){return transact(actorId,'metric_'+kind,key,async(c,a)=>{
 const m=await getMatch(id,c),privileged=LEADS.includes(a.role);
 if(!privileged&&m.game_id)await checkHelper(c,actorId,m);
 requireThat(['live','correction'].includes(m.status),'Statistiken können jetzt nicht verändert werden.');
 if(kind==='undo'){
  const event=await one(c,'SELECT * FROM metric_events WHERE match_id=$1 AND actor_id=$2 AND undone_by IS NULL ORDER BY id DESC LIMIT 1',[m.id,String(actorId)]);requireThat(event,'Keine eigene Eingabe zum Zurücknehmen.');
  requireThat(controller(a,m)||(m.session_id&&m.roster.some(x=>x.person_id&&x.person_id===a.person_id)),'Keine Erfassungsberechtigung.');
  if(event.metric==='round')requireThat(!(await c.query('SELECT id FROM metric_events WHERE match_id=$1 AND id>$2 AND undone_by IS NULL',[m.id,event.id])).rowCount,'Die Runde hat bereits weitere Erfassungen. Zuerst diese korrigieren.');
  await c.query('UPDATE metric_events SET undone_by=$1 WHERE id=$2',[String(actorId),event.id]);if(event.metric==='round')await c.query('UPDATE match_ops SET current_round=greatest(1,current_round-1) WHERE id=$1',[m.id]);return {id:m.id,audit:{eventId:event.id}};
 }
 if(metric==='round'){
  requireThat(m.status==='live','Runden nur im laufenden Spiel zählen.');
  requireThat(privileged||String(m.coordinator_id)===String(actorId)||(String(m.helper_id)===String(actorId)&&!m.roster.some(x=>x.person_id&&x.person_id===a.person_id)),'Nur die festgelegte Betreuung zählt die Runden.');requireThat(m.current_round<10000,'Rundenlimit erreicht.');
  await c.query('UPDATE match_ops SET current_round=current_round+1 WHERE id=$1',[m.id]);
  await c.query("INSERT INTO metric_events(match_id,metric,amount,actor_id,round_no) VALUES($1,'round',1,$2,$3)",[m.id,String(actorId),m.current_round+1]);return {id:m.id};
 }
 const subject=m.roster.find(x=>x.id===Number(subjectId));requireThat(subject,'Teilnehmer fehlt.');
 requireThat(privileged||(String(m.helper_id)===String(actorId)&&(!m.session_id||!m.roster.some(x=>x.person_id&&x.person_id===a.person_id)))||(m.session_id&&subject.person_id&&subject.person_id===a.person_id)||(m.session_id&&subject.guest_name&&String(m.coordinator_id)===String(actorId)),'Nur eigene Werte oder zugewiesene Spiele erfassen.');
 const config=await one(c,m.session_id?'SELECT metrics FROM turbo_sessions WHERE id=$1':'SELECT metrics FROM event_control WHERE id=$1',[m.session_id||1]);requireThat(config.metrics.includes(metric),'Metrik nicht aktiviert.');
 requireThat(Object.hasOwn(METRICS,metric),'Unbekannte Metrik.');
 if(metric==='empty_round')requireThat(!(await c.query("SELECT id FROM metric_events WHERE match_id=$1 AND subject_id=$2 AND metric='empty_round' AND undone_by IS NULL",[m.id,subject.id])).rowCount,'Leer bereits gemeldet. Zuerst eigene Eingabe zurücknehmen.');
 const amount=kind==='zero'?0:metric==='empty_round'?m.current_round:1;
 await c.query('INSERT INTO metric_events(match_id,subject_id,metric,amount,actor_id,round_no) VALUES($1,$2,$3,$4,$5,$6)',[m.id,subject.id,metric,amount,String(actorId),m.current_round]);
 return {id:m.id,audit:{subjectId:subject.id,metric,amount}};
});}
export async function metricValues(id,c=db){return (await c.query(`SELECT subject_id,metric,sum(amount)::float AS total,count(*)::int AS entries FROM metric_events WHERE match_id=$1 AND undone_by IS NULL AND metric<>'round' GROUP BY subject_id,metric`,[id])).rows;}
export async function suggestions(fieldId){
 const matches=await listMatches(),busy=matches.filter(m=>BUSY.includes(m.status));
 const field=await one(db,'SELECT * FROM fields WHERE id=$1',[fieldId]);if(!field||field.closed||busy.some(x=>x.field_id===field.id))return [];
 const candidates=matches.filter(m=>m.status==='planned'&&!busy.some(b=>b.roster.some(br=>m.roster.some(r=>(r.person_id&&r.person_id===br.person_id)||(r.team_id&&r.team_id===br.team_id)))));
 const helpers=(await db.query("SELECT s.*,p.team_id FROM staff s LEFT JOIN people p ON p.id=s.person_id WHERE s.role<>'revoked' ORDER BY display_name")).rows;
 return candidates.map(m=>({...m,helpers:helpers.filter(h=>!(m.game_id&&m.roster.some(r=>r.team_id&&r.team_id===h.team_id))),lastPlayed:m.roster.map(r=>({name:r.name,at:matches.filter(x=>x.status==='finished'&&x.roster.some(y=>(r.person_id&&r.person_id===y.person_id)||(r.team_id&&r.team_id===y.team_id))).map(x=>x.ended_at).filter(Boolean).sort((a,b)=>+new Date(b)-+new Date(a))[0]||null}))}));
}

export async function repairPreview(id,c=db){
 const m=await getMatch(id,c);requireThat(m.status==='finished','Nur freigegebene Ergebnisse reparieren.');
 let affected=[];
 if(m.game_id){const g=await one(c,'SELECT * FROM games WHERE id=$1',[m.game_id]);
  affected=(await c.query(`SELECT o.id,o.version,o.status,o.winning_side,g.id game_id,g.winner_team_id,g.round_label,h.name home_name,a.name away_name,w.name winner_name
   FROM match_ops o JOIN games g ON g.id=o.game_id JOIN teams h ON h.id=g.home_team_id JOIN teams a ON a.id=g.away_team_id LEFT JOIN teams w ON w.id=g.winner_team_id WHERE o.id<>$1 AND NOT g.is_demo AND g.phase='knockout'
   AND g.status<>'cancelled' AND ($2='group' OR g.round_no>$3 OR ($4::text IS NOT NULL AND g.series_key=$4 AND g.series_game>$5)) ORDER BY o.id`,[m.id,g.phase,g.round_no||0,g.series_key,g.series_game||0])).rows;
 }
 const { createHash }=await import('node:crypto');
 const token=createHash('sha256').update(JSON.stringify([m.id,m.version,affected])).digest('hex');
 return {match:m,affected,token};
}
export async function repairResult(actorId,id,{side,reason,token},key){return transact(actorId,'result_repaired',key,async(c,a)=>{lead(a);
 cleanName(reason,500);requireThat(['A','B'].includes(side),'Gewinner fehlt.');const preview=await repairPreview(id,c);requireThat(token===preview.token,'Auswirkungen haben sich geändert. Reparaturvorschau neu öffnen.');
 const m=preview.match;
 for(const x of preview.affected){await c.query("UPDATE match_ops SET status='cancelled',reason=$1,version=version+1 WHERE id=$2",['Annulliert nach Reparatur: '+reason,x.id]);await c.query("UPDATE games SET status='cancelled',winner_team_id=NULL,version=version+1 WHERE id=$1",[x.game_id]);}
 await c.query('UPDATE match_ops SET winning_side=$1,reason=$2,approved_by=$3,version=version+1 WHERE id=$4',[side,reason,String(actorId),id]);
 if(m.game_id){await c.query('UPDATE games SET winner_team_id=$1,version=version+1 WHERE id=$2',[m.roster.find(x=>x.side===side).team_id,m.game_id]);await c.query('UPDATE settings SET tournament_finished=false,winner_team_id=NULL,version=version+1 WHERE id=1');await advanceKnockout(m.game_id,c);await syncGames(c);}
 return {id:m.id,audit:{matchId:m.id,oldWinner:m.winning_side,newWinner:side,reason,annulled:preview.affected}};
});}
