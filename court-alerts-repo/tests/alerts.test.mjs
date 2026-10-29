import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectOpenings,alertPlan,sessionKey,notification,alertBatches,validateDestination,destinationIds,destinationHistory} from '../telegram-alerts.mjs';
const now=Date.parse('2026-10-29T12:00:00Z');
const hub='fbc00051-e9e1-4ecd-a39f-89ac01a30aaa';
const favorites=[{hubId:hub}];
const slot={id:'a',venueName:'The Pickle Prime - Bacoor',municipality:'Bacoor',platform:'360 Sports',bookingUrl:`https://app.sports360.ph/sportshub/${hub}`,dateIso:'2026-10-31',dateStr:'Sat, Oct 31',fromTime:'16:00',endTime:'18:00',timeSlot:'4:00 PM - 6:00 PM',checkedAt:'2026-10-29T11:59:00Z',availabilityVerified:true,courtsFree:['1']};
const feed=rows=>({verificationVersion:2,openings:rows});
test('only verified favorite weekend full 2-hour slots in priority window',()=>{
 const rows=[slot,{...slot,fromTime:'15:00'},{...slot,endTime:'23:00'},{...slot,endTime:'17:00'},{...slot,dateIso:'2026-10-30'},{...slot,availabilityVerified:false},{...slot,courtsFree:[]},{...slot,checkedAt:'2026-10-29T10:00:00Z'},{...slot,bookingUrl:'https://app.sports360.ph/sportshub/other'}];
 assert.deepEqual(selectOpenings(feed(rows),favorites,now),[slot]);assert.throws(()=>selectOpenings({},favorites,now));
});
test('no duplicate when availability is unchanged',()=>{
 const first=alertPlan([slot]);assert.equal(first.changed.length,1);assert.equal(alertPlan([slot],first.current).changed.length,0);
});
test('only newly free courts trigger; removed courts do not',()=>{
 const old=alertPlan([slot]).current;
 const more=alertPlan([{...slot,courtsFree:['1','2']}],old);assert.deepEqual(more.changed[0].courts,['2']);
 assert.equal(alertPlan([{...slot,courtsFree:['1']}],more.current).changed.length,0);
 assert.equal(alertPlan([],old).changed.length,0);
 assert.equal(alertPlan([slot],alertPlan([],old).current).changed.length,1);
});
test('unsent additions remain eligible for retry',()=>{
 const first=alertPlan([slot]);assert.equal(alertPlan([slot],first.baseline).changed.length,1);
});
test('same venue times batched without combining courts or pretending continuous availability',()=>{
 const other={...slot,fromTime:'19:00',endTime:'21:00',timeSlot:'7:00 PM - 9:00 PM',courtsFree:['2']};
 const batches=alertBatches(alertPlan([slot,other]).changed);assert.equal(batches.length,1);const text=notification(batches[0]);assert.ok(text.includes('Court 1 newly available'));assert.ok(text.includes('Court 2 newly available'));assert.ok(text.includes('Each option is a separate session'));
 assert.notEqual(sessionKey(slot),sessionKey(other));
});

test('destination accepts personal chats and groups, rejects malformed or mismatched targets',()=>{
 assert.doesNotThrow(()=>validateDestination('123',{id:123,type:'private'}));
 assert.doesNotThrow(()=>validateDestination('-123',{id:-123,type:'group'}));
 assert.doesNotThrow(()=>validateDestination('-100123',{id:-100123,type:'supergroup'}));
 for(const id of ['0','abc','@group','1.5','--123','']) assert.throws(()=>validateDestination(id,{id,type:'group'}));
 assert.throws(()=>validateDestination('-123',{id:-124,type:'group'}));
 assert.throws(()=>validateDestination('-123',{id:-123,type:'channel'}));
 assert.throws(()=>validateDestination('123',{id:123,type:'group'}));
});

test('multiple destinations parse, trim and deduplicate numeric chat IDs',()=>{
 assert.deepEqual(destinationIds('-5483676118, -5347774738,-5483676118'),['-5483676118','-5347774738']);
 assert.deepEqual(destinationIds('123'),['123']);
 for(const value of ['', '123,', '123,@group', '123;456']) assert.throws(()=>destinationIds(value));
});
test('delivery history is isolated per destination and unsent groups can retry',()=>{
 const a='-5483676118',b='-5347774738';
 const first=alertPlan([slot]);
 const histories=destinationHistory({version:2,chats:{[a]:first.current,[b]:first.baseline}},[a,b]);
 assert.equal(alertPlan([slot],histories[a]).changed.length,0);
 assert.equal(alertPlan([slot],histories[b]).changed.length,1);
 assert.equal(alertPlan([slot],histories['-999']||{}).changed.length,1);
});
test('legacy personal history does not suppress initial group delivery and corrupt state fails closed',()=>{
 const legacy={version:1,slots:alertPlan([slot]).current};
 assert.deepEqual(destinationHistory(legacy,['-5483676118','-5347774738']),{});
 assert.deepEqual(destinationHistory(legacy,['123']),{});
 for(const saved of [{version:3},{version:2,chats:[]},{version:2,chats:{bad:{a:null}}}]) assert.throws(()=>destinationHistory(saved,[]));
});
