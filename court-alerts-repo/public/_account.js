import { VENUES } from './_scraper.js';

const response = (body, status=200) => new Response(JSON.stringify(body), {status,
  headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
const fail = (status, message) => Object.assign(new Error(message), {status});
const decode = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const parse = value => JSON.parse(new TextDecoder().decode(decode(value)));
let keysCache;

export async function accountKey(request, env, fetchKeys=fetch, now=Date.now()) {
  const issuer=String(env.ACCESS_ISSUER||'').trim().replace(/\/$/,'');
  const audience=String(env.ACCESS_AUD||'').trim();
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer))
    throw fail(503,'Account favorites setup: ACCESS_ISSUER is missing or invalid in this deployment.');
  if(!audience)
    throw fail(503,'Account favorites setup: ACCESS_AUD is missing in this deployment.');
  const token=request.headers.get('Cf-Access-Jwt-Assertion')||'';
  if(token.length>20000)throw fail(401,'Please sign in again.');
  let header,claims,parts;
  try {parts=token.split('.');if(parts.length!==3)throw Error();header=parse(parts[0]);claims=parse(parts[1]);}
  catch {throw fail(401,'Please sign in again.');}
  const seconds=now/1000;
  if(header.alg!=='RS256' || !header.kid || claims.iss!==issuer || !Array.isArray(claims.aud) ||
    !claims.aud.includes(audience) || !Number.isFinite(claims.exp) || claims.exp<=seconds ||
    (claims.nbf!==undefined && (!Number.isFinite(claims.nbf) || claims.nbf>seconds)) ||
    !Number.isFinite(claims.iat) || claims.iat>seconds+60 || !claims.sub || typeof claims.email!=='string')
    throw fail(401,'Please sign in again.');
  if(!keysCache || keysCache.issuer!==issuer || keysCache.until<now || !keysCache.keys.some(k=>k.kid===header.kid)) {
    const res=await fetchKeys(issuer+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(10000)});
    if(!res.ok)throw fail(503,'Login verification is temporarily unavailable.');
    const data=await res.json();
    if(!Array.isArray(data.keys))throw fail(503,'Login verification is temporarily unavailable.');
    keysCache={issuer,until:now+10*60000,keys:data.keys};
  }
  const jwk=keysCache.keys.find(k=>k.kid===header.kid && k.kty==='RSA' && (!k.use || k.use==='sig'));
  if(!jwk)throw fail(401,'Please sign in again.');
  let verified=false;
  try {
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  }catch{}
  if(!verified)throw fail(401,'Please sign in again.');
  // Only a hash of the verified account identity is stored; never trust browser-supplied emails.
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(issuer+'|'+claims.email.trim().toLowerCase()));
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}

export async function favorites(request,env,identity=accountKey) {
  if(!['GET','PUT'].includes(request.method))return response({error:'Method not allowed'},405);
  if(request.method==='PUT' && request.headers.get('Origin')!==new URL(request.url).origin)
    return response({error:'Same-origin request required'},403);
  try {
    const user=await identity(request,env);
    if(!env.FAVORITES_DB)throw fail(503,'Account favorites storage is not connected yet.');
    if(request.method==='PUT') {
      if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw fail(415,'JSON required');
      const text=await request.text();if(text.length>2000)throw fail(413,'Request too large');
      let body;try{body=JSON.parse(text);}catch{throw fail(400,'Invalid request');}
      if(!VENUES.some(v=>v.id===body.venueId) || typeof body.favorite!=='boolean')throw fail(400,'Invalid favorite venue');
      const statement=body.favorite
        ? 'INSERT OR IGNORE INTO favorites (user_key,venue_id) VALUES (?,?)'
        : 'DELETE FROM favorites WHERE user_key=? AND venue_id=?';
      await env.FAVORITES_DB.prepare(statement).bind(user,body.venueId).run();
    }
    const result=await env.FAVORITES_DB.prepare('SELECT venue_id FROM favorites WHERE user_key=?').bind(user).all();
    return response({favorites:result.results.map(row=>row.venue_id)});
  }catch(error){return response({error:error.status ? error.message : 'Account favorites are temporarily unavailable.'},error.status||503);}
}
