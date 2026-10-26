import { randomBytes, createHash } from 'node:crypto';
import { db } from './db.js';
import { transact } from './transactions.js';
import { LEADS, requireThat } from './rules.js';
import { turboStats } from './statistics.js';
import { standings } from './tournament.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
export const telegramName=user=>user?.username?'@'+user.username:[user?.first_name,user?.last_name].filter(Boolean).join(' ').slice(0,100)||null;
export async function rememberTelegram(user){const name=telegramName(user);if(name&&user?.id)await db.query('UPDATE staff SET display_name=$1,telegram_known=true WHERE telegram_id=$2',[name,String(user.id)]);}
export async function inviteGroup(userId,key){const token=randomBytes(18).toString('hex');await transact(userId,'group_invite',key,async(c,a)=>{requireThat(LEADS.includes(a.role),'Nur Turnierleitung.');await c.query('DELETE FROM group_invites WHERE expires_at<now() OR created_by=$1',[String(userId)]);await c.query("INSERT INTO group_invites(token_hash,created_by,expires_at) VALUES($1,$2,now()+interval '10 minutes')",[hash(token),String(userId)]);return {audit:{}};});return token;}
export async function groupStatistics(){const mode=(await db.query('SELECT mode FROM event_control WHERE id=1')).rows[0].mode;
 if(mode==='turbo'){const s=await turboStats(null);return `${s.session.name}\nNur freigegebene Spiele · Mindestspiele: ${s.session.min_games}\n`+(s.rows.slice(0,12).map(r=>`${r.place??'–'}. ${r.name}: ${r.played} Spiele · ${r.wins} Siege · ${(r.win_rate*100).toFixed(1)} %${r.qualified?'':' (noch ungewertet)'}`).join('\n')||'Noch keine freigegebenen Spiele.');}
 return (await standings()).map(g=>`Gruppe ${g.group}\n${g.teams.slice(0,12).map(t=>`${t.place}. ${t.name}: ${t.wins} Siege · ${t.played} Spiele`).join('\n')}`).join('\n\n')||'Noch keine freigegebenen Ergebnisse.';
}
export async function groupMessage(bot,m){
 if(!['group','supergroup'].includes(m.chat?.type)||!m.from?.id)return;
 const cmd=/^\/(ftb_verbinden|ftb_trennen|statistik|updates)(?:@\w+)?(?:\s+(.*))?$/s.exec(m.text||'');if(!cmd)return;
 const [,,args='']=cmd,chat=String(m.chat.id),user=String(m.from.id);let result;
 if(cmd[1]==='ftb_verbinden'){
  const token=args.trim().split(/\s+/).at(-1);requireThat(/^[a-f0-9]{36}$/.test(token||''),'Verbindungscode im privaten Bot unter Gruppen & Updates erstellen.');
  await transact(user,'group_bound','group:'+chat+':'+m.message_id,async(c,a)=>{requireThat(LEADS.includes(a.role),'Nur Turnierleitung darf die Gruppe verbinden.');const invite=(await c.query('DELETE FROM group_invites WHERE token_hash=$1 AND created_by=$2 AND expires_at>now() RETURNING token_hash',[hash(token),user])).rows[0];requireThat(invite,'Verbindungscode ungültig oder abgelaufen.');await c.query('INSERT INTO telegram_groups(chat_id,title,enabled_by) VALUES($1,$2,$3) ON CONFLICT(chat_id) DO UPDATE SET title=EXCLUDED.title,enabled_by=EXCLUDED.enabled_by',[chat,String(m.chat.title||'Gruppe').slice(0,100),user]);return {audit:{chat}};});
  await bot.deleteMessage(m.chat.id,m.message_id).catch(()=>{});await bot.sendMessage(m.chat.id,'✅ Gruppe verbunden. /statistik zeigt freigegebene Ergebnisse. Eine Turnierleitung kann mit /updates an automatische Spielstarts und freigegebene Ergebnisse aktivieren. /ftb_trennen beendet die Verbindung.');return {groupBound:true};
 }
 const group=(await db.query('SELECT * FROM telegram_groups WHERE chat_id=$1',[chat])).rows[0];if(!group)return;
 if(cmd[1]==='statistik')return bot.sendMessage(m.chat.id,(await groupStatistics()).slice(0,3900));
 await transact(user,'group_settings','group:'+chat+':'+m.message_id,async(c,a)=>{requireThat(LEADS.includes(a.role),'Nur Turnierleitung darf Gruppen-Updates ändern.');if(cmd[1]==='ftb_trennen'){await c.query('DELETE FROM telegram_groups WHERE chat_id=$1',[chat]);result={groupUnbound:true};}else{requireThat(['an','aus'].includes(args.trim()),'/updates an oder /updates aus senden.');await c.query('UPDATE telegram_groups SET updates=$1 WHERE chat_id=$2',[args.trim()==='an',chat]);}return {audit:{chat,command:cmd[1],updates:args.trim()==='an'}};});
 await bot.sendMessage(m.chat.id,result?'Gruppe getrennt.':args.trim()==='an'?'🔔 Spielstarts und freigegebene Ergebnisse werden hier angezeigt.':'🔕 Automatische Updates deaktiviert.');return result;
}
export async function publishGroups(bot,text,{statistics=false}={}){const groups=(await db.query('SELECT chat_id FROM telegram_groups WHERE updates')).rows;if(!groups.length)return;const summary=statistics?'\n\n'+await groupStatistics():'';await Promise.allSettled(groups.map(g=>bot.sendMessage(g.chat_id,(text+summary).slice(0,3900))));}
