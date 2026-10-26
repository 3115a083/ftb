const $=s=>document.querySelector(s);
const theme=$('#theme-toggle');const labelTheme=()=>{if(theme){const mode=window.ftbTheme?.get()||'auto',label='Darstellung: '+{auto:'Automatisch',light:'Hell',dark:'Dunkel'}[mode];theme.textContent={auto:'◐',light:'☀',dark:'☾'}[mode];theme.setAttribute('aria-label',label);theme.title=label;}};labelTheme();theme?.addEventListener('click',()=>{const modes=['auto','light','dark'];window.ftbTheme.set(modes[(modes.indexOf(window.ftbTheme.get())+1)%3]);labelTheme();});
const favoriteKey='ftb-favorites:'+location.host;let favorites=[];try{const stored=JSON.parse(localStorage.getItem(favoriteKey)||'[]');if(Array.isArray(stored))favorites=stored.filter(x=>/^(team|person):\d+$/.test(x)).slice(0,100);}catch{}
function refreshFavorites(){document.querySelectorAll('[data-favorite]').forEach(b=>{const selected=favorites.includes(b.dataset.favorite);b.setAttribute('aria-pressed',String(selected));b.textContent=selected?'★':'☆';b.setAttribute('aria-label',b.dataset.name+(selected?' als Favorit entfernen':' als Favorit merken'));});let count=0;document.querySelectorAll('#favorite-matches .match').forEach(c=>{const show=(c.dataset.participants||'').split(' ').some(x=>favorites.includes(x));c.hidden=!show;if(show)count++;});if($('#my-games'))$('#my-games').hidden=!favorites.length;if($('#favorite-hint'))$('#favorite-hint').hidden=Boolean(favorites.length);if($('#favorite-matches')){let empty=$('#favorite-empty');if(!count&&favorites.length&&!empty){empty=document.createElement('p');empty.id='favorite-empty';empty.className='empty';empty.textContent='Gerade keine laufenden oder bestätigten Spiele deiner Favoriten.';$('#favorite-matches').append(empty);}if(count||!favorites.length)empty?.remove();}}
refreshFavorites();document.addEventListener('click',e=>{const b=e.target.closest('[data-favorite]');if(!b)return;const key=b.dataset.favorite;favorites=favorites.includes(key)?favorites.filter(x=>x!==key):[...favorites,key].slice(-100);try{localStorage.setItem(favoriteKey,JSON.stringify(favorites));}catch{}refreshFavorites();});
$('#directory-search')?.addEventListener('input',e=>document.querySelectorAll('[data-search]').forEach(el=>el.hidden=!el.dataset.search.includes(e.target.value.toLowerCase().trim())));
let timer;let fetching=false;let last='';let loginRequired=false;let failures=0;
function schedule(){clearTimeout(timer);if(!loginRequired&&!document.hidden&&navigator.onLine!==false)timer=setTimeout(poll,Math.min(120000,20000*2**failures));}
async function poll(){if(!$('#live-fields')||document.hidden||fetching||loginRequired||navigator.onLine===false)return;fetching=true;try{const r=await fetch('/api/live',{cache:'no-store'});if(r.status===401){loginRequired=true;$('#live-state').textContent='Sitzung abgelaufen. Bitte erneut anmelden.';const a=document.createElement('a');a.href='/login?next='+encodeURIComponent(location.pathname+location.search);a.textContent=' Anmelden';$('#live-state').append(a);return;}if(!r.ok)throw Error();const data=await r.json();failures=0;const signature=JSON.stringify([data.fieldsHtml,data.nextHtml,data.recentHtml,data.favoritesHtml]);if(signature!==last){const opened=[...document.querySelectorAll('#live-fields details[open]')].map(el=>[el.closest('[data-match]')?.dataset.match,[...el.parentElement.children].indexOf(el)]);for(const [selector,key] of [['#live-fields','fieldsHtml'],['#live-next','nextHtml'],['#live-results','recentHtml'],['#favorite-matches','favoritesHtml']])if($(selector))$(selector).innerHTML=data[key];for(const [id,index]of opened){const card=document.querySelector(`#live-fields [data-match="${id}"]`);const el=card?.querySelector('.match-metrics')?.children[index];if(el?.tagName==='DETAILS')el.open=true;}refreshFavorites();last=signature;}$('#live-state').textContent='Aktualisiert: '+new Date(data.updated).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});}catch{failures=Math.min(failures+1,3);if($('#live-state'))$('#live-state').textContent='Verbindung unterbrochen. Letzter Stand bleibt sichtbar.';}finally{fetching=false;schedule();}}
if($('#live-fields')){schedule();document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(timer);else poll();});window.addEventListener('online',poll);}
const telegram=$('#telegram-login');
if(telegram){
 const expires=Date.parse(telegram.dataset.expires);let timer,checking=false,stopped=false,failures=0;
 const state=$('#login-state');
 const stop=message=>{stopped=true;clearTimeout(timer);state.textContent=message;};
 const check=async()=>{
  clearTimeout(timer);if(stopped||checking)return;
  if(!Number.isFinite(expires)||Date.now()>=expires)return stop('Anmeldung abgelaufen. Bitte neu starten.');
  if(document.hidden||navigator.onLine===false)return;
  checking=true;
  try{
   const csrf=$('meta[name="csrf-token"]')?.content;
   const r=await fetch('/login/telegram/check',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:telegram.dataset.token,csrf})});
   if(r.status===410)return stop('Anmeldung abgelaufen. Bitte neu starten.');
   if(r.status===403)return stop('Anmeldung nicht mehr gültig. Bitte neu starten.');
   if(!r.ok)throw Error();
   const result=await r.json();failures=0;
   if(result.ready){stopped=true;location.assign(result.next||'/');return;}
   state.textContent='Warte auf deine Bestätigung …';
  }catch{failures=Math.min(failures+1,4);state.textContent='Verbindung unterbrochen. Anmeldung wird erneut geprüft …';}
  finally{checking=false;if(!stopped&&!document.hidden&&navigator.onLine!==false)timer=setTimeout(check,Math.min(2000*2**failures,expires-Date.now()));}
 };
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(timer);else check();});
 window.addEventListener('offline',()=>clearTimeout(timer));window.addEventListener('online',check);check();
}

document.addEventListener('click',e=>document.querySelectorAll('.download-menu[open]').forEach(menu=>{if(!menu.contains(e.target))menu.open=false;}));
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.download-menu[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();});});
