/** Same units as the rest of the web app: binary steps, one decimal for gigabytes. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB';
  if (bytes >= 1024 ** 2) return Math.round(bytes / 1024 ** 2) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

export function effortCount(seconds: number): { key: 'effortSec' | 'effortMin'; count: number } {
  if (seconds >= 60) return { key: 'effortMin', count: Math.max(1, Math.round(seconds / 60)) };
  return { key: 'effortSec', count: Math.max(0, Math.round(seconds)) };
}
