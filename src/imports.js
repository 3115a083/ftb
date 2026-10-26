import { cleanName, requireThat } from './rules.js';
import { assignPath } from './catalog.js';
export function parseImport(text,kind){
 requireThat(['people','teams'].includes(kind),'Ungültiger Import.');requireThat(typeof text==='string'&&text.length<=12000,'Höchstens 12000 Zeichen pro Import.');
 const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);requireThat(lines.length>0&&lines.length<=200,'1 bis 200 Zeilen pro Import.');
 const rows=lines.map(line=>{if(kind==='people')return {name:cleanName(line,100),players:[]};const at=line.indexOf(':');return {name:cleanName(at<0?line:line.slice(0,at),100),players:at<0?[]:line.slice(at+1).split(',').map(x=>x.trim()).filter(Boolean).map(x=>cleanName(x,100))};});
 requireThat(rows.reduce((n,r)=>n+r.players.length,0)<=500,'Höchstens 500 Spielernamen pro Import.');return rows;
}
export async function importEntries(c,kind,rows){let teams=0,people=0,skipped=0;
 for(const row of rows){let teamId=null;
  if(kind==='teams'){let team=(await c.query('SELECT id FROM teams WHERE lower(name)=lower($1) AND NOT is_demo',[row.name])).rows[0];if(!team){team=(await c.query('INSERT INTO teams(name) VALUES($1) RETURNING id',[row.name])).rows[0];await assignPath(c,'team',team.id);teams++;}else skipped++;teamId=team.id;}
  for(const name of kind==='people'?[row.name]:row.players){const old=await c.query('SELECT id FROM people WHERE lower(name)=lower($1) AND team_id IS NOT DISTINCT FROM $2::int',[name,teamId]);if(old.rowCount){skipped++;continue;}const person=(await c.query('INSERT INTO people(name,team_id) VALUES($1,$2) RETURNING id',[name,teamId])).rows[0];await assignPath(c,'person',person.id);people++;}
 }
 return {teams,people,skipped,audit:{teams,people,skipped}};
}
