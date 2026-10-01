// 330 -> "5:30"
export function formatPace(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = String(secondsPerKm % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function labelFor(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

// "14:05" today, "Yesterday", "Mon" this week, otherwise "12 Sep"
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  if (d >= startOfToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (d >= new Date(startOfToday.getTime() - dayMs)) return "Yesterday";
  if (d >= new Date(startOfToday.getTime() - 6 * dayMs)) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// "Sat 27 Sep, 07:00"
export function formatRunTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${formatClock(iso)}`;
}

// A local date and "HH:MM" as an ISO string with this device's UTC offset, e.g. 2026-09-27T07:00:00+02:00
export function toIsoWithOffset(day: Date, time: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  if (hours > 23 || minutes > 59) return null;
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hours)}:${pad(minutes)}:00` +
    `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Sat 3 Oct", or "Sat 3 – Sun 4 Oct" for multi-day races. Dates are YYYY-MM-DD calendar
// dates, read without a timezone so they never shift by a day.
export function formatRaceDates(startsOn: string, endsOn: string): string {
  const parse = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day);
  };
  const start = parse(startsOn);
  // Built by hand: toLocaleDateString's order varies by device locale ("Sat, Oct 3", "2 Fri")
  const fmt = (d: Date, withMonth: boolean) =>
    `${WEEKDAYS[d.getDay()]} ${d.getDate()}${withMonth ? ` ${MONTHS[d.getMonth()]}` : ""}`;
  if (startsOn === endsOn) return fmt(start, true);
  const end = parse(endsOn);
  return `${fmt(start, start.getMonth() !== end.getMonth())} – ${fmt(end, true)}`;
}

export function formatDistance(km: number): string {
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

// "Sat 05:30", in the device's local time
export function formatDayTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { weekday: "short" })} ${formatClock(iso)}`;
}

// How soon a race is, from its start and end dates (YYYY-MM-DD): "Today", "Tomorrow",
// "In 5 days", "In 3 weeks". Multi-day races already under way say "On now".
export function formatCountdown(startsOn: string, endsOn: string, now = new Date()): string {
  const day = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Round: daylight saving shifts can make a day 23 or 25 hours
  const days = Math.round((day(startsOn) - today) / 86_400_000);
  if (days < 0) return day(endsOn) >= today ? "On now" : "Finished";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}
