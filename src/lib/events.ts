import { runPowerShell } from './powershell';
import type { TimelineEvent, EventCategory, Severity, EventQueryResult, RawSystemEvent } from '../types/events';

const EVENT_MAP: Record<number, { category: EventCategory; title: string; severity: Severity }> = {
  1074: { category: 'shutdown', title: 'User-Initiated Shutdown', severity: 'info' },
  6005: { category: 'boot', title: 'System Boot', severity: 'info' },
  6006: { category: 'shutdown', title: 'Clean Shutdown', severity: 'info' },
  6008: { category: 'crash', title: 'Unexpected Shutdown', severity: 'error' },
  41: { category: 'crash', title: 'Kernel-Power Critical', severity: 'critical' },
  1001: { category: 'crash', title: 'Bugcheck (BSOD)', severity: 'critical' },
};

export async function querySystemEvents(): Promise<TimelineEvent[]> {
  const script = `
    $events = @()

    # System events (shutdown, crash, boot)
    $sysEvents = Get-WinEvent -FilterHashtable @{
      LogName='System'
      ID=1074,6005,6006,6008,41,1001
    } -MaxEvents 100 -ErrorAction SilentlyContinue

    if ($sysEvents) {
      $events += $sysEvents | ForEach-Object {
        @{
          timestamp = $_.TimeCreated.ToString('o')
          eventId = $_.Id
          level = $_.LevelDisplayName
          message = $_.Message
          source = $_.ProviderName
        }
      }
    }

    @{ systemEvents = @($events) } | ConvertTo-Json -Depth 4 -Compress
  `;

  const result = await runPowerShell<{ systemEvents: RawSystemEvent[] | null }>(script);
  return normalizeSystemEvents(result.systemEvents || []);
}

export async function queryHardwareErrors(): Promise<TimelineEvent[]> {
  const script = `
    $whea = @()

    $wheaEvents = Get-WinEvent -FilterHashtable @{
      LogName='System'
      ProviderName='Microsoft-Windows-WHEA-Logger'
    } -MaxEvents 50 -ErrorAction SilentlyContinue

    if ($wheaEvents) {
      $whea += $wheaEvents | ForEach-Object {
        @{
          timestamp = $_.TimeCreated.ToString('o')
          eventId = $_.Id
          level = $_.LevelDisplayName
          message = $_.Message
          source = 'WHEA-Logger'
        }
      }
    }

    @{ wheaEvents = @($whea) } | ConvertTo-Json -Depth 4 -Compress
  `;

  const result = await runPowerShell<{ wheaEvents: RawSystemEvent[] | null }>(script);
  return normalizeHardwareEvents(result.wheaEvents || []);
}

function normalizeSystemEvents(events: RawSystemEvent[]): TimelineEvent[] {
  return events.map((raw) => {
    const mapping = EVENT_MAP[raw.eventId] || {
      category: 'shutdown' as EventCategory,
      title: `Event ${raw.eventId}`,
      severity: mapLevelToSeverity(raw.level),
    };

    return {
      id: `sys-${raw.eventId}-${raw.timestamp}`,
      timestamp: raw.timestamp,
      category: mapping.category,
      severity: mapping.severity,
      title: mapping.title,
      description: truncateMessage(raw.message),
      source: raw.source,
      eventId: raw.eventId,
    };
  });
}

function normalizeHardwareEvents(events: RawSystemEvent[]): TimelineEvent[] {
  return events.map((raw) => ({
    id: `whea-${raw.eventId}-${raw.timestamp}`,
    timestamp: raw.timestamp,
    category: 'hardware' as EventCategory,
    severity: 'critical' as Severity,
    title: 'Hardware Error (MCE)',
    description: truncateMessage(raw.message),
    source: raw.source,
    eventId: raw.eventId,
  }));
}

function mapLevelToSeverity(level: string): Severity {
  switch (level?.toLowerCase()) {
    case 'critical': return 'critical';
    case 'error': return 'error';
    case 'warning': return 'warning';
    default: return 'info';
  }
}

function truncateMessage(message: string | null | undefined): string {
  if (!message) return '';
  return message.length > 300 ? message.slice(0, 300) + '...' : message;
}
