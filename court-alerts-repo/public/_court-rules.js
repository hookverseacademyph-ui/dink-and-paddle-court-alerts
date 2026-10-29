export function normalizeCourtNumber(value) {
  const text=String(value ?? '').trim();
  const number=text.match(/\d+/);
  return number ? String(parseInt(number[0],10)) : text.replace(/\s+/g,'');
}
export function activePickleballCourts(courts) {
  return courts.filter(c => String(c.status || '').toLowerCase()==='active' &&
    /pickleball/i.test(c.sport || c.courtType || '') && normalizeCourtNumber(c.courtNumber));
}
export function freeCourtsForSession(courts, bookings, dateIso, fromMinutes, duration=120) {
  const midnight=Date.parse(dateIso+'T00:00:00+08:00');
  const from=midnight+fromMinutes*60000, to=from+duration*60000;
  const taken=new Set();
  for(const booking of bookings) {
    if(!booking || !/^\d{2}:\d{2}/.test(booking.fromTime || '') || !/^\d{2}:\d{2}/.test(booking.endTime || '')) throw new Error('Unrecognized calendar time; cannot verify availability');
    const date=booking.actualDate || booking.date || dateIso;
    let start=Date.parse(`${date}T${booking.fromTime.slice(0,5)}:00+08:00`);
    let end=Date.parse(`${date}T${booking.endTime.slice(0,5)}:00+08:00`);
    if(!Number.isFinite(start)||!Number.isFinite(end)) throw new Error('Invalid calendar date');
    if(end<=start) end+=86400000;
    if(start<to && end>from) {
      if(!Array.isArray(booking.courtNumbers)||!booking.courtNumbers.length) throw new Error('Calendar court identifiers unavailable');
      booking.courtNumbers.forEach(n=>taken.add(normalizeCourtNumber(n)));
    }
  }
  return [...new Set(courts.map(c=>normalizeCourtNumber(c.courtNumber)))].filter(n=>!taken.has(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
}
