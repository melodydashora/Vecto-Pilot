// client/src/pages/co-pilot/SchedulePage.tsx
// Weekly driving schedule with visual calendar, shift preferences, and AI recommendations.
//
// 2026-04-05: Built to replace placeholder. Saves to localStorage, no backend needed.
// Mobile-first layout with purple/blue design language.

import { useState, useEffect, useCallback, useContext } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar, Sparkles, Clock, RotateCcw } from 'lucide-react';
import { LocationContext } from '@/contexts/location-context-clean';
import { STORAGE_KEYS } from '@/constants/storageKeys';

// ─── Types & constants ────────────────────────────────────────────────────

type ShiftId = 'morning' | 'afternoon' | 'evening' | 'latenight';
type DayId = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type ScheduleData = Record<DayId, ShiftId[]>;

interface ShiftDef {
  id: ShiftId;
  label: string;
  hours: string;
  emoji: string;
  hoursCount: number;
}

const SHIFTS: ShiftDef[] = [
  { id: 'morning',   label: 'Morning',    hours: '6–12',  emoji: '\u{1F305}', hoursCount: 6 },
  { id: 'afternoon', label: 'Afternoon',  hours: '12–17', emoji: '\u{2600}\u{FE0F}', hoursCount: 5 },
  { id: 'evening',   label: 'Evening',    hours: '17–22', emoji: '\u{1F306}', hoursCount: 5 },
  { id: 'latenight', label: 'Late Night', hours: '22–4',  emoji: '\u{1F319}', hoursCount: 6 },
];

const DAYS: { id: DayId; label: string; short: string }[] = [
  { id: 'mon', label: 'Monday',    short: 'Mon' },
  { id: 'tue', label: 'Tuesday',   short: 'Tue' },
  { id: 'wed', label: 'Wednesday', short: 'Wed' },
  { id: 'thu', label: 'Thursday',  short: 'Thu' },
  { id: 'fri', label: 'Friday',    short: 'Fri' },
  { id: 'sat', label: 'Saturday',  short: 'Sat' },
  { id: 'sun', label: 'Sunday',    short: 'Sun' },
];

const EMPTY_SCHEDULE: ScheduleData = {
  mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [],
};

// ─── Persistence ──────────────────────────────────────────────────────────

function loadSchedule(): ScheduleData {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SCHEDULE);
    if (raw) {
      const parsed = JSON.parse(raw) as ScheduleData;
      // Validate structure
      if (parsed && typeof parsed === 'object' && 'mon' in parsed) return parsed;
    }
  } catch { /* corrupt data — start fresh */ }
  return { ...EMPTY_SCHEDULE };
}

function saveSchedule(data: ScheduleData) {
  localStorage.setItem(STORAGE_KEYS.SCHEDULE, JSON.stringify(data));
}

// ─── Presets ──────────────────────────────────────────────────────────────

const PRESETS: { label: string; emoji: string; schedule: ScheduleData }[] = [
  {
    label: 'Evenings Only',
    emoji: '\u{1F306}',
    schedule: {
      mon: ['evening'], tue: ['evening'], wed: ['evening'],
      thu: ['evening'], fri: ['evening', 'latenight'],
      sat: ['evening', 'latenight'], sun: [],
    },
  },
  {
    label: 'Weekend Warrior',
    emoji: '\u{1F389}',
    schedule: {
      mon: [], tue: [], wed: [],
      thu: ['evening'], fri: ['evening', 'latenight'],
      sat: ['afternoon', 'evening', 'latenight'], sun: ['morning', 'afternoon'],
    },
  },
  {
    label: 'Full Time',
    emoji: '\u{1F4AA}',
    schedule: {
      mon: ['morning', 'afternoon', 'evening', 'latenight'],
      tue: ['morning', 'afternoon', 'evening', 'latenight'],
      wed: ['morning', 'afternoon', 'evening', 'latenight'],
      thu: ['morning', 'afternoon', 'evening', 'latenight'],
      fri: ['morning', 'afternoon', 'evening', 'latenight'],
      sat: ['morning', 'afternoon', 'evening', 'latenight'],
      sun: ['morning', 'afternoon', 'evening', 'latenight'],
    },
  },
  {
    label: 'Day Shift',
    emoji: '\u{2600}\u{FE0F}',
    schedule: {
      mon: ['morning', 'afternoon'], tue: ['morning', 'afternoon'],
      wed: ['morning', 'afternoon'], thu: ['morning', 'afternoon'],
      fri: ['morning', 'afternoon'], sat: [], sun: [],
    },
  },
];

// ─── Component ────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [schedule, setSchedule] = useState<ScheduleData>(loadSchedule);
  const locationCtx = useContext(LocationContext);
  const cityName = locationCtx?.city;

  // Persist on every change
  useEffect(() => {
    saveSchedule(schedule);
  }, [schedule]);

  const toggleCell = useCallback((day: DayId, shift: ShiftId) => {
    setSchedule(prev => {
      const dayShifts = prev[day];
      const has = dayShifts.includes(shift);
      return {
        ...prev,
        [day]: has ? dayShifts.filter(s => s !== shift) : [...dayShifts, shift],
      };
    });
  }, []);

  const clearSchedule = useCallback(() => {
    setSchedule({ ...EMPTY_SCHEDULE });
  }, []);

  // Summary stats
  const totalShifts = DAYS.reduce((sum, d) => sum + schedule[d.id].length, 0);
  const totalHours = DAYS.reduce(
    (sum, d) => sum + schedule[d.id].reduce((h, s) => h + (SHIFTS.find(x => x.id === s)?.hoursCount ?? 0), 0),
    0,
  );

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-24 space-y-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-full text-sm font-medium">
          <Calendar className="w-4 h-4" />
          My Driving Schedule
        </div>
        <p className="text-sm text-muted-foreground">
          Tap cells to mark when you plan to drive. Saves automatically.
        </p>
      </div>

      {/* ─── Schedule Grid ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          {/* Day column headers */}
          <div className="grid grid-cols-[80px_repeat(7,1fr)] sm:grid-cols-[96px_repeat(7,1fr)] gap-1 mb-1">
            <div /> {/* spacer for shift label column */}
            {DAYS.map(day => (
              <div key={day.id} className="text-center text-[11px] sm:text-xs font-semibold text-gray-500 py-1">
                {day.short}
              </div>
            ))}
          </div>

          {/* Shift rows */}
          {SHIFTS.map(shift => (
            <div
              key={shift.id}
              className="grid grid-cols-[80px_repeat(7,1fr)] sm:grid-cols-[96px_repeat(7,1fr)] gap-1 mb-1"
            >
              {/* Shift label */}
              <div className="flex items-center gap-1.5 pr-1">
                <span className="text-sm leading-none">{shift.emoji}</span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-800 truncate">{shift.label}</div>
                  <div className="text-[10px] text-gray-400">{shift.hours}</div>
                </div>
              </div>

              {/* Day cells */}
              {DAYS.map(day => {
                const isActive = schedule[day.id].includes(shift.id);
                return (
                  <button
                    key={`${day.id}-${shift.id}`}
                    onClick={() => toggleCell(day.id, shift.id)}
                    className={`h-10 sm:h-11 rounded-md border-2 transition-all text-xs font-bold ${
                      isActive
                        ? 'bg-gradient-to-br from-purple-600 to-blue-600 border-purple-500 text-white shadow-sm'
                        : 'bg-gray-50 border-gray-200 text-gray-300 hover:border-purple-300 hover:bg-purple-50'
                    }`}
                    aria-label={`${shift.label} ${day.label}: ${isActive ? 'scheduled' : 'off'}`}
                  >
                    {isActive ? '\u2713' : ''}
                  </button>
                );
              })}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ─── Summary bar ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-purple-600" />
            <strong>{totalShifts}</strong> shifts
          </span>
          <span className="text-muted-foreground">~{totalHours} hrs/week</span>
        </div>
        {totalShifts > 0 && (
          <Button variant="outline" size="sm" onClick={clearSchedule} className="text-xs gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* ─── Quick Presets ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Quick Presets</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          {PRESETS.map(p => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              className="text-xs h-auto py-2 justify-start gap-1.5"
              onClick={() => setSchedule({ ...p.schedule })}
            >
              <span>{p.emoji}</span> {p.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* ─── AI Recommendations ────────────────────────────────────────── */}
      <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            AI-Optimised Time Recommendations
          </CardTitle>
          {cityName && (
            <p className="text-xs text-muted-foreground mt-1">
              Based on general rideshare demand patterns{cityName ? ` near ${cityName}` : ''}.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-700">
          {!cityName && (
            <p className="text-xs text-muted-foreground">
              Enable location for market-specific insights. Showing general patterns below.
            </p>
          )}
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold shrink-0">{'\u2022'}</span>
              <span><strong>Friday & Saturday evenings</strong> — Consistently the highest demand. Nightlife, dining, and events drive ride requests.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold shrink-0">{'\u2022'}</span>
              <span><strong>Late night (Fri–Sat)</strong> — Last-call surges create premium pricing. Position near entertainment districts.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold shrink-0">{'\u2022'}</span>
              <span><strong>Weekday mornings & evenings</strong> — Commuter demand provides steady, predictable rides during rush hours.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold shrink-0">{'\u2022'}</span>
              <span><strong>Sunday mornings</strong> — Airport runs and brunch demand. Often less competition from other drivers.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold shrink-0">{'\u2022'}</span>
              <span><strong>Event days</strong> — Check the Briefing tab for concerts, sports, and festivals. Events can double normal demand.</span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground italic pt-1">
            Tip: Use the Strategy tab while driving for real-time, location-specific recommendations.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
