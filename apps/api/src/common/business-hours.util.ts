// Business hours are Mon-Fri 09:00-18:00 IST, excluding holidays (CLAUDE.md rule 4).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const BH_START_HOUR = 9;
const BH_END_HOUR = 18;

function isBusinessMinute(cursor: Date, holidays: Set<string>): boolean {
  const istDate = new Date(cursor.getTime() + IST_OFFSET_MS);
  const dayOfWeek = istDate.getUTCDay();
  const hour = istDate.getUTCHours();
  const dateKey = istDate.toISOString().slice(0, 10);
  return (
    dayOfWeek >= 1 &&
    dayOfWeek <= 5 &&
    hour >= BH_START_HOUR &&
    hour < BH_END_HOUR &&
    !holidays.has(dateKey)
  );
}

export function businessMinutesBetween(start: Date, end: Date, holidays: Set<string>): number {
  let minutes = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    if (isBusinessMinute(cursor, holidays)) minutes += 1;
    cursor.setTime(cursor.getTime() + 60_000);
  }
  return minutes;
}

export function addBusinessMinutes(start: Date, minutesToAdd: number, holidays: Set<string>): Date {
  let remaining = minutesToAdd;
  const cursor = new Date(start);
  while (remaining > 0) {
    cursor.setTime(cursor.getTime() + 60_000);
    if (isBusinessMinute(cursor, holidays)) remaining -= 1;
  }
  return cursor;
}
