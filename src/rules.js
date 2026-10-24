export const METRICS = Object.freeze({
 received: { label: 'Strafbiere erhalten', direction: 1 },
 distributed: { label: 'Strafbiere verteilt', direction: -1 },
 hits: { label: 'Treffer', direction: -1 },
 empty_round: { label: 'Runden bis leer', direction: 1 },
});
export const LEADS = ['admin', 'lead'];
export const BUSY = ['assigned', 'live', 'paused', 'pending', 'correction'];
export const LABELS = { planned:'Offen', assigned:'Zugewiesen', live:'Läuft', paused:'Pausiert', pending:'Wartet auf Freigabe', correction:'Korrektur erforderlich', finished:'Abgeschlossen', cancelled:'Abgesagt' };
export function requireThat(value, message) { if (!value) throw new Error(message); }
export function cleanName(value, max=100) {
 const s=String(value??'').trim(); requireThat(s.length>0 && s.length<=max && !/[\x00-\x1f]/.test(s),'Bitte einen gültigen Namen eingeben.'); return s;
}
export function metricList(value) {
 requireThat(Array.isArray(value) && value.length<=4 && new Set(value).size===value.length && value.every(x=>Object.hasOwn(METRICS,x)), 'Ungültige Metriken.'); return value;
}
export function compareStats(a,b,tiebreakers=[]) {
 // Integer cross multiplication avoids rounding 2/3 and 4/6 into different ranks.
 const rate=b.wins*a.played-a.wins*b.played;
 if(rate) return rate;
 for(const key of tiebreakers) {
  const av=a.metrics[key], bv=b.metrics[key];
  // Missing values never get an advantage over measured values or count as zero.
  if(av==null || bv==null) continue;
  const delta=(av-bv)*METRICS[key].direction; if(delta) return delta;
 }
 return 0;
}
export function rankPeople(rows,minGames,tiebreakers) {
 const usableFor=row=>tiebreakers.filter(k=>rows.filter(x=>(x.played>=minGames)===(row.played>=minGames)&&x.wins*row.played===row.wins*x.played).every(x=>Number.isFinite(x.metrics[k])));
 const compare=(a,b)=>compareStats(a,b,usableFor(a));
 const sorted=[...rows].sort((a,b)=>Number(b.played>=minGames)-Number(a.played>=minGames)||compare(a,b)||a.name.localeCompare(b.name,'de'));
 let place=0,previous=null;
 return sorted.map((row,index)=>{const qualified=row.played>=minGames;
  if(qualified&&(!previous||compare(previous,row)!==0))place=index+1;
  if(qualified)previous=row;
  return {...row,qualified,place:qualified?place:null,win_rate:row.played?row.wins/row.played:null};
 });
}
export function csvCell(value) {
 let s=value==null?'':String(value);
 if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;
 return '"'+s.replaceAll('"','""')+'"';
}
