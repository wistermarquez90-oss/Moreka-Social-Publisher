export function calendarDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function nextUnoccupiedDate(occupiedDates: Iterable<string>, fromDate: Date, timeZone: string): string {
  const occupied = new Set(occupiedDates);
  const first = calendarDateKey(fromDate, timeZone);
  for (let offset = 0; offset < 367; offset += 1) {
    const candidate = addCalendarDays(first, offset);
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error("No hay un día libre dentro del próximo año.");
}
