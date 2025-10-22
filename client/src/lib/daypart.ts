
export type DayPart =
  | "overnight"          // 12:00 AM - 4:59 AM
  | "morning"            // 5:00 AM - 11:59 AM
  | "late_morning_noon"  // 12:00 PM - 2:59 PM
  | "afternoon"          // 3:00 PM - 4:59 PM
  | "early_evening"      // 5:00 PM - 8:59 PM
  | "evening"            // 9:00 PM - 11:59 PM
  | "late_evening";      // (future use)

const LABELS: Record<DayPart, string> = {
  overnight: "overnight",
  morning: "morning",
  late_morning_noon: "late morning",
  afternoon: "afternoon",
  early_evening: "early evening",
  evening: "evening",
  late_evening: "late evening",
};

export function classifyDayPart(d: Date, tz?: string) {
  // Get hour in the specified timezone using proper Intl API
  let hour: number;
  if (tz) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    hour = parseInt(formatter.format(d));
  } else {
    hour = d.getHours();
  }

  let part: DayPart;

  // Non-overlapping ranges based on hour only (simpler and clearer)
  if (hour >= 0 && hour < 5) part = "overnight";           // 12:00 AM - 4:59 AM
  else if (hour >= 5 && hour < 12) part = "morning";       // 5:00 AM - 11:59 AM
  else if (hour >= 12 && hour < 15) part = "late_morning_noon"; // 12:00 PM - 2:59 PM
  else if (hour >= 15 && hour < 17) part = "afternoon";    // 3:00 PM - 4:59 PM
  else if (hour >= 17 && hour < 21) part = "early_evening"; // 5:00 PM - 8:59 PM
  else part = "evening";                                    // 9:00 PM - 11:59 PM

  return { key: part, label: LABELS[part] };
}

export function buildTimeContext(timeZone?: string) {
  const now = new Date();

  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
  });
  const dow = dayFormatter.format(now);
  const isWeekend = ["Saturday", "Sunday"].includes(dow);

  const part = classifyDayPart(now, timeZone);

  return {
    timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    dayOfWeek: dow,
    isWeekend,
    dayPartKey: part.key,
    dayPartLabel: part.label,
    // optional human display
    localTime: new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(now),
  };
}
