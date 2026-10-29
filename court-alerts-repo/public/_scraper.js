import {activePickleballCourts,freeCourtsForSession} from './_court-rules.js';
export const VENUES=[{"id": "5812c8bc-dfe5-4e9f-9b7f-59da95a76efb", "name": "PCKLD.", "address": "", "trackedCity": "Bacoor"}, {"id": "fbc00051-e9e1-4ecd-a39f-89ac01a30aaa", "name": "The Pickle Prime - Bacoor", "address": "", "trackedCity": "Bacoor"}, {"id": "cb5e7b37-1719-4a18-963e-06c02ff3d448", "name": "Garahe Pickleball Court", "address": "", "trackedCity": "Imus"}, {"id": "0cde9299-793e-40ce-a1a2-7c1d374d542c", "name": "Assenda", "address": "", "trackedCity": "Kawit"}, {"id": "af6cb5a6-7262-4502-9f65-b35de3a026f1", "name": "Dink ‘n Smash", "address": "", "trackedCity": "Kawit"}, {"id": "eec48bf0-423a-4824-bc9a-61fa57d672d6", "name": "The Court BLVD", "address": "", "trackedCity": "Bacoor"}, {"id": "d5c4c969-3ea4-434a-8d89-3a14e44d03b6", "name": "Courthaus", "address": "", "trackedCity": "Bacoor"}];
const DAYS_AHEAD=14, ALL_TIMES=false, TRACKED_VENUES=[], CITY_NAMES=['Bacoor','Imus','Kawit'];
async function providerJson(urlPath) {
  const response=await fetch('https://app.sports360.ph'+urlPath,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(18000)});
  if(!response.ok)throw new Error('Booking provider unavailable');
  const data=await response.json();
  return data;
}
function pad(n) {
  return String(n).padStart(2, '0');
}
function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayName(d) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
}
function shortDate(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

/** "5:00 PM - 8:00 PM", matching the format the app already displays. */
function prettyRange(from, to) {
  const f = to12(from);
  const t = to12(to);
  return `${f} - ${t}`;
}
function to12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 && h < 24 ? 'PM' : 'AM';
  let hour = h % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${pad(m)} ${ampm}`;
}
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function municipalityOf(address = '') {
  for (const city of CITY_NAMES) {
    if (new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(address)) {
      return city === 'Dasmarinas' ? 'Dasmariñas' : city;
    }
  }
  return '';
}

function parseHours(storeHours) {
  if (!storeHours) return {};
  let list = storeHours;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return {};
    }
  }
  if (!Array.isArray(list)) return {};
  const map = {};
  for (const row of list) {
    if (!row || !row.day) continue;
    map[row.day] = row;
  }
  return map;
}

/** Opening minutes-of-day for a date, or null when the hub is closed that day. */
function openWindow(hoursMap, date) {
  const row = hoursMap[dayName(date)];
  if (!row || row.isOpen === false) return null;
  if (row.is24HourOperation) return { start: 0, end: 1440 };
  const start = toMinutes(row.openTime || '00:00');
  let end = toMinutes(row.closeTime || '00:00');
  if (end === 0 || end <= start) end += 1440;
  return { start, end };
}

function pickRentalType(types) {
  if (!Array.isArray(types) || types.length === 0) return null;
  const usable = types.filter((t) => t && t.isActive !== false && t.pricePerHour != null && Number(t.pricePerHour) > 0);
  const courtRental = usable.find((t) => /court rental/i.test(t.rentalType || ''))
    || usable.find((t) => (t.category || '').toLowerCase() === 'rental');
  return courtRental || usable[0] || null;
}

export async function scrapeVenue(id, getJson=providerJson) {
  const hub=VENUES.find(v=>v.id===id);
  if(!hub)throw new Error('Unknown venue');
  const targets=[hub];
  const dates = [];
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (ALL_TIMES || [0, 6].includes(d.getDay())) dates.push(d);
  }

  const openings = [];
  const hubSummaries = [];
  const verifiedVenues = [];
  let checked = 0;

  for (const hub of targets) {
    checked++;


    const info = await getJson(`/api/public/sportshub/${hub.id}`);
    const courts = await getJson(`/api/public/sportshub/${hub.id}/courts`);
    const rentalTypes = await getJson(`/api/public/rental-types?storehubId=${hub.id}`);

    if (!Array.isArray(courts) || courts.length === 0) continue;

    const activeCourts = activePickleballCourts(courts);
    if (!info || info.isInactive || info.isComingSoon) continue;
    if (activeCourts.length === 0) continue;

    const hoursMap = parseHours(info?.storeHours);
    const rate = pickRentalType(rentalTypes);
    const pricePerHour = rate && rate.pricePerHour != null ? Number(rate.pricePerHour) : null;
    const municipality = hub.trackedCity || (info?.municipality || '').trim() || municipalityOf(info?.address || hub.address);
    const address = (info?.address || hub.address || '').trim();
    const coords = {
      lat: Number(info?.lat ?? info?.latitude ?? NaN),
      lng: Number(info?.long ?? info?.longitude ?? NaN)
    };

    verifiedVenues.push({ id: hub.id, name: hub.name, municipality, address,
      platform: '360 Sports', bookingUrl: `https://app.sports360.ph/sportshub/${hub.id}`,
      courtsTotal: new Set(activeCourts.map(c => String(c.courtNumber))).size,
      directoryVerified: true, checkedAt: new Date().toISOString() });
    let hubOpenings = 0;

    for (const date of dates) {
      const window = openWindow(hoursMap, date);
      if (!window) continue;

      const iso = isoDate(date);
      const bookings = await getJson(`/api/v2/court-bookings/public-calendar?storehubId=${hub.id}&sportsDay=${iso}`);
      if (!Array.isArray(bookings)) throw new Error(`Bookings unavailable for ${hub.name} on ${iso}; keeping previous feed`);
      const booked = bookings;

      const checkedAt = new Date().toISOString();
      const startTime = ALL_TIMES ? window.start : Math.max(window.start, 16 * 60);
      const endTime = ALL_TIMES ? window.end : Math.min(window.end, 22 * 60);
      const step = Array.isArray(rentalTypes) && rentalTypes.some(r =>
        /pickleball/i.test(r.sport || r.rentalType || '') && r.basePriceUnit === 'per 30 minutes') ? 30 : 60;
      // Use the same opening-time grid as the booking portal.
      const alignedStart = window.start + Math.ceil((startTime - window.start) / step) * step;
      for (let t = alignedStart; t + 120 <= endTime; t += step) {
        if (new Date(`${iso}T${pad(Math.floor(t / 60))}:${pad(t % 60)}:00+08:00`).getTime() <= Date.now()) continue;
        const freeCourts = freeCourtsForSession(activeCourts, booked, iso, t, 120);
        if (freeCourts.length === 0) continue;

        const from = `${pad(Math.floor((t % 1440) / 60))}:${pad(t % 60)}`;
        const to = `${pad(Math.floor(((t + 120) % 1440) / 60))}:${pad((t + 120) % 60)}`;
        const allFree = freeCourts.length === activeCourts.length;

        openings.push({
          id: `${hub.id}-${iso}-${from}`,
          venueName: hub.name,
          municipality,
          address,
          platform: '360 Sports',
          day: dayName(date),
          dateIso: iso,
          dateStr: shortDate(date),
          timeSlot: prettyRange(from, to),
          fromTime: from,
          endTime: to,
          priceAdvertised: pricePerHour != null ? `\u20b1${pricePerHour} / hr` : '',
          hourlyRate: pricePerHour,
          distanceKm: null,
          capacity: null,
          status: 'Available (2 hours)',
          durationMinutes: 120,
          checkedAt,
          availabilityVerified: true,
          favorite: false,
          bookingUrl: `https://app.sports360.ph/sportshub/${hub.id}`,
          environment: '',
          surface: '',
          amenities: [],
          courtsFree: freeCourts,
          courtsTotal: activeCourts.length,
          lat: Number.isFinite(coords.lat) ? coords.lat : null,
          lng: Number.isFinite(coords.lng) ? coords.lng : null
        });
        hubOpenings++;
      }
    }

    if (hubOpenings > 0) {
      hubSummaries.push({ id: hub.id, name: hub.name, municipality, address, pricePerHour, openings: hubOpenings });
    }
  }

  // Free hour slots first, then by date, then by time.
  openings.sort((a, b) =>
    a.dateIso.localeCompare(b.dateIso) ||
    (b.courtsFree.length - a.courtsFree.length) ||
    a.fromTime.localeCompare(b.fromTime)
  );

  const qualifiedOpenings = openings;
  const payload = {
    updatedAt: new Date().toISOString(),
    verificationVersion: 2,
    source: '360 Sports public court availability (app.sports360.ph)',
    daysAhead: DAYS_AHEAD,
    focus: ALL_TIMES ? 'All days / all hours' : 'Saturday and Sunday, 16:00–22:00 Asia/Manila',
    trackedVenues: TRACKED_VENUES.map(v => ({ city: v.city, matched: targets.filter(h => v.pattern.test(h.name)).map(h => h.name) })),
    hubsChecked: targets.length,
    verifiedVenues,
    venuesWithOpenings: new Set(qualifiedOpenings.map(s => s.bookingUrl)).size,
    minimumRentalHours: 2,
    openings: qualifiedOpenings
  };

  return payload;
}
