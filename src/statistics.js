import { db } from './db.js';
import { METRICS, rankPeople, csvCell, requireThat } from './rules.js';
export function periodFilter(input={},timezone='Europe/Berlin'){
 const current=Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:timezone}).format(new Date()));
 const year=String(input.year||current);requireThat(year==='all'||/^\d{4}$/.test(year)&&Number(year)>=2000&&Number(year)<=2200,'Ungültiges Jahr.');
 const day=String(input.day||'');if(day){requireThat(/^\d{4}-\d{2}-\d{2}$/.test(day)&&!isNaN(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day,'Ungültiger Spieltag.');requireThat(year==='all'||day.startsWith(year+'-'),'Spieltag passt nicht zum Jahr.');}
 return {year,day,label:day?'Spieltag '+day:year==='all'?'Gesamter Zeitraum':'Jahr '+year};
}
export async function turboStats(sessionId,c=db,filter={}){
 const annual=sessionId==null,control=(await c.query('SELECT * FROM event_control WHERE id=1')).rows[0];
 const session=annual?{id:null,name:'Turbo-Jahresrangliste',min_games:control.turbo_min_games,metrics:Object.keys(METRICS),tiebreakers:['received','distributed','hits','empty_round']}:(await c.query('SELECT * FROM turbo_sessions WHERE id=$1',[sessionId])).rows[0];requireThat(session,'Turbo-Sitzung nicht gefunden.');
 const period=periodFilter(filter,control.timezone),args=[],where=["m.session_id IS NOT NULL","m.status='finished'"];
 if(!annual){args.push(sessionId);where.push(`m.session_id=$${args.length}`);}if(period.year!=='all'){args.push(Number(period.year));where.push(`extract(year FROM m.played_on)=$${args.length}`);}if(period.day){args.push(period.day);where.push(`m.played_on=$${args.length}::date`);}
 const entries=(await c.query(`SELECT r.id,r.person_id,r.guest_name,r.side,m.id match_id,m.winning_side,p.name FROM match_roster r JOIN match_ops m ON m.id=r.match_id LEFT JOIN people p ON p.id=r.person_id WHERE ${where.join(' AND ')} ORDER BY m.id,r.id`,args)).rows;
 const events=(await c.query(`SELECT e.subject_id,e.metric,sum(e.amount)::float AS value FROM metric_events e JOIN match_ops m ON m.id=e.match_id WHERE ${where.join(' AND ')} AND e.undone_by IS NULL AND e.metric<>'round' GROUP BY e.subject_id,e.metric`,args)).rows;
 const values=new Map(events.map(e=>[`${e.subject_id}:${e.metric}`,e.value]));
 const persons=new Map(),guest={name:'Gäste gemeinsam',played:0,wins:0,losses:0,metrics:{},measured:{},is_guest:true};
 for(const e of entries){
  const row=e.person_id?(persons.get(e.person_id)||{id:e.person_id,name:e.name,played:0,wins:0,losses:0,metrics:{},measured:{}}):guest;
  row.played++;if(e.side===e.winning_side)row.wins++;else row.losses++;
  for(const key of session.metrics){const value=values.get(`${e.id}:${key}`);if(value!==undefined){row.metrics[key]=(row.metrics[key]||0)+value;row.measured[key]=(row.measured[key]||0)+1;}}
  if(e.person_id)persons.set(e.person_id,row);
 }
 for(const row of [...persons.values(),guest])for(const key of session.metrics){if(!row.measured[key])row.metrics[key]=null;else if(key==='empty_round')row.metrics[key]/=row.measured[key];}
 return {session:{...session,name:session.name+' · '+period.label},period,rows:rankPeople([...persons.values()],session.min_games,session.tiebreakers),guests:guest};
}
export function statisticsCsv(stats){
 const keys=stats.session.metrics;
 const header=['Platz','Person','Spiele / Gast-Einsätze','Siege','Niederlagen','Siegquote','Wertung','Zeitraum',...keys.flatMap(k=>[METRICS[k].label,k==='empty_round'?'Erfasste Abschlüsse':'Erfasste Spiele'])];
 const rows=[...stats.rows,stats.guests].map(r=>[r.place??'',r.name,r.played,r.wins,r.losses,r.is_guest?'':r.win_rate==null?'':(r.win_rate*100).toFixed(2)+'%',r.is_guest?'Gäste, keine Ranglistenwertung':r.qualified?'Gewertet':`Noch nicht gewertet (${r.played}/${stats.session.min_games})`,stats.period?.label||'Gesamt',...keys.flatMap(k=>[r.metrics[k]??'',r.measured[k]||0])]);
 return '\ufeff'+[header,...rows].map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';
}
