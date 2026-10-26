// Human-readable canonical paths and permanent aliases. Called under the event lock.
export const entityUrl=(kind,path)=>'/'+(kind==='person'?'personen':'teams')+'/'+String(path).split('/').map(encodeURIComponent).join('/');
const segment=name=>{let v=String(name).normalize('NFC').trim().replace(/[^\p{L}\p{N}_@.-]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,100)||'Name';if(/^\d+$/.test(v)||['.','..'].includes(v))v='Name-'+v;return v;};
export async function assignPath(c,kind,id,{refresh=false}={}){
 const table=kind==='person'?'people':'teams',aliases=kind==='person'?'person_urls':'team_urls',fk=kind==='person'?'person_id':'team_id';
 const row=(await c.query(`SELECT * FROM ${table} WHERE id=$1`,[id])).rows[0];if(!row)return null;if(row.public_path&&!refresh)return row.public_path;
 let prefix='';if(kind==='person'&&row.team_id){const teamPath=await assignPath(c,'team',row.team_id);if(teamPath)prefix=teamPath+'/';}
 const base=prefix+segment(row.name);let path=base,n=1;
 while(true){const old=(await c.query(`SELECT ${fk} FROM ${aliases} WHERE lower(path)=lower($1)`,[path])).rows[0];if(!old||old[fk]===id)break;path=base+'-'+(++n);}
 await c.query(`INSERT INTO ${aliases}(path,${fk}) VALUES($1,$2) ON CONFLICT(path) DO NOTHING`,[path,id]);
 await c.query(`UPDATE ${table} SET public_path=$1 WHERE id=$2`,[path,id]);return path;
}
export async function ensureCatalog(c){for(const kind of ['team','person']){const rows=(await c.query(`SELECT id FROM ${kind==='team'?'teams':'people'} WHERE public_path IS NULL ORDER BY id`)).rows;for(const row of rows)await assignPath(c,kind,row.id);}}
export async function resolvePath(c,kind,path){const table=kind==='person'?'people':'teams',aliases=kind==='person'?'person_urls':'team_urls',fk=kind==='person'?'person_id':'team_id';if(/^\d+$/.test(path)&&(!Number.isSafeInteger(Number(path))||Number(path)>2147483647))return null;if(/^\d+$/.test(path))return (await c.query(`SELECT * FROM ${table} WHERE id=$1`,[Number(path)])).rows[0];return (await c.query(`SELECT e.* FROM ${aliases} a JOIN ${table} e ON e.id=a.${fk} WHERE a.path=$1`,[path])).rows[0];}
