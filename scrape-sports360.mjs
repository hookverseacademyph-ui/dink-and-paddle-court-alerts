#!/usr/bin/env node
/**
 * 360 Sports court availability scraper
 * ------------------------------------
 * Reads the PUBLIC booking area of app.sports360.ph (no login, no password stored)
 * and writes openings.json next to this file. The court finder app loads that file.
 *
 * How to run (Windows PowerShell, inside this folder):
 *     node scrape-sports360.mjs
 *
 * Useful options:
 *     node scrape-sports360.mjs --days 14          # look 14 days ahead (default 7)
 *     node scrape-sports360.mjs --all              # every hub in the country
 *                                                  # (default: Bacoor, Imus, Kawit only)
 *     node scrape-sports360.mjs --hub <hub-id>     # one hub only (repeatable)
 *     node scrape-sports360.mjs --out C:\path\openings.json
 *
 * The site is read politely: one request at a time, a short pause between them,
 * and only the public endpoints their own booking page uses.
 */

import { activePickleballCourts, freeCourtsForSession } from './live-availability.mjs';
import { writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://app.sports360.ph';

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
}
const DAYS_AHEAD = Number(flag('days') || 7);
const ALL_TIMES = argv.includes('--all-times');
const TRACKED_VENUES = [
  { pattern: /pickle\s*prime|courthaus|issy\s*dink/i, city: 'Bacoor' },
  { pattern: /garahe/i, city: 'Imus' }
];
const ALL_HUBS = argv.includes('--all');
const OUT_FILE = path.resolve(HERE, flag('out') || 'openings.json');
const ONLY_HUBS = argv.reduce((acc, arg, i) => {
  if (arg === '--hub' && argv[i + 1]) acc.push(argv[i + 1]);
  return acc;
}, []);

// Only these places are scraped (used when --all is not given).
// Add a city here to widen the list, e.g. 'Dasmariñas', 'General Trias', 'Silang'.
const TARGET_CITIES = ['Bacoor', 'Imus', 'Kawit'];
const AREA_PATTERN = new RegExp(TARGET_CITIES.join('|'), 'i');

const CITY_NAMES = [
  'Bacoor', 'Imus', 'Dasmariñas', 'Dasmarinas', 'General Trias', 'Kawit', 'Noveleta',
  'Rosario', 'Tanza', 'Trece Martires', 'Silang', 'Carmona', 'Amadeo', 'Indang', 'Naic',
  'Ternate', 'Maragondon', 'Alfonso', 'Mendez', 'Magallanes', 'Tagaytay', 'Cavite City'
];

// The site sits behind Cloudflare, which turns away Node's own fetch but answers
// curl normally. curl ships with Windows 10/11 and macOS, so it is the transport.
const CURL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function curlText(url) {
  const args = [
    '-s', '--compressed', '--max-time', '45',
    '-A', CURL_UA,
    '-H', 'Accept: application/json',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    '-w', '\n%{http_code}',
    url
  ];
  if (process.platform === 'win32') args.unshift('-sS');
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  const cut = stdout.lastIndexOf('\n');
  const body = stdout.slice(0, cut);
  const status = Number(stdout.slice(cut + 1).trim());
  return { status, body };
}

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(urlPath, attempt = 1) {
  await sleep(180);
  let status = 0;
  let body = '';
  try {
    ({ status, body } = await curlText(BASE + urlPath));
  } catch (err) {
    if (attempt < 3) {
      await sleep(900 * attempt);
      return getJson(urlPath, attempt + 1);
    }
    throw new Error(`${urlPath} could not be reached (${err.message.split('\n')[0]}). Is curl available?`);
  }
  if (status === 429 || status >= 500) {
    if (attempt < 3) {
      await sleep(1200 * attempt);
      return getJson(urlPath, attempt + 1);
    }
    throw new Error(`${urlPath} returned ${status}`);
  }
  if (status < 200 || status >= 300) return null; // 404 = this hub has nothing there
  if (!body || body.trim().startsWith('<')) return null; // got the HTML shell, not data
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
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

// ---------------------------------------------------------------- main
async function main() {
  console.log('Reading the 360 Sports public venue list...');
  const hubs = await getJson('/api/public/sportshubs');
  if (!Array.isArray(hubs)) throw new Error('Could not read the venue list from app.sports360.ph');

  let targets = hubs
    .map((h) => ({
      id: h.hubId,
      name: (h.sportsHubName || '').trim(),
      address: (h.address || '').trim(),
      trackedCity: TRACKED_VENUES.find(v => v.pattern.test(h.sportsHubName || ''))?.city || ''
    }))
    .filter((h) => h.id && h.name);

  if (ONLY_HUBS.length) {
    targets = targets.filter((h) => ONLY_HUBS.includes(h.id));
  } else if (!ALL_HUBS) {
    targets = targets.filter((h) => AREA_PATTERN.test(h.address) || h.trackedCity);
  }

  console.log(`${targets.length} venue(s) to check${ALL_HUBS ? ' (whole country)' : ` (${TARGET_CITIES.join(', ')})`}.`);

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
    if (checked % 5 === 0) console.log(`  ...${checked}/${targets.length} venues`);

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

  await writeFile(OUT_FILE + '.tmp', JSON.stringify(payload, null, 2), 'utf8');
  await rename(OUT_FILE + '.tmp', OUT_FILE);

  console.log('');
  console.log(`Done. ${qualifiedOpenings.length} two-hour opening(s) from ${hubSummaries.length} venue(s).`);
  console.log(`Written to: ${OUT_FILE}`);
  const cheapest = hubSummaries.filter((h) => h.pricePerHour).slice(0, 5);
  if (cheapest.length) {
    console.log('Venues seen (first five with a price):');
    cheapest.forEach((h) => console.log(`  - ${h.name} | ${h.municipality || 'Cavite'} | \u20b1${h.pricePerHour}/hr | ${h.openings} slot(s)`));
  }
}

main().catch((err) => {
  console.error('');
  console.error('Scrape failed:', err.message);
  console.error('Nothing was overwritten. Check your internet connection and try again.');
  process.exitCode = 1;
});
