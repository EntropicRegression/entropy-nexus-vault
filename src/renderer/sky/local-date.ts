/**
 * Archive times arrive either as ISO timestamps (archive front matter, UTC) or as already readable local text such as
 * "2026-11-21 08:00". ISO is shown in local time; anything else is shown as it is.
 */
export function localDate(value: string, withTime = false): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (number: number) => String(number).padStart(2, '0');
  const day = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  return withTime ? day + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) : day;
}
