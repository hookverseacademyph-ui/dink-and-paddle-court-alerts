export function twoHourOpenings(slots) {
  const minutes = value => { const [h,m] = (value || '').split(':').map(Number); return h * 60 + m; };
  const pretty = value => { const [h,m] = value.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };
  const key = s => `${s.bookingUrl || s.venueName}|${s.dateIso}|${s.fromTime}`;
  const index = new Map(slots.map(s => [key(s),s]));
  return slots.flatMap(slot => {
    const duration = minutes(slot.endTime) - minutes(slot.fromTime);
    if (duration >= 120) return [{...slot, durationMinutes: duration}];
    if (duration !== 60) return [];
    const next = index.get(key({...slot,fromTime:slot.endTime}));
    if (!next || minutes(next.endTime) - minutes(next.fromTime) !== 60) return [];
    const courts = (slot.courtsFree || []).map(String).filter(c => (next.courtsFree || []).map(String).includes(c));
    if (!courts.length) return [];
    return [{...slot,id:`${slot.id}-2h`,endTime:next.endTime,
      timeSlot:`${pretty(slot.fromTime)} - ${pretty(next.endTime)}`,
      durationMinutes:120,courtsFree:courts,status:'Available (2 hours)'}];
  });
}
