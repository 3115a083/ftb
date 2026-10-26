import { remoteBot } from './bot-transport.js';
import { siteConfig, configureSite, saveSiteAccount } from './site-control.js';
import { confirmWebLogin } from './site-auth.js';
import TelegramBot from 'node-telegram-bot-api';
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { actor, listMatches, getMatch, matchAction, setup, createTurbo, closeField, suggestions, metricAction, metricValues, repairPreview, repairResult } from './operations.js';
import { approveAdmission, rejectAdmission, changeRole, requestAdmission, setEventPassword } from './auth.js';
import { LEADS, LABELS, BUSY, METRICS, requireThat, cleanName } from './rules.js';
import { savePage, telegramToHtml } from './page-settings.js';
import { COMMON_COLORS } from './colors.js';
import { qualificationPlan, standings } from './tournament.js';
import { turboStats, statisticsCsv } from './statistics.js';
import { statisticsPdf, rulesPdf, tournamentPdf } from './pdf.js';

const button=(text,data)=>({text:String(text).slice(0,60),callback_data:data});
const kb=rows=>({reply_markup:{inline_keyboard:rows}});
const back=(data='home',text='Zurück')=>[button(text,data)];
const num=s=>{requireThat(/^\d+$/.test(String(s))&&Number.isSafeInteger(Number(s)),'Ungültige Nummer.');return Number(s);};
const lead=a=>requireThat(LEADS.includes(a?.role),'Nur die Turnierleitung darf das.');
const sideName=(m,side)=>m.roster.filter(x=>x.side===side).map(x=>x.name).join(', ');
const title=m=>`${sideName(m,'A')} gegen ${sideName(m,'B')}`;
const pagination=(prefix,page,total)=>[...(page>0?[[button('Vorherige',prefix+':'+(page-1))]]:[]),...((page+1)*8<total?[[button('Weitere',prefix+':'+(page+1))]]:[])];
const clipped=s=>String(s).length>45?String(s).slice(0,42)+'...':String(s);
const privateMessage=m=>m?.chat?.type==='private'&&m.from?.id;

// All callbacks and form submissions re-check authorization against the database.
// Drafts expire and cannot be saved using a button from an older dialog.
export function createBotController(bot){
 const drafts=new Map(),queues=new Map(),pending=new Map();
 const send=(chat,text,rows=[])=>bot.sendMessage(chat,String(text).slice(0,4050),kb(rows));
 const draftFor=id=>{const f=drafts.get(String(id));if(f&&f.expires>Date.now())return f;drafts.delete(String(id));return null;};
 async function notify(text,ids=null){const targets=ids|| (await db.query("SELECT telegram_id FROM staff WHERE role IN ('admin','lead')")).rows.map(x=>x.telegram_id);await Promise.allSettled([...new Set(targets.filter(Boolean).map(String))].map(id=>send(id,text,[back('home','Übersicht öffnen')])));}
 async function home(chat,id){
  const a=await actor(id);
  if(!a)return send(chat,'FTB: Melde dich mit dem Veranstaltungspasswort an. Die Turnierleitung muss deinen Zugang anschließend freigeben.',[[button('Als Helfer anmelden','join')]]);
  const config=await siteConfig(),matches=(await listMatches()).filter(m=>config.mode==='turbo'?m.session_id:m.game_id),own=matches.filter(m=>String(m.helper_id)===String(id)||m.roster.some(r=>r.person_id&&r.person_id===a.person_id));
  const rows=[[button('Meine Spiele','list:mine:0'),button('Spielplan & Tabellen','overview')]];
  let text=`FTB · ${config.mode==='turbo'?'Turbo':'Teamturnier'} · ${a.display_name}\nRolle: ${{admin:'Administration',lead:'Turnierleitung',helper:'Helfer'}[a.role]}\n${own.filter(m=>BUSY.includes(m.status)).length} eigene aktive Begegnungen`;
  if(LEADS.includes(a.role)){const count=matches.filter(m=>m.status==='pending').length;text+=`\n${count} Ergebnisfreigaben offen`;rows.unshift([button(`Freigaben (${count})`,'list:pending:0'),button('Spielfelder','fields')]);rows.push([button('Spielbetrieb','list:active:0'),button('Turnier','tournament')],[button('Seite verwalten','page'),button('Verwaltung','manage')]);}
  rows.push([button('Hilfe','help')]);return send(chat,text,rows);
 }
 async function ask(chat,id,spec){
  const a=await actor(id);if(spec.role==='lead')lead(a);else if(spec.role==='admin')requireThat(a?.role==='admin','Nur Administratoren.');
  for(const [user,old] of drafts)if(old.expires<=Date.now())drafts.delete(user);
  requireThat(drafts.has(String(id))||drafts.size<1000,'Zu viele offene Dialoge. Bitte später versuchen.');
  const f={...spec,step:0,values:{...(spec.initial||{})},nonce:randomBytes(5).toString('hex'),expires:Date.now()+900000};drafts.set(String(id),f);return prompt(chat,id);
 }
 async function prompt(chat,id){
  const f=draftFor(id);requireThat(f,'Dialog abgelaufen. Bitte neu öffnen.');
  if(f.step>=f.fields.length){
   const lines=await Promise.all(f.fields.filter(x=>!x.secret).map(async x=>{const choices=typeof x.choices==='function'?await x.choices(f.values):x.choices;const label=v=>choices?.find(c=>c.value===v)?.label??v;const value=f.values[x.key];return x.label+': '+(value==null||value===''?'Nicht angegeben':x.type==='photo'?'Bild hochgeladen':x.type==='rules'?`${value.parts.length} Textteile`:Array.isArray(value)?value.map(label).join(', '):label(value));}));
   return send(chat,`${f.title}\n\n${f.summary?await f.summary(f.values):lines.join('\n')}\n\nNoch nicht gespeichert.`,[[button(f.saveLabel||'Speichern',`form:save:${f.nonce}`)],[button('Zurück',`form:back:${f.nonce}`),button('Verwerfen','abort')]]);
  }
  const field=f.fields[f.step],choices=typeof field.choices==='function'?await field.choices(f.values):field.choices;
  const rows=[];
  if(choices)for(const [offset,x] of choices.slice((f.page||0)*8,(f.page||0)*8+8).entries()){const index=(f.page||0)*8+offset;const selected=field.type==='multi'&&(f.values[field.key]||[]).includes(x.value);rows.push([button((selected?'Ausgewählt: ':'')+x.label,`form:pick:${f.nonce}:${index}`)]);}
  if(choices)rows.push(...pagination('form:page:'+f.nonce,f.page||0,choices.length));
  if(field.type==='multi')rows.push([button('Auswahl übernehmen',`form:next:${f.nonce}`)]);
  if(field.type==='rules')rows.push([button('Regelwerk übernehmen',`form:next:${f.nonce}`)]);
  if(f.values[field.key]!=null&&!choices)rows.push([button('Vorbelegung übernehmen',`form:keep:${f.nonce}`)]);
  if(field.optional)rows.push([button(field.type==='photo'?'Kein Logo / Logo entfernen':'Überspringen',`form:skip:${f.nonce}`)]);
  rows.push([button('Zurück',`form:back:${f.nonce}`),button('Abbrechen','abort')]);
  return send(chat,`${f.title}\nSchritt ${f.step+1}/${f.fields.length}: ${field.label}${field.hint?'\n'+field.hint:''}`,rows);
 }
 async function accept(chat,id,message){
  const f=draftFor(id);if(!f)return send(chat,'Keine Eingabe erwartet. Öffne eine Aktion über /start.',[back()]);
  const a=await actor(id);if(f.role==='lead')lead(a);if(f.role==='admin')requireThat(a?.role==='admin','Keine Berechtigung.');
  const field=f.fields[f.step];requireThat(field,'Bitte Speichern oder Verwerfen wählen.');
  let value=message.text||'';
  if(field.secret){await bot.deleteMessage(chat,message.message_id).catch(()=>{});drafts.delete(String(id));return f.submit({...f.values,[field.key]:value},`msg:${chat}:${message.message_id}`);}
  if(field.type==='photo'){
   const photo=message.photo?.at(-1);requireThat(photo&&photo.file_size<=2000000,'Bitte ein Foto mit höchstens 2 MB senden.');
   const url=await bot.getFileLink(photo.file_id);const u=new URL(url);requireThat(u.protocol==='https:'&&u.hostname==='api.telegram.org','Ungültiger Datei-Endpunkt.');
   const response=await fetch(url,{signal:AbortSignal.timeout(10000)});requireThat(response.ok,'Foto konnte nicht geladen werden.');
   let size=0;const parts=[];for await(const chunk of response.body){size+=chunk.length;requireThat(size<=2000000,'Foto ist zu groß.');parts.push(chunk);}const data=Buffer.concat(parts);requireThat(data[0]===0xff&&data[1]===0xd8,'Bitte ein JPEG-Foto senden.');value='data:image/jpeg;base64,'+data.toString('base64');
  }else if(field.type==='rules'){
   requireThat(message.text,'Bitte Text senden.');const current=f.values[field.key]||{parts:[],html:[]};
   requireThat(current.parts.join('\n\n').length+value.length<=60000,'Regelwerk ist zu lang.');current.parts.push(value);current.html.push(telegramToHtml(value,message.entities));f.values[field.key]=current;return send(chat,`Regelteil ${current.parts.length} übernommen. Weitere Nachricht senden oder übernehmen.`,[[button('Regelwerk übernehmen',`form:next:${f.nonce}`)],[button('Verwerfen','abort')]]);
  }else {requireThat(!field.choices,'Bitte einen Button auswählen.');if(field.parse)value=field.parse(value);else if(!field.optional)value=cleanName(value,field.max||500);else requireThat(value.length<=(field.max||500),'Eingabe zu lang.');}
  f.values[field.key]=value;f.step++;f.page=0;f.expires=Date.now()+900000;return prompt(chat,id);
 }
 async function formCallback(chat,id,parts,key){
  const [,action,nonce,index]=parts,f=draftFor(id);requireThat(f&&f.nonce===nonce,'Veralteter Dialog. Bitte neu öffnen.');
  if(action==='continue')return prompt(chat,id);
  if(action==='page'){f.page=num(index);return prompt(chat,id);}
  if(action==='back'){f.page=0;f.step=Math.max(0,f.step-1);return prompt(chat,id);}
  const field=f.fields[f.step];
  if(action==='save'){
   requireThat(f.step===f.fields.length,'Dialog ist noch nicht vollständig.');const a=await actor(id);if(f.role==='lead')lead(a);if(f.role==='admin')requireThat(a?.role==='admin','Keine Berechtigung.');
   const result=await f.submit(f.values,key);drafts.delete(String(id));return result;
  }
  requireThat(field,'Dialog bereits abgeschlossen.');
  if(action==='keep'){requireThat(f.values[field.key]!=null,'Keine Vorbelegung.');f.step++;f.page=0;return prompt(chat,id);}
  if(action==='pick'){
   const choices=typeof field.choices==='function'?await field.choices(f.values):field.choices;const selected=choices?.[num(index)];requireThat(selected,'Auswahl nicht mehr verfügbar.');
   if(field.type==='multi'){const values=f.values[field.key]||[];f.values[field.key]=values.includes(selected.value)?values.filter(x=>x!==selected.value):[...values,selected.value];return prompt(chat,id);}
   f.values[field.key]=selected.value;f.step++;f.page=0;
  }else if(action==='skip'){requireThat(field.optional,'Pflichtfeld.');f.values[field.key]=null;f.step++;f.page=0;}
  else if(action==='next'){if(field.key==='metrics')f.values.tiebreakers=(f.values.tiebreakers||[]).filter(x=>(f.values.metrics||[]).includes(x));requireThat(['multi','rules'].includes(field.type),'Ungültiger Schritt.');if(field.type==='multi')requireThat(field.optional||(f.values[field.key]||[]).length,'Mindestens eine Person auswählen.');if(field.type==='rules')requireThat(f.values[field.key]?.parts.length,'Regeltext fehlt.');f.step++;f.page=0;}
  return prompt(chat,id);
 }
 async function showList(chat,id,filter='active',page=0){
  const a=await actor(id);requireThat(a,'Keine Berechtigung.');const config=await siteConfig(),all=(await listMatches()).filter(m=>filter==='other'?(config.mode==='turbo'?m.game_id:m.session_id):config.mode==='turbo'?m.session_id:m.game_id);
  const matches=all.filter(m=>filter==='mine'?(String(m.helper_id)===String(id)||m.roster.some(r=>r.person_id&&r.person_id===a.person_id)):['active','other'].includes(filter)?BUSY.includes(m.status):filter==='pending'?m.status==='pending':filter==='planned'?m.status==='planned':filter==='finished'?['finished','cancelled'].includes(m.status):true);
  const offset=page*8,rows=matches.slice(offset,offset+8).map(m=>[button(`${LABELS[m.status]} · ${clipped(title(m))}`,`match:${m.id}`)]);
  if(page>0)rows.push([button('Vorherige',`list:${filter}:${page-1}`)]);if(offset+8<matches.length)rows.push([button('Weitere',`list:${filter}:${page+1}`)]);
  rows.push([button('Meine','list:mine:0'),button('Laufend','list:active:0')],[button('Offen','list:planned:0'),button('Abgeschlossen','list:finished:0')],back());
  return send(chat,`${{mine:'Meine Spiele',active:'Spielbetrieb',pending:'Ergebnisfreigaben',planned:'Noch nicht zugewiesen',finished:'Abgeschlossene Spiele'}[filter]||'Spielplan'}\n${matches.length} Begegnungen`,rows);
 }
 async function showMatch(chat,id,matchId,subjectId=null,messageId=null){
  const a=await actor(id);requireThat(a,'Keine Berechtigung.');const m=await getMatch(matchId),isLead=LEADS.includes(a.role),controller=isLead||String(m.helper_id)===String(id),participant=m.session_id&&m.roster.some(r=>r.person_id&&r.person_id===a.person_id);
  const values=await metricValues(m.id),config=(await db.query(m.session_id?'SELECT metrics FROM turbo_sessions WHERE id=$1':'SELECT metrics FROM event_control WHERE id=$1',[m.session_id||1])).rows[0];
  let text=`${title(m)}\n${m.field_name||'Kein Feld'} · ${LABELS[m.status]}\nBetreuung: ${m.helper_name||'Noch nicht zugewiesen'}\nRunde ${m.current_round}`;
  if(m.session_id){const sizeA=m.roster.filter(r=>r.side==='A').length,sizeB=m.roster.filter(r=>r.side==='B').length;text+=`\nBesetzung: ${sizeA} gegen ${sizeB}${sizeA!==sizeB?' · Unterschiedliche Seitengrößen, vor dem Start prüfen.':''}\nSpieltag: ${String(m.played_on).slice(0,10)}`;}
  if(m.reason)text+='\nHinweis: '+m.reason;
  if(m.winning_side)text+='\n'+(m.status==='finished'?'Freigegebener':'Gemeldeter')+' Gewinner: '+sideName(m,m.winning_side);
  for(const r of m.roster){text+='\n\n'+r.name+(r.guest_name?' (Gast, nur diese Begegnung)':'');for(const k of config.metrics){const v=values.find(x=>x.subject_id===r.id&&x.metric===k)?.total;text+=`\n${METRICS[k].label}: ${v??'Nicht erfasst'}`;}}
  const rows=[];
  if(m.session_id&&isLead)rows.push([button('Besetzung als Vorlage',`turbo_repeat:${m.id}`)]);
  if(m.status==='planned'&&isLead)rows.push([button('Feld & Helfer zuweisen',`assign:${m.id}`)]);
  if(m.status==='assigned'&&controller)rows.push([button('Spiel starten',`do:start:${m.id}:${m.version}`)]);
  if(m.status==='live'&&controller)rows.push([button('Spiel pausieren',`do:pause:${m.id}:${m.version}`)]);
  if(m.status==='paused'&&controller)rows.push([button('Spiel fortsetzen',`do:resume:${m.id}:${m.version}`)]);
  if(['live','paused','correction'].includes(m.status)&&(controller||participant))rows.push([button('Gewinner melden',`winner:${m.id}`)]);
  if(['live','correction'].includes(m.status)){
   const subjects=m.roster.filter(r=>isLead||(String(m.helper_id)===String(id)&&!participant)||(m.session_id&&r.person_id&&r.person_id===a.person_id)||(r.guest_name&&String(m.coordinator_id)===String(id)));
   for(const r of subjects)rows.push([button(`Werte: ${r.name}`,`subject:${m.id}:${r.id}`)]);
   const selected=subjects.find(x=>x.id===Number(subjectId));
   if(selected){text+='\n\nSchnellaktionen für: '+selected.name;
    for(const k of config.metrics)rows.push([button(k==='empty_round'?'Leer melden':METRICS[k].label+' +1',`metric:${m.id}:${selected.id}:${k}:add`),...(k==='empty_round'?[]:[button('0 erfassen',`metric:${m.id}:${selected.id}:${k}:zero`)])]);
   }
   if(m.status==='live'&&(isLead||String(m.coordinator_id)===String(id)||(String(m.helper_id)===String(id)&&!participant)))rows.push([button('Runde weiter',`metric:${m.id}:0:round:add`)]);
   if(subjects.length)rows.push([button('Letzte eigene Eingabe zurücknehmen',`metric:${m.id}:0:_:undo`)]);
  }
  if(m.status==='pending'&&isLead)rows.push([button('Ergebnis freigeben',`approve:${m.id}:${m.version}`)],[button('Gewinner korrigieren',`correct:${m.id}`),button('Zurückgeben',`return:${m.id}:${m.version}`)]);
  if(m.status==='finished'&&isLead)rows.push([button('Ergebnis reparieren',`repair:${m.id}`)]);
  if(BUSY.includes(m.status)&&(controller||participant))rows.push([button('Problem melden',`problem:${m.id}`)]);
  if(isLead&&BUSY.includes(m.status))rows.push([button('Weitere Aktionen',`more:${m.id}`)]);
  rows.push(back('list:mine:0','Meine Spiele'),back());
  if(messageId&&bot.editMessageText){try{return await bot.editMessageText(text.slice(0,4050),{chat_id:chat,message_id:messageId,...kb(rows)});}catch(e){if(String(e.response?.body?.description||'').includes('message is not modified'))return;}}
  return send(chat,text,rows);
 }
 async function overview(chat,id){requireThat(await actor(id),'Keine Berechtigung.');const tables=await standings();return send(chat,tables.map(g=>`Gruppe ${g.group}\n${g.teams.map(t=>`${t.disqualified?'DQ':t.place+'.'} ${t.name}: ${t.wins} Siege, ${t.losses} Niederlagen${t.tie_unresolved?' · Gleichstand':''}`).join('\n')}`).join('\n\n')||'Noch keine Gruppen.',[[button('Spielplan','list:all:0'),button('Turbo-Statistik','sessions')],back()]);}
 async function page(chat,id){lead(await actor(id));return send(chat,'Seite verwalten',[[button('Ersteinrichtung','p:onboarding')],[button('Titel','p:title'),button('Beschreibung','p:description')],[button('Farben','p:branding'),button('Seitenlogo','p:logo')],[button('Laufbanner setzen','p:ticker'),button('Banner aus','p:banner_off')],[button('Regelwerk','p:rules'),button('Regelwerk-PDF','export:rules:0')],[button('Sponsoren','sponsors')],back()]);}
 async function fields(chat,id){lead(await actor(id));const rows=(await db.query('SELECT * FROM fields ORDER BY id')).rows;return send(chat,'Spielfelder', [...rows.map(x=>[button(`${x.name} · ${x.closed?'geschlossen':'geöffnet'}`,`field:${x.id}`)]),[button('Feld hinzufügen','field_add')],back()]);}
 async function manage(chat,id){const a=await actor(id);lead(a);return send(chat,'Verwaltung',[...(a.role==='admin'?[[button('Instanz & Website-Zugang','webconfig')]]:[]),[button('Beitrittsanfragen','admissions'),button('Personen & Rollen','staff')],[button('Teilnehmer & Teamzuordnung','people'),button('Spielfelder','fields')],[button('Veranstaltungspasswort','password')],[button('Änderungsverlauf','audit:0'),button('Testdaten','demo')],back()]);}
 async function tournament(chat,id){lead(await actor(id));if((await siteConfig()).mode==='turbo')return callback({id:'turbo-menu',from:{id},message:{chat:{id:chat,type:'private'}},data:'sessions'});return send(chat,'Turnier verwalten',[[button('Teams','teams'),button('Gruppen & Spielplan','groups')],[button('K.-o.-Phase','knockout'),button('Finalmodus','p:final_mode')],[button('Wertung & Metriken','classic_metrics')],[button('Turnier-PDF','export:tournament:0')],back()]);}
 const finish=(chat,id,text='Gespeichert.')=>send(chat,text,[back()]);
 const simple=(chat,id,title,fields,submit,extra={})=>ask(chat,id,{title,fields,role:'lead',submit:async(v,k)=>{await submit(v,k);return finish(chat,id);},...extra});
 const peopleChoices=async()=> (await db.query('SELECT id,name FROM people WHERE active ORDER BY name,id')).rows.map(x=>({label:x.name,value:x.id}));
 const guestList=v=>v?String(v).split(',').map(x=>cleanName(x)).filter(Boolean):[];
 async function websiteSettings(chat,id,p,a){
  requireThat(a?.role==='admin','Nur Administratoren.');const config=await siteConfig();
  const save=(v,k)=>configureSite(id,{...v,version:config.site_version},k);
  if(p[0]==='webconfig')return send(chat,`Instanz: ${config.mode==='turbo'?'Turbo':'Teamturnier'}\nZeitzone: ${config.timezone}\nWebsite: ${config.site_methods.join(', ')||'öffentlich'}\nMindestspiele Jahreswertung: ${config.turbo_min_games}`,[[button('Modus wählen','wc:mode'),button('Zeitzone','wc:timezone')],[button('Anmeldearten kombinieren','wc:methods')],[button('Seitenpasswort ändern','wc:password')],[button('Website-Benutzer','webusers')],[button('Mindestspiele Jahreswertung','wc:minGames')],[button('Tiebreaker Jahreswertung','wc:ties')],[button('Alle Website-Sitzungen widerrufen','wc:revoke')],[button('Andere Spiele abschließen','list:other:0')],back('manage')]);
  if(p[0]==='webusers'){const users=(await db.query('SELECT id,username,active FROM site_accounts ORDER BY id')).rows;const page=num(p[1]||0);return send(chat,'Website-Zugänge vergeben keine Verwaltungsrechte.',[...users.slice(page*8,page*8+8).map(u=>[button(u.username+(u.active?' · aktiv':' · gesperrt'),`webuser:${u.id}:${u.active?'off':'on'}`)]),...pagination('webusers',page,users.length),[button('Passwortkonto anlegen / ändern','wc:account'),button('Telegram-ID freigeben','wc:telegram')],back('webconfig')]);}
  if(p[0]==='webuser')return simple(chat,id,'Website-Zugang ändern',[],(v,k)=>saveSiteAccount(id,{id:num(p[1]),active:p[2]==='on'},k),{role:'admin',summary:()=>`Konto ${p[1]} ${p[2]==='on'?'aktivieren':'sperren und Sitzungen widerrufen'}.`});
  if(p[1]==='mode')return simple(chat,id,'Instanzmodus wählen',[{key:'mode',label:'Modus',choices:[{label:'Teamturnier',value:'classic'},{label:'Turbo',value:'turbo'}]}],save,{role:'admin',summary:v=>`Website und Bot zeigen ${v.mode==='turbo'?'Turbo':'Teamturnier'}. Ein Wechsel ist nur ohne laufende oder zugewiesene Spiele möglich. Bestehende Daten bleiben erhalten.`});
  if(p[1]==='timezone')return simple(chat,id,'Zeitzone',[{key:'timezone',label:'IANA-Zeitzone, z. B. Europe/Berlin'}],save,{role:'admin'});
  if(p[1]==='methods')return simple(chat,id,'Website-Zugang',[{key:'methods',label:'Anmeldearten, leer = öffentlich',type:'multi',optional:true,choices:[{label:'Gemeinsames Seitenpasswort',value:'password'},{label:'Benutzername und Passwort',value:'account'},{label:'Telegram mit Browser-Bestätigung',value:'telegram'}]}],save,{role:'admin',initial:{methods:config.site_methods},summary:v=>`Zugang: ${(v.methods||[]).join(', ')||'Öffentlich ohne Anmeldung'}. Alle bisherigen Browser-Sitzungen werden widerrufen. PDF und CSV erhalten denselben Zugangsschutz.`});
  if(p[1]==='password')return ask(chat,id,{role:'admin',title:'Seitenpasswort ändern',fields:[{key:'password',label:'12 bis 200 Zeichen, Nachricht wird gelöscht. Getrennt vom Helferpasswort.',secret:true}],submit:async(v,k)=>{await save(v,k);return finish(chat,id,'Seitenpasswort geändert. Browser-Sitzungen widerrufen. Anmeldeart bei Bedarf aktivieren.');}});
  if(p[1]==='ties')return simple(chat,id,'Tiebreaker Jahreswertung',[{key:'tiebreakers',label:'Metriken in Reihenfolge auswählen. Leer = nur Siegquote.',type:'multi',optional:true,choices:Object.entries(METRICS).map(([value,m])=>({label:m.label,value}))}],save,{role:'admin',initial:{tiebreakers:config.turbo_tiebreakers}});
  if(p[1]==='minGames')return simple(chat,id,'Jahreswertung',[{key:'minGames',label:'Mindestspiele im gewählten Zeitraum: 1 bis 1000',parse:num}],save,{role:'admin'});
  if(p[1]==='revoke')return simple(chat,id,'Website-Sitzungen widerrufen',[],save,{role:'admin',summary:()=> 'Alle Besucher müssen sich erneut anmelden.'});
  if(p[1]==='account'||p[1]==='telegram')return ask(chat,id,{role:'admin',title:'Website-Zugang',fields:[{key:'username',label:'Benutzername: a-z, 0-9, Punkt, Bindestrich, Unterstrich'},...(p[1]==='telegram'?[{key:'telegramId',label:'Numerische Telegram-ID'}]:[{key:'password',label:'Neues Passwort: 12 bis 200 Zeichen. Nachricht wird gelöscht.',secret:true}])],submit:async(v,k)=>{await saveSiteAccount(id,v,k);return finish(chat,id,'Website-Zugang gespeichert. Die passende Anmeldeart muss aktiviert sein.');}});
 }
 async function callback(q){
  const m=q.message,id=q.from.id,chat=m?.chat?.id;if(!privateMessage({...m,from:q.from}))return;
  await bot.answerCallbackQuery(q.id).catch(()=>{});
  const data=q.data||'';
  if(data.startsWith('wl:')){await confirmWebLogin(data.slice(3),id,true);return send(chat,'Website-Anmeldung bestätigt. Kehre zum Browser zurück.');}
  requireThat(Buffer.byteLength(data)<=64,'Ungültige Aktion.');const p=data.split(':'),a=await actor(id);
  if(p[0]==='join')return ask(chat,id,{title:'Als Helfer anmelden',fields:[{key:'password',label:'Veranstaltungspasswort als private Nachricht senden.',secret:true}],submit:async v=>{const ok=await requestAdmission(q.from,v.password);if(ok)await notify(`Neue Beitrittsanfrage: ${q.from.first_name||'Helfer'}. Bitte Person prüfen und freigeben.`);return send(chat,ok?'Anfrage übermittelt. Die Turnierleitung muss dich persönlich freigeben.':'Anmeldung nicht möglich. Bitte später erneut versuchen.',[back()]);}});
  if(p[0]==='abort'){drafts.delete(String(id));return home(chat,id);}
  if(p[0]==='form')return formCallback(chat,id,p,'callback:'+q.id);
  if(p[0]==='home'&&!a)return home(chat,id);
  requireThat(a,'Bitte zuerst anmelden.');
  if(draftFor(id))drafts.delete(String(id));
  if(p[0]==='home')return home(chat,id);
  if(p[0]==='help')return send(chat,'Bedienung: /start öffnet die Übersicht. /spiele zeigt deine Begegnungen. /abbrechen verwirft einen Eingabedialog. Schnellaktionen zählen einzelne Werte. Erst Leitungsfreigaben veröffentlichen Ergebnisse. Gäste gelten nur für die jeweilige Turbo-Begegnung.',[back()]);
  if(p[0]==='list')return showList(chat,id,p[1],num(p[2]));
  if(p[0]==='match')return showMatch(chat,id,num(p[1]));
  if(p[0]==='subject')return showMatch(chat,id,num(p[1]),num(p[2]),m.message_id);
  if(p[0]==='overview')return overview(chat,id);
  if(p[0]==='page')return page(chat,id);
  if(p[0]==='manage')return manage(chat,id);
  if(p[0]==='webconfig'||p[0]==='wc'||p[0]==='webusers'||p[0]==='webuser')return websiteSettings(chat,id,p,a);
  if(p[0]==='tournament')return tournament(chat,id);
  if(p[0]==='metric'){await metricAction(id,num(p[1]),num(p[2]),p[3],p[4],'callback:'+q.id);return showMatch(chat,id,num(p[1]),num(p[2]),m.message_id);}
  if(p[0]==='winner'){
   const x=await getMatch(num(p[1]));return send(chat,'Gewinner auswählen:\n'+title(x),[[button(clipped(sideName(x,'A')),`report_preview:${x.id}:A:${x.version}`)],[button(clipped(sideName(x,'B')),`report_preview:${x.id}:B:${x.version}`)],back(`match:${x.id}`)]);
  }
  if(p[0]==='report_preview'){
   const x=await getMatch(num(p[1]));requireThat(x.version===num(p[3]),'Spiel wurde inzwischen geändert.');return send(chat,`Gewinner: ${sideName(x,p[2])}\nVerlierer: ${sideName(x,p[2]==='A'?'B':'A')}\nAlle erfassten Werte werden zur Prüfung eingereicht. Fehlende Werte bleiben ausdrücklich nicht erfasst.`,[[button('Meldung absenden',`report:${x.id}:${p[2]}:${x.version}`)],back(`match:${x.id}`)]);
  }
  if(p[0]==='report'){
   await matchAction(id,num(p[1]),'report',{side:p[2],version:num(p[3])},'callback:'+q.id);const x=await getMatch(num(p[1]));await notify(`Ergebnisfreigabe benötigt: ${title(x)}\nFeld: ${x.field_name}\nGemeldeter Gewinner: ${sideName(x,x.winning_side)}`);return showMatch(chat,id,x.id);
  }
  if(p[0]==='approve'){
   await matchAction(id,num(p[1]),'approve',{version:num(p[2])},'callback:'+q.id);const x=await getMatch(num(p[1]));await notify(`Ergebnis freigegeben: ${title(x)}\nGewinner: ${sideName(x,x.winning_side)}`,[x.reporter_id,x.helper_id]);return showMatch(chat,id,x.id);
  }
  if(p[0]==='correct'||p[0]==='return'){
   lead(a);const x=await getMatch(num(p[1]));const correct=p[0]==='correct';return simple(chat,id,correct?'Gewinner korrigieren und freigeben':'Meldung zurückgeben',[
    ...(correct?[{key:'side',label:'Tatsächlicher Gewinner',choices:['A','B'].map(s=>({label:sideName(x,s),value:s}))}]:[]),{key:'reason',label:'Begründung',max:500}],async(v,k)=>{await matchAction(id,x.id,correct?'approve':'return',{...v,version:x.version},k);await notify(`${correct?'Ergebnis korrigiert und freigegeben':'Korrektur erforderlich'}: ${title(x)}\n${v.reason}`,[x.reporter_id,x.helper_id]);});
  }
  if(p[0]==='do'){
   const action=p[1],mid=num(p[2]),version=num(p[3]);
   if(action==='pause'){await matchAction(id,mid,'pause',{version},'callback:'+q.id);await notify(`Spiel pausiert: ${title(await getMatch(mid))}`);return simple(chat,id,'Pausengrund ergänzen',[{key:'reason',label:'Grund',choices:['Feldproblem','Verletzung','Teamproblem','Sonstiges'].map(x=>({label:x,value:x}))}],(v,k)=>matchAction(id,mid,'problem',v,k),{role:null});}
   requireThat(['start','resume'].includes(action),'Ungültige Spielaktion.');await matchAction(id,mid,action,{version},'callback:'+q.id);return showMatch(chat,id,mid);
  }
  if(p[0]==='problem')return simple(chat,id,'Problem melden',[{key:'reason',label:'Problem beschreiben',max:500}],async(v,k)=>{await matchAction(id,num(p[1]),'problem',v,k);await notify(`Problem bei ${title(await getMatch(num(p[1])))}:\n${v.reason}`);},{role:null});
  if(p[0]==='more'){
   lead(a);const x=await getMatch(num(p[1]));return send(chat,'Weitere Aktionen: '+title(x),[[button('Feld wechseln',`move:${x.id}`),button('Helfer wechseln',`helper:${x.id}`)],[button('Fortsetzung sperren',`lock:${x.id}:${x.version}`)],[button('Rundenzähler festlegen',`coordinator:${x.id}`)],[button('Spiel absagen',`cancel:${x.id}`)],back(`match:${x.id}`)]);
  }
  if(p[0]==='lock'){await matchAction(id,num(p[1]),'lock_resume',{version:num(p[2])},'callback:'+q.id);return showMatch(chat,id,num(p[1]));}
  if(p[0]==='cancel')return simple(chat,id,'Spiel absagen',[{key:'reason',label:'Begründung'}],(v,k)=>matchAction(id,num(p[1]),'cancel',v,k));
  if(p[0]==='repair'){
   lead(a);const preview=await repairPreview(num(p[1]));return simple(chat,id,'Ergebnisreparatur',[{key:'side',label:'Richtiger Gewinner',choices:['A','B'].map(s=>({label:sideName(preview.match,s),value:s}))},{key:'reason',label:'Begründung'}],(v,k)=>repairResult(id,preview.match.id,{...v,token:preview.token},k),{saveLabel:'Korrigieren und genannte Folgespiele annullieren',summary:async v=>`Neuer Gewinner: ${sideName(preview.match,v.side)}\nGrund: ${v.reason}\nBetroffene Folgespiele werden annulliert, ihre bisherigen Werte bleiben im Verlauf erhalten:\n${preview.affected.map(x=>`Spiel ${x.id}: ${x.home_name} gegen ${x.away_name} · ${x.round_label} · ${LABELS[x.status]}${x.winner_name?' · bisheriger Gewinner: '+x.winner_name:''}`).join('\n')||'Keine Folgespiele betroffen.'}\nGruppenänderung: K.-o.-Phase danach erneut planen.`});
  }
  if(p[0]==='fields')return fields(chat,id);
  if(p[0]==='field_rename')return simple(chat,id,'Feld umbenennen',[{key:'name',label:'Neuer Feldname',max:80}],(v,k)=>setup(id,'field_rename',{...v,id:num(p[1])},k));
  if(p[0]==='field_add')return simple(chat,id,'Spielfeld hinzufügen',[{key:'name',label:'Feldname',max:80}],(v,k)=>setup(id,'field_add',v,k));
  if(p[0]==='field'){
   lead(a);const f=(await db.query('SELECT * FROM fields WHERE id=$1',[num(p[1])])).rows[0];requireThat(f,'Feld fehlt.');return send(chat,`${f.name}: ${f.closed?'geschlossen':'geöffnet'}`,f.closed?[[button('Feld wieder öffnen',`field_do:${f.id}:open`)],back('fields')]:[[button('Nächstes Spiel vorschlagen',`suggest:${f.id}`)],[button('Nach aktuellem Spiel schließen',`field_confirm:${f.id}:finish`)],[button('Jetzt schließen und Spiel pausieren',`field_confirm:${f.id}:pause`)],[button('Feld umbenennen',`field_rename:${f.id}`)],back('fields')]);
  }
  if(p[0]==='field_confirm'){lead(a);return send(chat,'Feld schließen? Zugewiesene und laufende Spiele bleiben erhalten. Bei sofortiger Schließung wird ein laufendes Spiel pausiert. Über die Spielkarte kann es anschließend verlegt werden.',[[button('Schließung bestätigen',`field_do:${num(p[1])}:${p[2]}`)],back(`field:${num(p[1])}`)]);}
  if(p[0]==='field_do'){await closeField(id,num(p[1]),p[2],'callback:'+q.id);await notify(`Feldstatus geändert: Feld ${p[1]}, ${p[2]}`);return fields(chat,id);}
  if(p[0]==='suggest'){
   lead(a);const items=await suggestions(num(p[1]));return send(chat,'Spielvorschläge. Letzte freigegebene Spielenden helfen bei der Pausenentscheidung.\n'+items.slice(0,6).map(x=>`${title(x)}\n${x.lastPlayed.map(t=>t.name+': '+(t.at?new Date(t.at).toLocaleTimeString('de-DE',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}):'noch kein Spiel')).join(' · ')}`).join('\n\n'),[...items.slice(0,6).map(x=>[button(clipped(title(x)),`pickhelper:${x.id}:${p[1]}`)]),[button('Alle offenen Spiele','list:planned:0')],back('fields')]);
  }
  if(p[0]==='assign'||p[0]==='move'){
   lead(a);const fs=(await db.query('SELECT * FROM fields WHERE NOT closed ORDER BY id')).rows;
   return send(chat,'Freies Zielfeld wählen. Belegte Felder werden beim Bestätigen zusätzlich geprüft.',[...fs.map(f=>[button(f.name,p[0]==='assign'?`pickhelper:${p[1]}:${f.id}`:`move_do:${p[1]}:${f.id}`)]),back(`match:${p[1]}`)]);
  }
  if(p[0]==='pickhelper'||p[0]==='helper'){
   lead(a);const x=await getMatch(num(p[1])),users=(await db.query("SELECT s.*,p.team_id FROM staff s LEFT JOIN people p ON p.id=s.person_id WHERE s.role<>'revoked' ORDER BY display_name")).rows;
   const filtered=users.filter(u=>!(x.game_id&&u.team_id&&x.roster.some(r=>r.team_id===u.team_id)));
   const pageIndex=num(p[3]||0),fieldId=p[0]==='helper'?0:num(p[2]);
   return send(chat,'Betreuung auswählen. Eigene Teambegegnungen sind ausgeschlossen.',[...filtered.slice(pageIndex*8,pageIndex*8+8).map(u=>[button(u.display_name,`assign_check:${x.id}:${fieldId}:${u.telegram_id}:${x.version}`)]),...pagination(`pickhelper:${x.id}:${fieldId}`,pageIndex,filtered.length),back(`match:${x.id}`)]);
  }
  if(p[0]==='assign_check'){
   lead(a);const [mid,fid,uid,ver]=[num(p[1]),num(p[2]),p[3],num(p[4])];const h=await actor(uid);requireThat(h,'Helfer fehlt.');const helperTeam=h.person_id?(await db.query('SELECT team_id FROM people WHERE id=$1',[h.person_id])).rows[0]?.team_id:null;const matches=await listMatches();const conflicts=matches.filter(x=>x.id!==mid&&BUSY.includes(x.status)&&(String(x.helper_id)===String(uid)||x.roster.some(r=>r.person_id&&r.person_id===h.person_id)||(helperTeam&&x.game_id&&x.roster.some(r=>r.team_id===helperTeam))));
   return send(chat,`${h.display_name} zuweisen?\n${conflicts.length?'Achtung: Weitere aktive Begegnungen/Aufgaben prüfen:\n'+conflicts.map(x=>title(x)).join('\n'):'Keine weiteren eigenen aktiven Aufgaben.'}`,[[button('Zuweisung bestätigen',`assign_do:${mid}:${fid}:${uid}:${ver}`)],back(`match:${mid}`)]);
  }
  if(p[0]==='assign_do'){
   const mid=num(p[1]),fid=num(p[2]);await matchAction(id,mid,fid?'assign':'helper',{fieldId:fid,helperId:p[3],version:num(p[4])},'callback:'+q.id);await notify(`Neue Spielzuweisung: ${title(await getMatch(mid))}`,[p[3]]);return showMatch(chat,id,mid);
  }
  if(p[0]==='move_do'){await matchAction(id,num(p[1]),'move',{fieldId:num(p[2])},'callback:'+q.id);const x=await getMatch(num(p[1]));await notify(`Spiel verlegt auf ${x.field_name}: ${title(x)}`,[x.helper_id,x.coordinator_id]);return showMatch(chat,id,x.id);}
  if(p[0]==='coordinator'){
   lead(a);const x=await getMatch(num(p[1])),users=(await db.query('SELECT telegram_id,display_name,person_id FROM staff WHERE person_id=ANY($1::int[]) AND role<>\'revoked\'',[x.roster.filter(r=>r.person_id).map(r=>r.person_id)])).rows;
   return simple(chat,id,'Rundenzähler wählen',[{key:'userId',label:'Beteiligte Person',choices:users.map(u=>({label:u.display_name,value:u.telegram_id}))}],(v,k)=>matchAction(id,x.id,'coordinator',v,k));
  }
  if(p[0]==='annual'){const stats=await turboStats(null);return send(chat,`${stats.session.name}\nMindestspiele: ${stats.session.min_games}\n${stats.rows.map(r=>`${r.place??'–'} ${r.name}: ${r.played} Spiele, ${r.wins} Siege`).join('\n')}`,[[button('Zeitraum / Export','period:gesamt')],back('sessions')]);}
  if(p[0]==='period'){return ask(chat,id,{title:'Statistikzeitraum',fields:[{key:'year',label:'Jahr (z. B. 2026) oder all',parse:v=>{requireThat(v==='all'||/^\d{4}$/.test(v),'Jahr oder all eingeben.');return v;}},{key:'day',label:'Optionaler Spieltag YYYY-MM-DD',optional:true},{key:'format',label:'Dateiformat',choices:[{label:'PDF',value:'pdf'},{label:'CSV',value:'csv'}]}],submit:async v=>{const stats=await turboStats(p[1]==='gesamt'?null:num(p[1]),db,v);return bot.sendDocument(chat,v.format==='pdf'?await statisticsPdf(stats):Buffer.from(statisticsCsv(stats)),{},{filename:'statistik.'+v.format,contentType:v.format==='pdf'?'application/pdf':'text/csv'});}});}
  if(p[0]==='sessions'){
   const pageIndex=num(p[1]||0);const sessions=(await db.query('SELECT * FROM turbo_sessions ORDER BY id DESC ')).rows;return send(chat,'Turbo-Sitzungen',[[button('Jahresrangliste','annual')],...sessions.slice(pageIndex*8,pageIndex*8+8).map(s=>[button(s.name+(s.finished?' · beendet':''),`session:${s.id}`)]),...(LEADS.includes(a.role)?[[button('Turbo-Turnier starten','session_add')]]:[]),...pagination('sessions',pageIndex,sessions.length),back()]);
  }
  if(p[0]==='session_add')return simple(chat,id,'Turbo-Turnier starten',[{key:'name',label:'Name'},{key:'minGames',label:'Mindestspiele für Rangliste (1 bis 1000)',parse:num}],(v,k)=>setup(id,'session_add',v,k));
  if(p[0]==='session'){
   const stats=await turboStats(num(p[1]));return send(chat,`${stats.session.name}\nMindestspiele: ${stats.session.min_games}\n${stats.rows.map(r=>`${r.place??'–'} ${r.name}: ${r.played} Spiele, ${r.wins} Siege${r.qualified?'':' · noch ungewertet'}`).join('\n')}\nGäste: ${stats.guests.played} gemeinsame Einsätze`,[
    ...(LEADS.includes(a.role)&&!stats.session.finished?[[button('Spiel zusammenstellen',`turbo:${p[1]}:manual`),button('Zusammensetzung vorschlagen',`turbo:${p[1]}:shuffle`)],[button('Wertung einstellen',`session_config:${p[1]}`),button('Sitzung beenden',`session_finish:${p[1]}`)]]:[]),[button('PDF',`export:stats_pdf:${p[1]}`),button('CSV',`export:stats_csv:${p[1]}`)],[button('Zeitraum / Export',`period:${p[1]}`)],back('sessions')]);
  }
  if(p[0]==='turbo'||p[0]==='turbo_repeat'){
   lead(a);const people=await peopleChoices();const shuffled=[...people];for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
   let initial=p[2]==='shuffle'?{sideA:shuffled.slice(0,Math.ceil(shuffled.length/2)).map(x=>x.value),sideB:shuffled.slice(Math.ceil(shuffled.length/2)).map(x=>x.value)}:{};
   let sessionId=num(p[1]);if(p[0]==='turbo_repeat'){const old=await getMatch(num(p[1]));requireThat(old.session_id,'Nur Turbo.');sessionId=old.session_id;initial={sideA:old.roster.filter(r=>r.side==='A'&&r.person_id).map(r=>r.person_id),sideB:old.roster.filter(r=>r.side==='B'&&r.person_id).map(r=>r.person_id),guestA:old.roster.filter(r=>r.side==='A'&&r.guest_name).map(r=>r.guest_name).join(', '),guestB:old.roster.filter(r=>r.side==='B'&&r.guest_name).map(r=>r.guest_name).join(', ')};}
   return simple(chat,id,'Turbo-Begegnung zusammenstellen',[
    {key:'sideA',label:'Seite A: Personen auswählen',type:'multi',optional:true,choices:people},
    {key:'guestA',label:'Gäste für Seite A: Namen durch Komma trennen. Nur für diese Begegnung.',optional:true,max:500},
    {key:'sideB',label:'Seite B: Personen auswählen',type:'multi',optional:true,choices:v=>people.filter(x=>!(v.sideA||[]).includes(x.value))},
    {key:'guestB',label:'Gäste für Seite B: Namen durch Komma trennen. Nur für diese Begegnung.',optional:true,max:500},
    {key:'playedOn',label:'Spieltag YYYY-MM-DD, überspringen für heute',optional:true,parse:v=>{requireThat(/^\d{4}-\d{2}-\d{2}$/.test(v),'Datum YYYY-MM-DD.');return v;}},
    {key:'coordinatorId',label:'Gemeinsame Runden zählt',choices:async v=>[{label:'Turnierleitung / neutrale Betreuung',value:null},...(await db.query("SELECT s.* FROM staff s WHERE s.person_id=ANY($1::int[]) AND s.role<>'revoked'",[ [...(v.sideA||[]),...(v.sideB||[]) ]])).rows.map(u=>({label:u.display_name,value:u.telegram_id}))]},
   ],async(v,k)=>{const row=await createTurbo(id,{sessionId,playedOn:v.playedOn,sideA:[...(v.sideA||[]).map(personId=>({personId})),...guestList(v.guestA).map(guestName=>({guestName}))],sideB:[...(v.sideB||[]).map(personId=>({personId})),...guestList(v.guestB).map(guestName=>({guestName}))],coordinatorId:v.coordinatorId},k);await showMatch(chat,id,row.id);},{initial});
  }
  if(p[0]==='session_config'||p[0]==='classic_metrics'){
   lead(a);const turbo=p[0]==='session_config',current=(await db.query(turbo?'SELECT * FROM turbo_sessions WHERE id=$1':'SELECT * FROM event_control WHERE id=$1',[turbo?num(p[1]):1])).rows[0];
   return simple(chat,id,'Metriken und Wertung',[
    {key:'metrics',label:'Aktive Metriken',type:'multi',optional:true,choices:Object.entries(METRICS).map(([value,m])=>({label:m.label,value}))},
    {key:'tiebreakers',label:'Tiebreaker in der gewünschten Reihenfolge auswählen',type:'multi',optional:true,choices:v=>(v.metrics||[]).map(value=>({label:METRICS[value].label,value}))},
    ...(turbo?[{key:'minGames',label:'Mindestspielzahl (1 bis 1000)',parse:num}]:[])],(v,k)=>setup(id,turbo?'session_config':'classic_metrics',{...v,tiebreakers:v.tiebreakers||[],id:turbo?num(p[1]):1},k),{initial:{metrics:current.metrics,tiebreakers:current.tiebreakers}});
  }
  if(p[0]==='session_finish')return simple(chat,id,'Turbo-Sitzung beenden',[],(v,k)=>setup(id,'session_finish',{id:num(p[1])},k),{summary:()=> 'Nur ohne laufende Spiele oder offene Freigaben möglich. Statistik und Exporte bleiben verfügbar.',saveLabel:'Sitzung beenden'});
  if(p[0]==='people'){
   lead(a);const pageIndex=num(p[1]||0);const people=await db.query('SELECT p.*,t.name team FROM people p LEFT JOIN teams t ON t.id=p.team_id ORDER BY p.id');return send(chat,'Teilnehmer und Teammitgliedschaften',[...people.rows.slice(pageIndex*8,pageIndex*8+8).map(x=>[button(x.name+(x.team?' · '+x.team:''),`person:${x.id}`)]),[button('Person hinzufügen','person_add')],...pagination('people',pageIndex,people.rows.length),back('manage')]);
  }
  if(p[0]==='person_add')return simple(chat,id,'Person hinzufügen',[{key:'name',label:'Name'},{key:'teamId',label:'Klassisches Team (optional)',choices:async()=>[{label:'Kein festes Team',value:null},...(await db.query('SELECT * FROM teams WHERE NOT is_demo ORDER BY name')).rows.map(x=>({label:x.name,value:x.id}))]}],(v,k)=>setup(id,'person_add',v,k));
  if(p[0]==='person')return simple(chat,id,'Teamzugehörigkeit ändern',[{key:'teamId',label:'Team',choices:async()=>[{label:'Kein festes Team',value:null},...(await db.query('SELECT * FROM teams WHERE NOT is_demo ORDER BY name')).rows.map(x=>({label:x.name,value:x.id}))]}],(v,k)=>setup(id,'person_team',{...v,personId:num(p[1])},k));
  if(p[0]==='teams'){
   lead(a);const pageIndex=num(p[1]||0);const teams=(await db.query('SELECT * FROM teams WHERE NOT is_demo ORDER BY name')).rows;return send(chat,'Teams',[...teams.slice(pageIndex*8,pageIndex*8+8).map(t=>[button(t.name+(t.disqualified?' · DQ':''),`team:${t.id}`)]),[button('Team hinzufügen','team_add')],...pagination('teams',pageIndex,teams.length),back('tournament')]);
  }
  if(p[0]==='team_add')return simple(chat,id,'Team hinzufügen',[{key:'name',label:'Teamname'}],(v,k)=>setup(id,'team_add',v,k));
  if(p[0]==='team'){
   lead(a);const t=(await db.query('SELECT * FROM teams WHERE id=$1',[num(p[1])])).rows[0];requireThat(t,'Team fehlt.');return send(chat,`${t.name}\nGruppe: ${t.group_name||'Keine'}\n${t.disqualified?'Disqualifiziert':'Spielberechtigt'}`,[[button('Name ändern',`team_edit:${t.id}:name`),button('Gruppe ändern',`team_edit:${t.id}:group_name`)],[button('Logo ändern',`team_edit:${t.id}:logo`)],[button(t.disqualified?'DQ aufheben':'Disqualifizieren',`team_edit:${t.id}:disqualified`)],back('teams')]);
  }
  if(p[0]==='team_edit'){
   const field=p[2],t=(await db.query('SELECT * FROM teams WHERE id=$1',[num(p[1])])).rows[0];requireThat(t,'Team fehlt.');
   return simple(chat,id,'Team bearbeiten',field==='disqualified'?[]:[{key:'value',label:field==='logo'?'Neues Logo als Foto senden':field==='name'?'Neuer Name':'Neue Gruppe',type:field==='logo'?'photo':undefined,optional:field!=='name'}],(v,k)=>setup(id,'team_edit',{id:t.id,field,value:field==='disqualified'?!t.disqualified:v.value||null},k),{summary:field==='disqualified'?()=>`${t.name}: ${t.disqualified?'Disqualifikation aufheben':'disqualifizieren'}. Offene Gruppenspiele dieses Teams werden bei Disqualifikation annulliert. Bereits freigegebene Gruppenergebnisse bleiben erhalten. K.-o.-Beteiligung erfordert den Reparaturdialog.`:undefined});
  }
  if(p[0]==='groups')return send(chat,'Gruppen & Spielplan',[[button('Automatisch einteilen','groups_auto')],[button('Gruppenspiele erzeugen','group_games')],[button('Gleichstände auflösen','ties')],[button('Ungespielten Plan verwerfen','groups_reset')],back('tournament')]);
  if(p[0]==='groups_auto')return simple(chat,id,'Gruppen einteilen',[{key:'count',label:'Anzahl Gruppen (1 bis 26)',parse:num}],(v,k)=>setup(id,'groups_auto',v,k),{summary:v=>`${v.count} Gruppen. Vorhandene Gruppenzuordnungen werden ersetzt. Nur vor Erzeugung der Spiele möglich.`});
  if(p[0]==='groups_reset')return simple(chat,id,'Ungespielten Spielplan verwerfen',[],(v,k)=>setup(id,'groups_reset',{},k),{summary:()=> 'Alle ungespielten Gruppenspiele werden annulliert; anschließend können Gruppen korrigiert und der Plan neu erzeugt werden. Bereits begonnene Turniere sind gesperrt.'});
  if(p[0]==='group_games')return simple(chat,id,'Gruppenspiele erzeugen',[],(v,k)=>setup(id,'group_games',{},k),{summary:()=> 'Round-Robin aus den aktuellen Gruppen erzeugen. Existierende Gruppenspiele werden nicht überschrieben.'});
  if(p[0]==='knockout'){
   lead(a);const plan=await qualificationPlan();return send(chat,`K.-o.-Empfehlung: ${plan.size} Teams\n${plan.unresolved.length?'Gleichstände zuerst auflösen.':'Alle Gruppenspiele müssen freigegeben sein.'}`,[[button('Gleichstände','ties')],[button('K.-o.-Phase vorbereiten','ko_prepare')],back('tournament')]);
  }
  if(p[0]==='ko_prepare')return simple(chat,id,'K.-o.-Phase erzeugen',[{key:'mode',label:'Finalmodus',choices:[{label:'Ein Entscheidungsspiel',value:'single'},{label:'Best of Three',value:'bo3'}]}],(v,k)=>setup(id,'knockout',v,k),{summary:v=>`K.-o.-Phase mit Finalmodus ${v.mode} erzeugen. Bestehende aktive K.-o.-Spiele werden niemals überschrieben.`});
  if(p[0]==='ties'){
   lead(a);const plan=await qualificationPlan();return send(chat,'Ungeklärte Gleichstände',[...plan.unresolved.map(g=>[button('Gruppe '+g.group,`tie:${g.teams[0].id}`)]),back('groups')]);
  }
  if(p[0]==='tie'){
   lead(a);const group=(await db.query('SELECT group_name FROM teams WHERE id=$1',[num(p[1])])).rows[0]?.group_name;requireThat(group,'Gruppe fehlt.');const teams=(await db.query('SELECT id,name FROM teams WHERE group_name=$1 AND NOT disqualified AND NOT is_demo ORDER BY name',[group])).rows;
   return simple(chat,id,'Reihenfolge für Gruppe '+group,[{key:'ids',label:'Teams in der gewünschten Reihenfolge auswählen',type:'multi',choices:teams.map(t=>({label:t.name,value:t.id}))}],(v,k)=>setup(id,'tie_order',{group,ids:v.ids},k),{summary:v=>'Reihenfolge: '+v.ids.map(x=>teams.find(t=>t.id===x)?.name).join(', ')});
  }
  if(p[0]==='staff'){
   lead(a);const pageIndex=num(p[1]||0);const users=(await db.query('SELECT * FROM staff ORDER BY display_name')).rows;return send(chat,'Personen & Rollen',[...users.slice(pageIndex*8,pageIndex*8+8).map(u=>[button(`${u.display_name} · ${u.role}`,`user:${u.telegram_id}`)]),...pagination('staff',pageIndex,users.length),back('manage')]);
  }
  if(p[0]==='user'){
   lead(a);const u=(await db.query('SELECT * FROM staff WHERE telegram_id=$1',[p[1]])).rows[0];requireThat(u,'Person fehlt.');const rows=[];
   if(a.role==='admin')for(const role of ['admin','lead','helper','revoked'])rows.push([button({admin:'Administration ernennen',lead:'Turnierleitung ernennen',helper:'Helferrechte',revoked:'Zugang entziehen'}[role],`role:${p[1]}:${role}`)]);
   else if(u.role==='helper')rows.push([button('Zugang entziehen',`role:${p[1]}:revoked`)]);
   rows.push([button('Mit Teilnehmerprofil verknüpfen',`link:${p[1]}`)],back('staff'));return send(chat,u.display_name+' · '+u.role,rows);
  }
  if(p[0]==='role')return simple(chat,id,'Berechtigung ändern',[],(v,k)=>changeRole(id,p[1],p[2],k),{summary:()=>`Telegram-ID ${p[1]} erhält Rolle ${p[2]}. Der letzte Administrator bleibt erhalten.`,role:p[2]==='revoked'?'lead':'admin'});
  if(p[0]==='link')return simple(chat,id,'Teilnehmerprofil verknüpfen',[{key:'personId',label:'Person auswählen',choices:peopleChoices}],(v,k)=>setup(id,'person_link',{userId:p[1],personId:v.personId},k));
  if(p[0]==='password')return ask(chat,id,{role:'lead',title:'Veranstaltungspasswort ändern',fields:[{key:'password',label:'Neues Passwort als private Nachricht senden (12 bis 200 Zeichen).',secret:true}],submit:async(v,k)=>{await setEventPassword(id,v.password,k);return finish(chat,id,'Veranstaltungspasswort geändert. Alte offene Beitrittsanfragen sind ungültig. Bestehende Freigaben bleiben erhalten.');}});
  if(p[0]==='admissions'){
   lead(a);const pageIndex=num(p[1]||0);const users=(await db.query("SELECT j.* FROM join_requests j,event_control e WHERE e.id=1 AND j.status='pending' AND j.password_epoch=e.password_epoch ORDER BY created_at")).rows;return send(chat,'Beitrittsanfragen. Person vor Freigabe prüfen.',[...users.slice(pageIndex*8,pageIndex*8+8).map(u=>[button(`${u.display_name} · ${u.telegram_id}`,`admit:${u.telegram_id}`),button('Ablehnen',`reject:${u.telegram_id}`)]),...pagination('admissions',pageIndex,users.length),back('manage')]);
  }
  if(p[0]==='reject'){await rejectAdmission(id,p[1],'callback:'+q.id);return finish(chat,id,'Beitrittsanfrage abgelehnt.');}
  if(p[0]==='admit')return simple(chat,id,'Helfer persönlich freigeben',[{key:'personId',label:'Teilnehmerprofil',choices:async()=>[{label:'Kein eigenes Teilnehmerprofil',value:null},...await peopleChoices()]}],(v,k)=>approveAdmission(id,p[1],v.personId,k),{summary:v=>`Telegram-ID ${p[1]} als Helfer freigeben. Teilnehmerprofil: ${v.personId||'Keines'}.`});
  if(p[0]==='audit'){
   lead(a);const page=num(p[1]),rows=(await db.query('SELECT a.*,s.display_name FROM audit_log a LEFT JOIN staff s ON s.telegram_id=a.telegram_user_id ORDER BY a.id DESC LIMIT 12 OFFSET $1',[page*12])).rows;
   return send(chat,rows.map(x=>`${new Date(x.created_at).toLocaleString('de-DE',{timeZone:'Europe/Paris'})} · ${x.display_name||x.telegram_user_id}\n${x.action}\n${JSON.stringify(x.details).slice(0,200)}`).join('\n\n')||'Keine weiteren Einträge.',[[button('Weitere',`audit:${page+1}`)],back('manage')]);
  }
  if(p[0]==='demo')return send(chat,'Testdaten bleiben von echten Turnieren getrennt. Nur Testteams und Testspiele werden verändert.',[[button('Testdaten erstellen','p:demo_seed'),button('Testdaten löschen','p:demo_clear')],back('manage')]);
  if(p[0]==='sponsors'){
   lead(a);const sponsors=(await db.query('SELECT * FROM sponsors ORDER BY sort_order,id')).rows;return send(chat,'Sponsoren',[...sponsors.map(s=>[button(s.name,`sponsor:${s.id}`)]),[button('Sponsor hinzufügen','p:sponsor_add')],back('page')]);
  }
  if(p[0]==='sponsor')return send(chat,'Sponsor verwalten',[[button('Daten bearbeiten',`p:sponsor_edit:${p[1]}`)],[button('Entfernen',`p:sponsor_delete:${p[1]}`)],back('sponsors')]);
  if(p[0]==='p'){
   lead(a);const expectedVersion=(await db.query('SELECT version FROM settings WHERE id=1')).rows[0].version;let kind=p[1],fields=[],title='Seite bearbeiten',submit;
   const colors=COMMON_COLORS.map(([label,value])=>({label,value}));
   if(['title','description','ticker','logo'].includes(kind))fields=[{key:'value',label:{title:'Seitentitel',description:'Beschreibung',ticker:'Laufbanner',logo:'Logo als Foto senden'}[kind],optional:kind!=='title',type:kind==='logo'?'photo':undefined,max:kind==='title'?120:500}];
   else if(kind==='banner_off'){kind='ticker';submit=(v,k)=>savePage(id,'ticker',{value:''},k);}
   else if(kind==='final_mode')fields=[{key:'value',label:'Finalmodus',choices:[{label:'Ein Entscheidungsspiel',value:'single'},{label:'Best of Three',value:'bo3'}]}];
   else if(kind==='branding')fields=[{key:'primary',label:'Primärfarbe',choices:colors},{key:'secondary',label:'Sekundärfarbe',choices:colors},{key:'accent',label:'Tertiärfarbe',choices:colors}];
   else if(kind==='rules')fields=[{key:'rules',label:'Formatierte Nachrichten senden. Mehrere Teile möglich.',type:'rules'}];
   else if(kind==='sponsor_add'||kind==='sponsor_edit')fields=[{key:'name',label:'Sponsorname',max:120},{key:'logo',label:'Sponsorlogo als Foto senden',type:'photo',optional:true},{key:'url',label:'Website (http/https)',optional:true}];
   else if(kind==='sponsor_delete')title='Sponsor entfernen';
   else if(kind==='demo_seed'||kind==='demo_clear')title=kind==='demo_seed'?'Testdaten erstellen':'Testdaten löschen';
   else if(kind==='onboarding'){
    title='Ersteinrichtung';fields=[{key:'title',label:'Seitentitel',max:120},{key:'description',label:'Beschreibung',optional:true},{key:'logo',label:'Seitenlogo als Foto',type:'photo',optional:true},{key:'primary',label:'Primärfarbe',choices:colors},{key:'secondary',label:'Sekundärfarbe',choices:colors},{key:'accent',label:'Tertiärfarbe',choices:colors},{key:'final_mode',label:'Finalmodus',choices:[{label:'Ein Entscheidungsspiel',value:'single'},{label:'Best of Three',value:'bo3'}]}];
   }else throw Error('Unbekannter Seitenbereich.');
   return simple(chat,id,title,fields,submit||((v,k)=>savePage(id,kind,{...v,expectedVersion,id:p[2]?num(p[2]):undefined,...(kind==='rules'?{plain:v.rules.parts.join('\n\n'),html:v.rules.html.join('<br><br>')}:{}),...(kind==='description'||kind==='ticker'?{value:v.value||''}:{})},k)));
  }
  if(p[0]==='export'){
   if(p[1]==='rules')return bot.sendDocument(chat,await rulesPdf(),{},{filename:'regelwerk.pdf',contentType:'application/pdf'});
   if(p[1]==='tournament'){lead(a);return bot.sendDocument(chat,await tournamentPdf(),{},{filename:'turnier.pdf',contentType:'application/pdf'});}
   const stats=await turboStats(num(p[2]));if(p[1]==='stats_pdf')return bot.sendDocument(chat,await statisticsPdf(stats),{},{filename:'turbo-statistik.pdf',contentType:'application/pdf'});
   if(p[1]==='stats_csv')return bot.sendDocument(chat,Buffer.from(statisticsCsv(stats)),{},{filename:'turbo-statistik.csv',contentType:'text/csv'});
  }
  throw Error('Aktion nicht verfügbar. Bitte /start öffnen.');
 }
 async function message(m){
  if(!privateMessage(m))return;const id=m.from.id,chat=m.chat.id,text=m.text||'',command=text.match(/^\/(\w+)(?:@\w+)?(?:\s|$)/)?.[1];
  if(command){
   if(command==='start'&&/^\/start(?:@\w+)? web_/.test(text)){const token=/^\/start(?:@\w+)? web_([a-z0-9-]{1,12})_([\w-]{32})$/.exec(text);requireThat(token&&token[1]===(process.env.INSTANCE_ID||'local'),'Anmeldung gehört zu einer anderen Instanz.');const preview=await confirmWebLogin(token[2],id);return send(chat,`Website-Anmeldung für ${preview.site}\nBrowser-Code: ${preview.code}\nNur bestätigen, wenn du diese Anmeldung selbst im Browser begonnen hast und der Code dort übereinstimmt.`,[[button('Meine Browser-Anmeldung bestätigen','wl:'+token[2])]]);}
   const routes={start:'home',spiele:'list:mine:0',teams:'teams',turnier:'tournament',seite:'page',verwaltung:'manage',hilfe:'help',abbrechen:'abort'};
   if(routes[command]){
    const f=draftFor(id);if(f&&command!=='abbrechen')return send(chat,'Du hast einen ungespeicherten Dialog. Fortsetzen oder verwerfen?',[[button('Dialog fortsetzen',`form:continue:${f.nonce}`)],[button('Verwerfen und Übersicht öffnen','abort')]]);
    return callback({id:'command:'+chat+':'+m.message_id,from:m.from,message:m,data:routes[command]});
   }
  }
  return accept(chat,id,m);
 }
 async function safe(fn,update){try{return await fn(update);}catch(e){
  // Telegram errors may include token-bearing request URLs. Never log raw errors.
  const chat=update.message?.chat?.id||update.chat?.id;
  if(chat)return send(chat,e.code?'Aktion fehlgeschlagen. Bitte aktuellen Stand öffnen.':String(e.message).slice(0,300),[back()]).catch(()=>{});
 }}
 function enqueue(update,fn){const id=String(update.from?.id||'');if((pending.get(id)||0)>=10)return Promise.resolve();pending.set(id,(pending.get(id)||0)+1);const previous=queues.get(id)||Promise.resolve();const task=previous.then(()=>safe(fn,update));queues.set(id,task);void task.finally(()=>{pending.set(id,(pending.get(id)||1)-1);if(!pending.get(id))pending.delete(id);if(queues.get(id)===task)queues.delete(id);});return task;}
 return {onCallback:q=>enqueue(q,callback),onMessage:m=>enqueue(m,message),home,drafts};
}
export async function startBot(){
 if(!process.env.TELEGRAM_BOT_TOKEN&&!process.env.BOT_GATEWAY_URL)return null;
 requireThat(!(process.env.TELEGRAM_BOT_TOKEN&&process.env.BOT_GATEWAY_URL),'Bot-Token nur im Gateway setzen oder Standalone-Betrieb wählen.');
 const remote=Boolean(process.env.BOT_GATEWAY_URL),bot=remote?remoteBot():new TelegramBot(process.env.TELEGRAM_BOT_TOKEN,{polling:true});
 const controller=createBotController(bot);
 if(!remote){bot.on('callback_query',controller.onCallback);bot.on('message',controller.onMessage);bot.on('polling_error',()=>console.error('Telegram-Verbindung fehlgeschlagen.'));await bot.setMyCommands([{command:'start',description:'Übersicht und offene Aufgaben'},{command:'spiele',description:'Meine Spiele'},{command:'turnier',description:'Turnier verwalten'},{command:'verwaltung',description:'Verwaltung'},{command:'abbrechen',description:'Dialog verwerfen'}]).catch(()=>{});}
 let me;try{me=await bot.getMe();}catch{throw Error('Bot-Verbindung fehlgeschlagen. Token und Gateway prüfen.');}return {bot,controller,username:me.username};
}
