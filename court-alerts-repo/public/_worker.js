import { VENUES, scrapeVenue } from './_scraper.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

export async function handle(request, env, ctx, scrape = scrapeVenue, cache = globalThis.caches?.default) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (url.pathname !== '/api/venue') return json({ error: 'Not found' }, 404);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const id = url.searchParams.get('hub');
  if (!VENUES.some(venue => venue.id === id)) return json({ error: 'Unknown venue' }, 400);
  // Only a fixed venue list is accepted. Query strings cannot bypass the two-minute cache.
  const cacheUrl = new URL('/api/venue', url.origin);
  cacheUrl.searchParams.set('hub', id);
  const cacheKey = new Request(cacheUrl.href);
  try {
    const cached = await cache?.match(cacheKey);
    if (cached) return json(await cached.json());
    const feed = await scrape(id);
    if (feed.verificationVersion !== 2 || !Array.isArray(feed.openings)) throw new Error('Unverified feed');
    const response = json(feed);
    if (cache) {
      const stored = new Response(response.clone().body, { headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120'
      }});
      ctx.waitUntil(cache.put(cacheKey, stored).catch(() => {}));
    }
    return response;
  } catch {
    // Failed or malformed calendars never become empty calendars or cached availability.
    return json({ error: 'Live booking provider is unavailable. Please try Check now again shortly.' }, 503);
  }
}

export default { fetch: handle };
