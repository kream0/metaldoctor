export async function runPowerShell<T>(script: string): Promise<T> {
  const proc = Bun.spawn([
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " + script
  ], {
    stdout: "pipe",
    stderr: "pipe"
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0 && stderr.trim()) {
    throw new Error(`PowerShell error: ${stderr}`);
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return {} as T;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`Failed to parse PowerShell JSON output: ${trimmed.slice(0, 200)}`);
  }
}
