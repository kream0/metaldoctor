import { querySystemEvents, queryHardwareErrors } from './events';
import type { TimelineEvent } from '../types/events';

export async function buildTimeline(): Promise<TimelineEvent[]> {
  const [systemEvents, hardwareEvents] = await Promise.all([
    querySystemEvents(),
    queryHardwareErrors(),
  ]);

  const allEvents = [...systemEvents, ...hardwareEvents];

  // Sort by timestamp descending (newest first)
  allEvents.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return allEvents;
}
