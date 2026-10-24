import { db } from './db.js';
import { METRICS, rankPeople, csvCell, requireThat } from './rules.js';
export async function turboStats(sessionId,c=db){
 const session=(await c.query('SELECT * FROM turbo_sessions WHERE id=$1',[sessionId])).rows[0];requireThat(session,'Turbo-Sitzung nicht gefunden.');
 const entries=(await c.query(`SELECT r.id,r.person_id,r.guest_name,r.side,m.id match_id,m.winning_side,p.name
 FROM match_roster r JOIN match_ops m ON m.id=r.match_id LEFT JOIN people p ON p.id=r.person_id
 WHERE m.session_id=$1 AND m.status='finished' ORDER BY m.id,r.id`,[sessionId])).rows;
 const events=(await c.query(`SELECT e.subject_id,e.metric,sum(e.amount)::float AS value FROM metric_events e JOIN match_ops m ON m.id=e.match_id
 WHERE m.session_id=$1 AND m.status='finished' AND e.undone_by IS NULL AND e.metric<>'round' GROUP BY e.subject_id,e.metric`,[sessionId])).rows;
 const persons=new Map(),guest={name:'Gäste gemeinsam',played:0,wins:0,losses:0,metrics:{},measured:{},is_guest:true};
 for(const e of entries){
  const row=e.person_id?(persons.get(e.person_id)||{id:e.person_id,name:e.name,played:0,wins:0,losses:0,metrics:{},measured:{}}):guest;
  row.played++;if(e.side===e.winning_side)row.wins++;else row.losses++;
  for(const key of session.metrics){const value=events.find(v=>v.subject_id===e.id&&v.metric===key)?.value;
   if(value!==undefined){row.metrics[key]=(row.metrics[key]||0)+value;row.measured[key]=(row.measured[key]||0)+1;}}
  if(e.person_id)persons.set(e.person_id,row);
 }
 for(const row of [...persons.values(),guest])for(const key of session.metrics){
  if(!row.measured[key])row.metrics[key]=null;
  else if(key==='empty_round')row.metrics[key]/=row.measured[key];
 }
 return {session,rows:rankPeople([...persons.values()],session.min_games,session.tiebreakers),guests:guest};
}
export function statisticsCsv(stats){
 const keys=stats.session.metrics;
 const header=['Platz','Person','Spiele / Gast-Einsätze','Siege','Niederlagen','Siegquote','Wertung',...keys.flatMap(k=>[METRICS[k].label,k==='empty_round'?'Erfasste Abschlüsse':'Erfasste Spiele'])];
 const rows=[...stats.rows,stats.guests].map(r=>[r.place??'',r.name,r.played,r.wins,r.losses,r.is_guest?'':r.win_rate==null?'':(r.win_rate*100).toFixed(2)+'%',r.is_guest?'Gäste, keine Ranglistenwertung':r.qualified?'Gewertet':`Noch nicht gewertet (${r.played}/${stats.session.min_games})`,...keys.flatMap(k=>[r.metrics[k]??'',r.measured[k]||0])]);
 return '\ufeff'+[header,...rows].map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';
}
