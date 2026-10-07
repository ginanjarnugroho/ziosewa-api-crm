/**
 * Utility functions for time and datetime parsing.
 */

/**
 * Extracts "HH:mm" time string from a time string, datetime string, Date object, or timestamp.
 * Examples:
 * - "2026-10-07T20:00:00.000Z" -> "20:00"
 * - "2026-10-07 08:30:00" -> "08:30"
 * - "20:00" -> "20:00"
 * - "8:00" -> "08:00"
 * - "20:00:00" -> "20:00"
 * - new Date(...) -> "HH:mm"
 * - null / undefined / "" -> null
 */
export function extractTime(val: any): string | null {
  if (val === null || val === undefined) return null;

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const hours = String(val.getHours()).padStart(2, '0');
    const minutes = String(val.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  if (typeof val === 'number') {
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;

    // 1. Time only format: "20:00", "08:00", "8:00", "20:00:00"
    const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (timeMatch) {
      return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    }

    // 2. Datetime string with T or space: "2026-10-07T20:00:00.000Z", "2026-10-07 20:00"
    const dtMatch = trimmed.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (dtMatch) {
      return `${dtMatch[1].padStart(2, '0')}:${dtMatch[2]}`;
    }

    // 3. Fallback: try parsing with Date
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }
  }

  return null;
}
