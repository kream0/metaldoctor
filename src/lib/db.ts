import { Database } from 'bun:sqlite';
import type { TimelineEvent } from '../types/events';
import type { StabilityPoint } from './performance';

const DB_PATH = './metaldoctor.db';

const db = new Database(DB_PATH);

// Initialize tables
db.run(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    source TEXT,
    eventId INTEGER,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS stability (
    timestamp TEXT PRIMARY KEY,
    stabilityIndex REAL NOT NULL
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_events_category ON events(category)`);

// Prepared statements for speed
const insertEvent = db.prepare(`
  INSERT OR REPLACE INTO events (id, timestamp, category, severity, title, description, source, eventId)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertStability = db.prepare(`
  INSERT OR REPLACE INTO stability (timestamp, stabilityIndex)
  VALUES (?, ?)
`);

const selectEvents = db.prepare(`SELECT * FROM events ORDER BY timestamp DESC`);
const selectStability = db.prepare(`SELECT * FROM stability ORDER BY timestamp ASC`);
const countEvents = db.prepare(`SELECT COUNT(*) as count FROM events`);

export function saveEvents(events: TimelineEvent[]): void {
  const tx = db.transaction(() => {
    for (const e of events) {
      insertEvent.run(e.id, e.timestamp, e.category, e.severity, e.title, e.description || '', e.source, e.eventId || null);
    }
  });
  tx();
}

export function saveStability(points: StabilityPoint[]): void {
  const tx = db.transaction(() => {
    for (const p of points) {
      insertStability.run(p.timestamp, p.stabilityIndex);
    }
  });
  tx();
}

export function getStoredEvents(): TimelineEvent[] {
  return selectEvents.all() as TimelineEvent[];
}

export function getStoredStability(): StabilityPoint[] {
  return selectStability.all() as StabilityPoint[];
}

export function getEventCount(): number {
  const result = countEvents.get() as { count: number };
  return result.count;
}

export function hasData(): boolean {
  return getEventCount() > 0;
}
