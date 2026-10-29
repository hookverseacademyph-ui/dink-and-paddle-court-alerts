import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const STATE=path.join(HERE,'state/alerts.json');
export function selectOpenings(feed, favorites, now=Date.now()) {
  if(feed.verificationVersion!==2 || !Array.isArray(feed.openings)) throw new Error('Unverified feed; no alerts sent');
  const wanted=new Set(favorites.map(v=>v.hubId));
  return feed.openings.filter(s=>{
    let url;try{url=new URL(s.bookingUrl);}catch{return false;}
    const hub=url.pathname.split('/').at(-1);
    const [fh,fm]=(s.fromTime||'').split(':').map(Number),[th,tm]=(s.endTime||'').split(':').map(Number);
    const start=fh*60+fm,end=th*60+tm,day=new Date(s.dateIso+'T00:00:00Z').getUTCDay();
    const checked=Date.parse(s.checkedAt),session=Date.parse(`${s.dateIso}T${s.fromTime}:00+08:00`);
    return url.hostname==='app.sports360.ph' && wanted.has(hub) && s.platform==='360 Sports' &&
      s.availabilityVerified===true && Array.isArray(s.courtsFree) && s.courtsFree.length>0 &&
      ['bacoor','imus','kawit'].includes(String(s.municipality||'').toLowerCase().replace(/city|\s/g,'')) &&
      [0,6].includes(day) && start>=960 && end<=1320 && end-start>=120 && session>now &&
      Number.isFinite(checked) && checked<=now+60000 && now-checked<35*60000;
  }).sort((a,b)=>(a.municipality==='Bacoor'?0:1)-(b.municipality==='Bacoor'?0:1)||a.dateIso.localeCompare(b.dateIso)||a.fromTime.localeCompare(b.fromTime));
}
export function sessionKey(slot) {return [slot.bookingUrl,slot.dateIso,slot.fromTime,slot.endTime].join('|');}
export function alertPlan(slots, previous={}) {
  const current=Object.fromEntries(slots.map(s=>[sessionKey(s),[...new Set(s.courtsFree.map(String))].sort()]));
  const changed=slots.flatMap(slot=>{
    const key=sessionKey(slot),old=new Set(previous[key]||[]);
    const added=current[key].filter(c=>!old.has(c));
    return added.length?[{slot,key,courts:added}]:[];
  });
  // Keep prior known courts for unsent additions, but remove unavailable sessions/courts.
  const baseline=Object.fromEntries(Object.entries(current).map(([key,courts])=>[key,(previous[key]||[]).filter(c=>courts.includes(c))]));
  return {current,changed,baseline};
}
export function notification(entries) {
  const s=entries[0].slot;
  const rows=entries.map(e=>`${e.slot.dateStr} · ${e.slot.timeSlot}\nCourt ${e.courts.join(', ')} newly available`).join('\n\n');
  return `🏓 Dink and Paddle — Available court\n\n${s.venueName} · ${s.municipality}\n\n${rows}\n\nEach option is a separate session, free for its full duration.\nChecked: ${new Date(s.checkedAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})} PHT\nBook via 360 Sports:\n${s.bookingUrl}\n\nAvailability is as of this check; confirm on the booking portal.`;
}
export function alertBatches(changed) {
  const groups=new Map();
  for(const entry of changed){const key=entry.slot.bookingUrl;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
  const batches=[];
  for(const entries of groups.values()){
    let batch=[];
    for(const entry of entries){
      if(batch.length && notification([...batch,entry]).length>3500){batches.push(batch);batch=[];}
      batch.push(entry);
    }
    if(batch.length)batches.push(batch);
  }
  return batches;
}
async function save(state) {
  await mkdir(path.dirname(STATE),{recursive:true});
  await writeFile(STATE+'.tmp',JSON.stringify({version:1,slots:state},null,2)+'\n');await rename(STATE+'.tmp',STATE);
}
async function telegram(method,body) {
  const token=process.env.TELEGRAM_BOT_TOKEN;
  let response,data;
  try{
    response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    data=await response.json();
  }catch{throw new Error('Telegram connection failed; check credentials and network. No token is logged.');}
  if(!response.ok||!data.ok)throw new Error(`Telegram request failed (${data.error_code || response.status}). Confirm the bot token, personal chat ID and that you pressed Start.`);
  return data.result;
}
async function main() {
  const config=JSON.parse(await readFile(path.join(HERE,'watchlist.json'),'utf8'));
  const test=process.argv.includes('--test');
  if(!test && config.enabled!==true){console.log('Alerts disabled. Configure secrets/watchlist, then set enabled to true.');return;}
  if(!process.env.TELEGRAM_BOT_TOKEN || !/^\d+$/.test(process.env.TELEGRAM_CHAT_ID||'')) throw new Error('Set TELEGRAM_BOT_TOKEN and positive personal TELEGRAM_CHAT_ID in GitHub Actions secrets.');
  // Read-only verification prevents accidentally sending to a group instead of the requested personal chat.
  const chat=await telegram('getChat',{chat_id:process.env.TELEGRAM_CHAT_ID});
  if(chat.type!=='private')throw new Error('Alerts are configured for a personal Telegram chat only.');
  if(test){await telegram('sendMessage',{chat_id:process.env.TELEGRAM_CHAT_ID,text:'✅ Dink and Paddle Telegram connection works. This is a setup test, not a court-availability alert.',disable_notification:false});console.log('Test message sent to your personal chat.');return;}
  if(!Array.isArray(config.favorites)||!config.favorites.length || config.favorites.some(v=>!/^[a-f0-9-]{36}$/.test(v.hubId||'')))throw new Error('Add valid favorite venue hub IDs in watchlist.json.');
  const out=path.join(HERE,'openings.json');
  const args=[path.join(HERE,'scrape-sports360.mjs'),'--out',out];for(const v of config.favorites)args.push('--hub',v.hubId);
  try{const {stdout}=await promisify(execFile)(process.execPath,args,{cwd:HERE,timeout:12*60000,maxBuffer:4e6,windowsHide:true});console.log(stdout);}catch{throw new Error('Public availability scrape failed. No stale availability alerts were sent. Check the source and retry.');}
  const feed=JSON.parse(await readFile(out,'utf8'));
  if (feed.hubsChecked !== new Set(config.favorites.map(v=>v.hubId)).size) throw new Error('A favorite hub ID was not found in the provider directory; alert history was not changed.');
  const slots=selectOpenings(feed,config.favorites);
  let previous={};try{const state=JSON.parse(await readFile(STATE,'utf8'));if(state.version!==1 || typeof state.slots!=='object' || !state.slots)throw Error();previous=state.slots;}catch(e){if(e.code!=='ENOENT')throw new Error('Saved alert state is invalid; refusing to resend all alerts.');}
  const plan=alertPlan(slots,previous),state=plan.baseline;
  await save(state);
  let sent=0;
  for(const batch of alertBatches(plan.changed)){
    await telegram('sendMessage',{chat_id:process.env.TELEGRAM_CHAT_ID,text:notification(batch),disable_notification:false,link_preview_options:{is_disabled:true}});
    for(const entry of batch)state[entry.key]=plan.current[entry.key];
    await save(state);sent++;
    await new Promise(resolve=>setTimeout(resolve,1100));
  }
  console.log(`${slots.length} qualifying sessions checked; ${sent} new-availability alerts sent.`);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
