export type EventCategory = 'shutdown' | 'crash' | 'hardware' | 'boot';
export type Severity = 'critical' | 'error' | 'warning' | 'info';

export interface TimelineEvent {
  id: string;
  timestamp: string; // ISO string
  category: EventCategory;
  severity: Severity;
  title: string;
  description: string;
  source: string;
  eventId?: number;
}

export interface RawSystemEvent {
  timestamp: string;
  eventId: number;
  level: string;
  message: string;
  source: string;
}

export interface EventQueryResult {
  systemEvents: RawSystemEvent[] | null;
  wheaEvents: RawSystemEvent[] | null;
}
