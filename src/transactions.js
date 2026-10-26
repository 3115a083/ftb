import { db } from './db.js';
import { requireThat } from './rules.js';
export async function transact(actorId, action, requestId, fn, { anonymous=false }={}) {
 const c=await db.connect();
 try {
  await c.query('BEGIN');
  // Single lock order serializes state changes across bot processes, not just one Map.
  await c.query('SELECT id FROM event_control WHERE id=1 FOR UPDATE');
  const actor=(await c.query('SELECT * FROM staff WHERE telegram_id=$1',[String(actorId)])).rows[0];
  if(!anonymous)requireThat(actor && actor.role!=='revoked','Keine Berechtigung.');
  if(requestId){requireThat(String(requestId).length<=150,'Ungültige Anfrage.');
   const inserted=await c.query('INSERT INTO operation_requests(request_id,actor_id,action) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING request_id',[String(requestId),String(actorId),action]);
   if(!inserted.rowCount){await c.query('COMMIT');return {replayed:true};}
  }
  const result=await fn(c,actor);
  await c.query('INSERT INTO audit_log(telegram_user_id,action,details) VALUES($1,$2,$3)',[String(actorId),action,result?.audit||{}]);
  await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
