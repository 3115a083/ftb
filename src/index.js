import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { migrate } from './db.js';
import { syncGames } from './operations.js';
import { startBot } from './bot.js';
import { installBotTransport } from './bot-transport.js';
import { installSiteAuth } from './site-auth.js';
import { installWebsite } from './web.js';
export const app=express();let runningBot=null;
app.disable('x-powered-by');app.set('trust proxy',process.env.TRUST_PROXY==='1'?1:false);app.use(helmet({referrerPolicy:{policy:'strict-origin-when-cross-origin'}}));
app.get('/favicon.ico',(req,res)=>res.status(204).end());
app.get('/healthz',(req,res)=>res.send('ok'));
app.use('/assets',express.static(fileURLToPath(new URL('../public/',import.meta.url)),{maxAge:'1h',etag:true}));
app.use(express.urlencoded({extended:false,limit:'4kb'}));app.use(express.json({limit:'256kb'}));
// Authenticated service-to-service transport is not gated by a visitor's website login.
installBotTransport(app,{onMessage:m=>runningBot?.controller.onMessage(m),onCallback:q=>runningBot?.controller.onCallback(q)});
app.use('/internal',(req,res)=>res.sendStatus(404));
app.use(rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-7',legacyHeaders:false}));
installSiteAuth(app,async()=>runningBot?.username||process.env.TELEGRAM_BOT_USERNAME);
installWebsite(app);
app.use((req,res)=>res.status(404).send('Seite nicht gefunden.'));
app.use((err,req,res,next)=>{console.error('HTTP-Anfrage fehlgeschlagen:',err.code||err.name);if(res.headersSent)return;const message=String(err.message||'');const known=/Ungültig|passt nicht|nicht gefunden|inzwischen geändert/.test(message);res.status(message==='Turbo-Sitzung nicht gefunden.'?404:known?400:500).send(known?message:'Anfrage fehlgeschlagen. Bitte erneut versuchen.');});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.env.ALLOW_HTTP_TEST!=='1'&&(!process.env.SITE_URL||new URL(process.env.SITE_URL).protocol!=='https:'))throw Error('SITE_URL mit HTTPS setzen. Für lokale Tests ALLOW_HTTP_TEST=1.');
 await migrate();await syncGames();runningBot=await startBot();const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0');
 process.on('SIGTERM',async()=>{if(runningBot?.bot.stopPolling)await runningBot.bot.stopPolling();server.close();});
}
