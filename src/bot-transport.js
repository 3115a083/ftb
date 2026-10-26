import { timingSafeEqual } from 'node:crypto';
export function remoteBot(){
 const root=process.env.BOT_GATEWAY_URL,id=process.env.INSTANCE_ID,secret=process.env.INSTANCE_SECRET;
 if(!root||!/^[a-z0-9-]{1,12}$/.test(id||'')||!secret||secret.length<32)throw Error('Gateway-Adresse, Instanzkennung und Instanzschlüssel erforderlich.');
 const methods=['sendMessage','editMessageText','deleteMessage','answerCallbackQuery','sendDocument','getFileLink','getMe'];
 return Object.fromEntries(methods.map(method=>[method,async(...args)=>{const encoded=args.map(a=>Buffer.isBuffer(a)?{ftbBuffer:a.toString('base64')}:a);const r=await fetch(root+'/rpc/'+id,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify({method,args:encoded}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Object.assign(Error('Telegram-Aktion fehlgeschlagen.'),{code:'GATEWAY'});return (await r.json()).result;}]));
}
export function installBotTransport(app,controller){
 if(!process.env.BOT_GATEWAY_URL)return;
 app.post('/internal/update',async(req,res)=>{
  const actual=String(req.headers.authorization||''),expected='Bearer '+process.env.INSTANCE_SECRET;
  if(actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return res.sendStatus(403);
  const {type,payload}=req.body||{};if(!controller||!['message','callback'].includes(type)||!payload?.from?.id)return res.sendStatus(400);
  const result=type==='message'?await controller.onMessage(payload):await controller.onCallback(payload);res.json({ok:true,groupBound:result?.groupBound===true,groupUnbound:result?.groupUnbound===true});
 });
}
