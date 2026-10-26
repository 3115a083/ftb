/* Static simulation only. No Telegram token, server API or persistent personal data. */
(() => {
 const oldRender=render,oldSite=siteMenu,oldTeams=teamsMenu;
 const D={role:'lead',selected:1,round:1,closed:false,status:'live',winner:null,approved:null,history:[],completed:[],
  people:[{id:1,name:'Alex',guest:false},{id:2,name:'Robin',guest:false},{id:3,name:'Gast 1',guest:true}],
  metrics:{1:{hits:0,received:0,distributed:0,empty_round:null},2:{hits:0,received:0,distributed:0,empty_round:null},3:{hits:0,received:0,distributed:0,empty_round:null}}};
 const labels={hits:'Treffer',received:'Strafbiere erhalten',distributed:'Strafbiere verteilt',empty_round:'Runden bis leer'};
 const safe=value=>String(value).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 function message(text,actions=[]){
  const card=document.createElement('div');card.className='msg';const content=document.createElement('div');content.textContent=text;content.style.whiteSpace='pre-line';card.append(content);
  if(actions.length){const buttons=document.createElement('div');buttons.className='buttons';for(const [label,fn]of actions){const b=document.createElement('button');b.className='tg';b.textContent=label;b.onclick=fn;buttons.append(b);}card.append(buttons);}
  $('chat').append(card);$('chat').scrollTop=$('chat').scrollHeight;
 }
 function home(){
  message(`FTB · ${D.role==='lead'?'Turnierleitung':'Helfer Alex'}\nTurbo-Vereinsabend\n${D.status==='pending'?'1 Ergebnisfreigabe offen':'Feld Nord: '+status()}`,[['Meine Spiele',game],...(D.role==='lead'?[['Freigaben',review],['Spielfelder',field],['Seite verwalten',oldSite],['Teams & Gruppen',oldTeams],['Turbo-Statistik',()=>{page('turboStats',document.getElementById('statsNav'));statistics();}]]:[]),['Rolle wechseln',()=>{D.role=D.role==='lead'?'helper':'lead';home();}]]);
 }
 function status(){return({live:'Läuft',paused:'Pausiert',pending:'Wartet auf Freigabe',finished:'Abgeschlossen',assigned:'Zugewiesen'})[D.status];}
 function game(){
  const p=D.people.find(x=>x.id===D.selected),values=D.metrics[p.id];
  const actions=[];
  if(D.status==='assigned')actions.push(['Spiel starten',()=>{if(D.closed)return message('Feld ist geschlossen. Erst öffnen oder ein anderes Feld wählen.');D.status='live';game();}]);
  if(D.status==='live'){
   if(D.role==='lead'||p.id===1||p.guest){for(const key of ['hits','received','distributed'])actions.push([labels[key]+' +1',()=>{D.history.push({id:p.id,key,before:values[key]});values[key]++;refreshCard();}]);actions.push(['Leer melden',()=>{D.history.push({id:p.id,key:'empty_round',before:values.empty_round});values.empty_round=D.round;refreshCard();}]);}
   actions.push(['Person auswählen',people],['Runde weiter',()=>{D.round++;refreshCard();}],['Letzte Eingabe zurücknehmen',()=>{const last=D.history.pop();if(last)D.metrics[last.id][last.key]=last.before;refreshCard();}],['Spiel pausieren',()=>{D.status='paused';refreshCard();}],['Gewinner melden',winner]);
  }
  if(D.status==='paused')actions.push(['Spiel fortsetzen',()=>{if(D.closed)return message('Feld ist geschlossen. Die Turnierleitung muss es öffnen oder das Spiel verlegen.');D.status='live';refreshCard();}]);
  if(D.status==='pending'&&D.role==='lead')actions.push(['Ergebnis prüfen',review]);
  if(D.status==='finished'&&D.role==='lead')actions.push(['Nächste Begegnung zusammenstellen',newRound]);
  actions.push(['Hauptmenü',home]);
  message(`Alex${D.people.some(p=>p.guest)?' + '+D.people.filter(p=>p.guest).map(p=>p.name).join(', '):''} gegen Robin\nFeld Nord · ${status()}\nGemeinsame Runde: ${D.round}\n\nSchnellaktionen für ${p.name}${p.guest?' (Gast, nur diese Begegnung)':''}\n${Object.keys(labels).map(k=>labels[k]+': '+(values[k]??'Nicht erfasst')).join('\n')}`,actions);
 }
 function refreshCard(){const chat=$('chat');if(chat.lastElementChild)chat.lastElementChild.remove();game();statistics();}
 function people(){message('Person auswählen',D.people.filter(p=>D.role==='lead'||p.id===1||p.guest).map(p=>[p.name,()=>{D.selected=p.id;game();}]));}
 function winner(){message('Wer hat gewonnen?',[['Alex + Gast 1',()=>confirmWinner('A')],['Robin',()=>confirmWinner('B')],['Zurück',game]]);}
 function confirmWinner(side){message('Gewinner: '+(side==='A'?'Alex + Gast 1':'Robin')+'\nWerte bleiben bis zur Leitungsfreigabe vorläufig.',[['Meldung absenden',()=>{D.winner=side;D.status='pending';game();statistics();}],['Auswahl ändern',winner]]);}
 function review(){if(D.role!=='lead')return message('Nur Turnierleitung.');if(D.status!=='pending')return message('Keine Ergebnisfreigaben offen.',[['Zurück',home]]);message('Feld Nord\nGemeldeter Gewinner: '+(D.winner==='A'?'Alex + Gast 1':'Robin')+'\nStatistik und Gewinner gemeinsam prüfen.',[['Ergebnis freigeben',()=>{D.status='finished';D.approved=D.winner;D.completed.push({winner:D.winner,people:D.people.map(p=>({...p})),metrics:structuredClone(D.metrics)});statistics();message('Ergebnis veröffentlicht. Feld Nord ist '+(D.closed?'weiterhin geschlossen.':'wieder frei.'),[['Übersicht',home]]);}],['Zur Korrektur zurückgeben',()=>{D.status='live';message('Meldung zur Korrektur zurückgegeben.',[['Spiel öffnen',game]]);}]]);}
 function field(){message('Feld Nord: '+(D.closed?'geschlossen':status()),[[D.closed?'Feld öffnen':'Feld jetzt schließen und pausieren',()=>{D.closed=!D.closed;if(D.closed&&D.status==='live')D.status='paused';field();statistics();}],['Spiel öffnen',game],['Zurück',home]]);}
 function newRound(){message('Neue Turbo-Begegnung\nGäste aus der vorherigen Runde werden nicht übernommen. Neue Gäste werden nur dieser Runde zugeordnet.',[['Gast für diese Runde hinzufügen',()=>{message('In der echten Anwendung gibst du hier den Gastnamen ein. Für die Simulation wird Gast 2 hinzugefügt.');D.people=D.people.filter(x=>!x.guest);D.people.push({id:4,name:'Gast 2',guest:true});D.metrics[4]={hits:0,received:0,distributed:0,empty_round:null};D.selected=4;D.status='assigned';D.round=1;D.history=[];D.winner=null;D.approved=null;D.metrics[1]={hits:0,received:0,distributed:0,empty_round:null};D.metrics[2]={hits:0,received:0,distributed:0,empty_round:null};message('Gast 2 für die nächste Begegnung aufgenommen.',[['Übersicht',home]]);}],['Zurück',home]]);}
 function statistics(){
  const known=D.people.filter(x=>!x.guest),guestEntries=D.completed.flatMap(g=>g.people.filter(p=>p.guest).map(p=>({person:p,metrics:g.metrics[p.id]})));
  const rows=known.map(p=>{const games=D.completed.filter(g=>g.people.some(x=>x.id===p.id));return `<tr><td>${safe(p.name)}</td><td>${games.length}</td><td>${games.filter(g=>(p.id===1&&g.winner==='A')||(p.id===2&&g.winner==='B')).length}</td><td>${games.length?games.reduce((n,g)=>n+g.metrics[p.id].hits,0):'–'}</td><td>${games.length?games.reduce((n,g)=>n+g.metrics[p.id].received,0):'–'}</td></tr>`;}).join('');
  $('turboStatsBody').innerHTML=`<div class="card"><span class="tag">TURBO</span><h3>Vereinsabend</h3><p>Mindestspielzahl: 3. Nur freigegebene Werte erscheinen in der offiziellen Rangliste.</p><div style="overflow:auto"><table style="width:100%;text-align:left"><thead><tr><th>Person</th><th>Spiele</th><th>Siege</th><th>Treffer</th><th>Erhalten</th></tr></thead><tbody>${rows}</tbody></table></div><p>Unterhalb von 3 Spielen noch nicht gewertet.</p></div><div class="card"><h3>Gäste gemeinsam</h3><p>${guestEntries.length} Gast-Einsätze. Keine persönliche oder Teamwertung.</p><p>Treffer: ${guestEntries.length?guestEntries.reduce((n,g)=>n+(g.metrics?.hits||0),0):'–'}</p></div><div class="card"><h3>Spielfeld Nord</h3><p>${D.closed?'Geschlossen':safe(status())}</p>${D.status==='pending'?'<p>Ergebnis wartet auf Leitungsfreigabe. Feld bleibt belegt.</p>':''}</div>`;
 }

 main=home;gamesMenu=game;render=function(){oldRender();statistics();};
 const nav=document.querySelector('.site .nav'),tab=document.createElement('button');tab.id='statsNav';tab.textContent='Turbo-Statistik';tab.onclick=()=>{page('turboStats',tab);statistics();};nav.append(tab);
 const section=document.createElement('section');section.id='turboStats';section.className='page';section.innerHTML='<h3>Turbo-Statistik</h3><div id="turboStatsBody" class="grid"></div>';document.querySelector('.content').append(section);
 const note=document.createElement('p');note.textContent='Simulation mit Beispieldaten. Neue Rollen, Live-Zähler, Freigaben und Gäste lassen sich im Telegram-Handy ausprobieren.';document.querySelector('.wrap').insertBefore(note,document.querySelector('.stage'));
 const style=document.createElement('style');style.textContent='#turboStatsBody{grid-template-columns:repeat(2,minmax(0,1fr))}#turboStatsBody>.card:first-child{grid-column:1/-1}#turboStatsBody table{border-collapse:collapse}#turboStatsBody th,#turboStatsBody td{padding:8px;text-align:left;border-bottom:1px solid #e5e7eb}#turboStatsBody th{font-size:.86rem}@media(max-width:600px){#turboStatsBody{grid-template-columns:1fr}}.tg:focus-visible,.nav button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}@media(max-width:430px){.phone{width:100%;min-width:0;transform:none;margin-bottom:0}.chat{height:560px}.stage{gap:16px}}@media(prefers-reduced-motion:reduce){.ticker span,.sponsorTrack{animation:none}}';document.head.append(style);
 $('chat').replaceChildren();home();statistics();
})();
