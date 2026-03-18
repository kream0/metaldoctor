import { buildTimeline } from './lib/timeline';
import { getHistoricalData } from './lib/performance';
import { saveEvents, saveStability, getStoredEvents, getStoredStability, hasData } from './lib/db';

const PUBLIC_DIR = './public';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

// Cache timestamps
let lastEventSync = 0;
let lastStabilitySync = 0;
const CACHE_TTL = 60000; // 1 minute

async function getEvents(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && hasData() && now - lastEventSync < CACHE_TTL) {
    return getStoredEvents();
  }

  // Fetch fresh from Windows
  const events = await buildTimeline();
  saveEvents(events);
  lastEventSync = now;
  return events;
}

async function getStability(forceRefresh = false) {
  const now = Date.now();
  const stored = getStoredStability();
  if (!forceRefresh && stored.length > 0 && now - lastStabilitySync < CACHE_TTL) {
    return stored;
  }

  // Fetch fresh from Windows
  const historical = await getHistoricalData();
  saveStability(historical.stability);
  lastStabilitySync = now;
  return historical.stability;
}

const server = Bun.serve({
  port: 3000,

  async fetch(req) {
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get('refresh') === '1';

    // API: Timeline data
    if (url.pathname === '/api/timeline') {
      try {
        const events = await getEvents(forceRefresh);
        return Response.json(events);
      } catch (error) {
        console.error('Timeline error:', error);
        return Response.json(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          { status: 500 }
        );
      }
    }

    // API: Historical stability + events combined
    if (url.pathname === '/api/history') {
      try {
        const [stability, events] = await Promise.all([
          getStability(forceRefresh),
          getEvents(forceRefresh),
        ]);
        return Response.json({ stability, events, resourceEvents: [] });
      } catch (error) {
        console.error('History error:', error);
        return Response.json(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          { status: 500 }
        );
      }
    }

    // Static files
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    const fullPath = `${PUBLIC_DIR}${filePath}`;
    const file = Bun.file(fullPath);

    if (await file.exists()) {
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      return new Response(file, {
        headers: { 'Content-Type': contentType },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`
╔══════════════════════════════════════╗
║         MetalDoctor v1.0             ║
║   Windows Event Timeline Viewer      ║
╠══════════════════════════════════════╣
║   http://localhost:${server.port}               ║
║   SQLite: metaldoctor.db             ║
╚══════════════════════════════════════╝
`);
