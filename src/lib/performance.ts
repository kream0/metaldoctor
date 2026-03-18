import { runPowerShell } from './powershell';

export interface StabilityPoint {
  timestamp: string;
  stabilityIndex: number; // 1-10 scale
}

export interface ResourceEvent {
  timestamp: string;
  type: 'memory_low' | 'commit_limit' | 'resource_exhaustion';
  message: string;
}

export interface HistoricalData {
  stability: StabilityPoint[];
  resourceEvents: ResourceEvent[];
}

// Query Windows Reliability Stability Metrics (historical stability index)
export async function getStabilityHistory(): Promise<StabilityPoint[]> {
  const script = `
    $metrics = Get-CimInstance -ClassName Win32_ReliabilityStabilityMetrics -ErrorAction SilentlyContinue |
      Sort-Object TimeGenerated |
      Select-Object -Last 100 |
      ForEach-Object {
        @{
          timestamp = $_.TimeGenerated.ToString('o')
          stabilityIndex = [math]::Round($_.SystemStabilityIndex, 1)
        }
      }

    @($metrics) | ConvertTo-Json -Compress
  `;

  try {
    const result = await runPowerShell<StabilityPoint[] | null>(script);
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

// Query resource exhaustion and memory events
export async function getResourceEvents(): Promise<ResourceEvent[]> {
  const script = `
    $events = @()

    # Resource Exhaustion Detector (low memory warnings)
    $resExhaust = Get-WinEvent -FilterHashtable @{
      LogName='System'
      ProviderName='Resource-Exhaustion-Detector'
    } -MaxEvents 50 -ErrorAction SilentlyContinue

    if ($resExhaust) {
      $events += $resExhaust | ForEach-Object {
        @{
          timestamp = $_.TimeCreated.ToString('o')
          type = 'resource_exhaustion'
          message = $_.Message
        }
      }
    }

    # Memory Manager events (commit limit, low memory)
    $memMgr = Get-WinEvent -FilterHashtable @{
      LogName='System'
      ProviderName='Microsoft-Windows-Resource-Exhaustion-Detector'
    } -MaxEvents 50 -ErrorAction SilentlyContinue

    if ($memMgr) {
      $events += $memMgr | ForEach-Object {
        @{
          timestamp = $_.TimeCreated.ToString('o')
          type = 'memory_low'
          message = $_.Message
        }
      }
    }

    # Kernel memory events
    $kernelMem = Get-WinEvent -FilterHashtable @{
      LogName='System'
      ID=2004
    } -MaxEvents 30 -ErrorAction SilentlyContinue

    if ($kernelMem) {
      $events += $kernelMem | ForEach-Object {
        @{
          timestamp = $_.TimeCreated.ToString('o')
          type = 'commit_limit'
          message = $_.Message
        }
      }
    }

    @($events) | ConvertTo-Json -Compress
  `;

  try {
    const result = await runPowerShell<ResourceEvent[] | null>(script);
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

// Get all historical data
export async function getHistoricalData(): Promise<HistoricalData> {
  const [stability, resourceEvents] = await Promise.all([
    getStabilityHistory(),
    getResourceEvents(),
  ]);

  return { stability, resourceEvents };
}
