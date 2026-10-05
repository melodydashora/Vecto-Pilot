import React, { useId, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plane, Loader, Sparkles, Clock, PlaneLanding, PlaneTakeoff, AlertTriangle, Cloud, ChevronUp, ChevronDown, ShieldCheck } from "lucide-react";

interface AirportDelay {
  status?: string;
  avgMinutes?: number | null;
}

function directionalDelayLabel(delay: AirportDelay, faaDisrupted: boolean): string {
  if (typeof delay.avgMinutes === 'number' && Number.isFinite(delay.avgMinutes) && delay.avgMinutes > 0) {
    return `~${delay.avgMinutes} min delay`;
  }
  const status = delay.status?.trim() ?? '';
  if (['none', 'normal', 'on time', 'on-time'].includes(status.toLowerCase())) {
    return faaDisrupted ? 'Status not confirmed' : 'On Time';
  }
  return status || 'Unknown';
}

// 2026-05-12 (D-108 step 2): TSA wait times per checkpoint type. Gemini returns
// "unreported" (string) when search results don't surface real-time TSA data, or
// when a checkpoint type isn't operational at the airport (small airports often
// lack TSA Clear). Render gracefully — show "—" for unreported, integer + "min"
// for numeric values.
interface TSALane {
  waitMinutes?: number | string;
  entryPoint?: string;
}

interface AirportTSA {
  general?: TSALane;
  preCheck?: TSALane;
  clear?: TSALane;
}

// 2026-07-06 (todo #22): per-terminal structure — terminals usually have
// MULTIPLE checkpoints (~2 each; Clear only at specific terminals, e.g. DFW E).
// best_entry is computed SERVER-side (min wait per lane type) — "knowing the
// best entry point is one of the best pieces of information to give" (Melody).
interface Checkpoint {
  name?: string;
  lanes?: { general?: number | string; preCheck?: number | string; clear?: number | string };
}

interface TerminalInfo {
  terminal: string;
  arrivalsActivity?: string;
  ridesharePickup?: string;
  checkpoints?: Checkpoint[];
}

interface BestEntryLane {
  terminal: string;
  checkpoint?: string | null;
  waitMinutes: number;
}

interface Airport {
  code: string;
  name: string;
  conditionsSource?: 'faa' | 'gemini-search';
  overallStatus?: 'normal' | 'delays' | 'severe_delays';
  status?: 'normal' | 'delays' | 'severe_delays' | string;
  delays?: string;
  avgDelayMinutes?: number;
  arrivalDelays?: AirportDelay;
  departureDelays?: AirportDelay;
  busyTimes?: string[];
  weather?: string;
  groundStops?: boolean;
  tipsForDrivers?: string;
  tsa?: AirportTSA; // legacy shape (pre-2026-07-06 briefing rows)
  distance_miles?: number;
  terminals?: TerminalInfo[];
  best_entry?: { general?: BestEntryLane; preCheck?: BestEntryLane; clear?: BestEntryLane };
  faa_delay_minutes?: number | null;
  faa_has_delays?: boolean | null;
  faa_ground_stops?: { reason?: string; end_time?: string | null }[];
  faa_delay_reason?: string | null;
  faa_closure_status?: string;
  faa_closure_start?: string | null;
  faa_closure_end?: string | null;
  faa_supported?: boolean | null;
  faa_source_updated_at?: string | null;
  faa_fetched_at?: string | null;
}

// FAA observations take precedence over optimistic model status. Unknown FAA
// coverage stays separate from independent airport research.
function getFAAStatus(airport: Airport) {
  const hasFAA = airport.faa_delay_minutes !== undefined || airport.faa_has_delays !== undefined ||
    airport.faa_closure_status !== undefined || airport.faa_supported !== undefined ||
    airport.faa_ground_stops !== undefined;
  if (!hasFAA) return null;
  if (airport.faa_ground_stops?.length || airport.faa_closure_status === 'ground-stop') {
    return { status: 'ground-stop', label: 'FAA: Ground stop', disrupted: true };
  }
  if (airport.faa_closure_status === 'restricted') {
    return { status: 'restricted', label: 'FAA: Restrictions reported', disrupted: true };
  }
  if (airport.faa_closure_status === 'closed') {
    return { status: 'closed', label: 'FAA: Closure reported', disrupted: true };
  }
  if (airport.faa_has_delays === true || (airport.faa_delay_minutes ?? 0) > 0) {
    return { status: 'delayed', label: 'FAA: Delays reported', disrupted: true };
  }
  if (airport.faa_supported === false) {
    return { status: 'unknown', label: 'FAA: Airport coverage unavailable', disrupted: false };
  }
  if (airport.faa_has_delays === false) {
    return { status: 'normal', label: 'FAA: No delays reported', disrupted: false };
  }
  return { status: 'unknown', label: 'FAA: Status unknown', disrupted: false };
}

type BusyPeriod = string | {
  time: string;
  airport: string;
  reason: string;
};

interface AirportConditions {
  airports?: Airport[];
  busyPeriods?: BusyPeriod[];
  recommendations?: string;
  fetchedAt?: string;
  isFallback?: boolean;
  provider?: string;
  reason?: string;
  error?: string;
  // 2026-08-06: server errorMarker writes _generationFailed INSIDE
  // airport_conditions; the wrapper-level flag is dropped by the real mount
  // path (co-pilot-context unwraps, BriefingPage rewraps without flags).
  _generationFailed?: boolean;
  _pending?: boolean;
  verifiedEmpty?: boolean;
}

interface AirportCardProps {
  // 2026-07-06 (todo #24): pending/failed/verified-empty are three states
  airportData?: { airport_conditions?: AirportConditions; _pending?: boolean; _generationFailed?: boolean };
  isAirportLoading: boolean;
}

export function AirportCard({ airportData, isAirportLoading }: AirportCardProps) {
  const [expandedAirport, setExpandedAirport] = useState(true);
  const contentId = useId();

  const airportConditions = airportData?.airport_conditions;
  // Failed ≠ empty: a provider failure or fallback object must never render
  // as "No nearby airports found" (the Dallas screenshot, todo #24)
  // 2026-08-06: also read the INNER flag — the server errorMarker writes
  // _generationFailed inside airport_conditions, and the wrapper-level flag is
  // dropped by the real mount path (co-pilot-context unwraps, BriefingPage
  // rewraps without flags), so DB failures rendered as "No nearby airports found".
  const airportFailed = !!airportData?._generationFailed || !!airportConditions?._generationFailed || !!airportConditions?.isFallback;
  const airportReason = [airportConditions?.reason, airportConditions?.error]
    .find(value => typeof value === 'string' && value.trim())?.trim() ?? null;
  const airportPending = !!airportData?._pending || !!airportConditions?._pending;
  const airports = airportConditions?.airports || [];
  const busyPeriods = airportConditions?.busyPeriods || [];
  const airportRecommendations = airportConditions?.recommendations;

  // 2026-08-06: map BOTH status vocabularies — legacy ('delays',
  // 'severe_delays') and current DB values ('normal', 'delayed', 'severe',
  // 'ground-stop', 'closed', 'unreported', 'unknown') plus free-form legacy
  // strings ('moderate delays', 'impacted', 'disrupted'). Unrecognized values
  // fall through to neutral gray "Unknown" — never a green "On Time" badge.
  const getAirportStatusColor = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s === 'normal') return 'bg-green-100 text-green-700 border-green-300';
    if (s === 'severe_delays' || s === 'severe' || s === 'closed' || s === 'ground-stop') return 'bg-red-100 text-red-700 border-red-300';
    if (s === 'restricted' || s === 'delays' || s === 'delayed' || s.includes('delay') || s.includes('impacted') || s.includes('disrupted')) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    return 'bg-gray-100 text-gray-700 border-gray-300';
  };

  const getAirportStatusLabel = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s === 'normal') return 'On Time';
    if (s === 'severe_delays' || s === 'severe') return 'Severe Delays';
    if (s === 'closed') return 'Closed';
    if (s === 'ground-stop') return 'Ground Stop';
    if (s === 'restricted') return 'Restrictions';
    if (s === 'delays' || s === 'delayed' || s.includes('delay') || s.includes('impacted') || s.includes('disrupted')) return 'Delays';
    return 'Unknown';
  };

  return (
    <Card className="bg-gradient-to-r from-sky-50 to-cyan-50 border-sky-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded text-left hover:bg-sky-100/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-expanded={expandedAirport}
            aria-controls={contentId}
            onClick={() => setExpandedAirport(expanded => !expanded)}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              {!airportData ? (
                <Loader aria-hidden="true" className="w-5 h-5 shrink-0 animate-spin text-sky-600" />
              ) : (
                <Plane aria-hidden="true" className="w-5 h-5 shrink-0 text-sky-600" />
              )}
              <span>Airport Conditions</span>
              {airports.length > 0 && (
                <span className="rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-sky-100 text-sky-700 border-sky-300">
                  {airports.length} {airports.length === 1 ? 'airport' : 'airports'}
                </span>
              )}
            </span>
            {expandedAirport ? (
              <ChevronUp aria-hidden="true" className="w-5 h-5 shrink-0 text-sky-600" />
            ) : (
              <ChevronDown aria-hidden="true" className="w-5 h-5 shrink-0 text-sky-600" />
            )}
          </button>
        </CardTitle>
      </CardHeader>
      {expandedAirport && (
        <CardContent id={contentId}>
          {airportFailed && (
            <div role="alert" className="mb-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 break-words">
              <AlertTriangle aria-hidden="true" className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">Airport data couldn't be retrieved — {airportReason ?? 'the server did not provide a failure reason'}. Please come back later.</span>
            </div>
          )}
          {(isAirportLoading || airportPending) && !airportFailed ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-5 h-5 animate-spin text-sky-600 mr-2" />
              <span className="text-gray-600">Loading airport data...</span>
            </div>
          ) : airports.length > 0 ? (
            <div className="space-y-4">
              {/* AI Recommendations */}
              {airportRecommendations && (
                <div className="p-3 bg-gradient-to-r from-sky-100 to-cyan-100 rounded-lg border border-sky-200">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-sky-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-sky-800 font-medium">{airportRecommendations}</p>
                  </div>
                </div>
              )}

              {/* Airport Cards */}
              {airports.map((airport, idx) => {
                const researchedStatus = (airport.overallStatus || airport.status || 'unknown').trim().toLowerCase();
                const faaStatus = getFAAStatus(airport);
                const airportStatus = faaStatus?.disrupted ? faaStatus.status : researchedStatus;

                return (
                <div
                  key={idx}
                  className="p-4 bg-white/60 rounded-lg border border-sky-100 hover:border-sky-300 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="p-2 rounded-lg bg-sky-100 shrink-0">
                        <Plane className="w-5 h-5 text-sky-600" />
                      </div>
                      <div className="min-w-0 break-words">
                        <h4 className="font-semibold text-gray-900">{airport.code}</h4>
                        <p className="text-xs text-gray-500">{airport.name}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={getAirportStatusColor(airportStatus)}>
                      {getAirportStatusLabel(airportStatus)}
                    </Badge>
                  </div>

                  {faaStatus && (
                    <div className={`p-3 rounded-lg border mb-3 text-sm break-words [overflow-wrap:anywhere] ${getAirportStatusColor(faaStatus.status)}`}>
                      <p className="font-semibold">{faaStatus.label}</p>
                      {airport.faa_delay_reason && <p className="mt-1">{airport.faa_delay_reason}</p>}
                      {airport.faa_closure_status === 'restricted' && (
                        <p className="mt-1">Restrictions may apply to specific aircraft or operations; this does not mean the entire airport is closed.</p>
                      )}
                      {faaStatus.disrupted && (
                        <p className="mt-1">
                          {typeof airport.faa_delay_minutes === 'number' && Number.isFinite(airport.faa_delay_minutes) && airport.faa_delay_minutes > 0
                            ? `FAA reported delay: ${airport.faa_delay_minutes} min`
                            : 'Delay duration not reported.'}
                        </p>
                      )}
                      {airport.faa_ground_stops?.map((stop, stopIndex) => (
                        <p key={stopIndex} className="mt-1">
                          Ground stop{stop.reason ? `: ${stop.reason}` : ''}
                          {stop.end_time ? ` (FAA reported end: ${stop.end_time})` : ''}
                        </p>
                      ))}
                      {airport.faa_closure_start && <p className="mt-1">FAA {airport.faa_closure_status === 'closed' ? 'closure' : 'restriction'} start: {airport.faa_closure_start}</p>}
                      {airport.faa_closure_end && (
                        <p className="mt-1">{airport.faa_closure_status === 'closed' ? 'FAA reported reopening' : 'FAA reported restriction end'}: {airport.faa_closure_end}</p>
                      )}
                      {airport.faa_source_updated_at && <p className="mt-2 text-xs">FAA report updated: {airport.faa_source_updated_at}</p>}
                      {airport.faa_fetched_at && <p className="mt-1 text-xs">Retrieved: {airport.faa_fetched_at}</p>}
                    </div>
                  )}

                  {airport.delays && !(faaStatus?.disrupted && researchedStatus === 'normal') && (
                    <div className="p-3 bg-white/50 rounded-lg border border-sky-100 mb-3">
                      <p className="text-xs font-semibold text-gray-500 mb-1">{airport.conditionsSource === 'faa' ? 'FAA conditions' : 'Airport research'}</p>
                      <p className="text-sm text-gray-700">{airport.delays}</p>
                    </div>
                  )}

                  {airport.busyTimes && airport.busyTimes.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      <Clock className="w-4 h-4 text-sky-500" />
                      <span className="text-xs text-gray-500">Busy:</span>
                      {airport.busyTimes.map((time, tidx) => (
                        <Badge key={tidx} variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-xs">
                          {time}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* 2026-05-12 (D-108 step 2): TSA wait times per checkpoint type. Renders only when the airport
                      pipeline returned a `tsa` object with at least one lane. Handles "unreported" gracefully by
                      showing "—" instead of a fabricated number. */}
                  {airport.tsa && (airport.tsa.general || airport.tsa.preCheck || airport.tsa.clear) && (
                    <div className="mb-3">
                      <div className="flex items-center gap-2 mb-2">
                        <ShieldCheck className="w-4 h-4 text-indigo-500" />
                        <span className="text-xs font-medium text-gray-700">TSA Wait Times</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(['general', 'preCheck', 'clear'] as const).map((lane) => {
                          const laneData = airport.tsa?.[lane];
                          if (!laneData) return null;
                          const laneLabel = lane === 'preCheck' ? 'PreCheck' : lane === 'clear' ? 'Clear' : 'General';
                          const isNumericWait = typeof laneData.waitMinutes === 'number';
                          const isReported = isNumericWait || (laneData.waitMinutes && laneData.waitMinutes !== 'unreported');
                          const laneAccent = lane === 'clear'
                            ? 'bg-purple-50 border-purple-100 text-purple-700'
                            : lane === 'preCheck'
                              ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                              : 'bg-gray-50 border-gray-200 text-gray-700';
                          return (
                            <div key={lane} className={`p-2 rounded border ${laneAccent}`}>
                              <p className="text-xs opacity-75">{laneLabel}</p>
                              <p className="text-sm font-medium">
                                {isNumericWait
                                  ? `${laneData.waitMinutes} min`
                                  : isReported
                                    ? String(laneData.waitMinutes)
                                    : '—'}
                              </p>
                              {laneData.entryPoint && laneData.entryPoint !== 'unreported' && (
                                <p className="text-xs opacity-75 mt-0.5 truncate" title={laneData.entryPoint}>
                                  {laneData.entryPoint}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 2026-07-06 (todo #22): BEST ENTRY — the headline answer per lane
                      type, computed server-side from per-checkpoint waits. */}
                  {airport.best_entry && (airport.best_entry.general || airport.best_entry.preCheck || airport.best_entry.clear) && (
                    <div className="mb-3 p-2.5 bg-indigo-50 border border-indigo-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Sparkles className="w-4 h-4 text-indigo-600" />
                        <span className="text-xs font-semibold text-indigo-800">Best Entry Points</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {(['general', 'preCheck', 'clear'] as const).map((lane) => {
                          const be = airport.best_entry?.[lane];
                          if (!be) return null;
                          const laneLabel = lane === 'preCheck' ? 'PreCheck' : lane === 'clear' ? 'Clear' : 'General';
                          return (
                            <span key={lane} className="text-xs text-indigo-900">
                              <span className="font-medium">{laneLabel}:</span>{' '}
                              {be.terminal}{be.checkpoint && be.checkpoint !== 'unreported' ? ` · ${be.checkpoint}` : ''} ({be.waitMinutes} min)
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Per-terminal breakdown: checkpoints with lane waits, arrivals
                      activity, and rideshare pickup location per terminal. */}
                  {airport.terminals && airport.terminals.length > 0 && (
                    <div className="mb-3 space-y-2">
                      {airport.terminals.map((t, tIdx) => (
                        <div key={tIdx} className="p-2.5 bg-white/60 rounded-lg border border-sky-100">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold text-gray-800">Terminal {t.terminal}</span>
                            {t.arrivalsActivity && t.arrivalsActivity !== 'unreported' && (
                              <span className="text-xs text-gray-600 flex items-center gap-1">
                                <PlaneLanding className="w-3 h-3 text-green-600" />{t.arrivalsActivity}
                              </span>
                            )}
                          </div>
                          {t.checkpoints && t.checkpoints.length > 0 && (
                            <div className="space-y-1">
                              {t.checkpoints.map((cp, cpIdx) => (
                                <div key={cpIdx} className="flex items-center gap-2 text-xs text-gray-700">
                                  <ShieldCheck className="w-3 h-3 text-indigo-400 shrink-0" />
                                  <span className="font-medium min-w-0 truncate">
                                    {cp.name && cp.name !== 'unreported' ? cp.name : 'Checkpoint'}
                                  </span>
                                  {(['general', 'preCheck', 'clear'] as const).map((lane) => {
                                    const wait = cp.lanes?.[lane];
                                    if (wait === undefined || wait === null) return null;
                                    const laneLabel = lane === 'preCheck' ? 'Pre✓' : lane === 'clear' ? 'Clear' : 'Gen';
                                    return (
                                      <span key={lane} className="text-gray-500">
                                        {laneLabel}: {typeof wait === 'number' ? `${wait}m` : '—'}
                                      </span>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          )}
                          {t.ridesharePickup && t.ridesharePickup !== 'unreported' && (
                            <p className="text-xs text-sky-700 mt-1.5">🚗 Pickup: {t.ridesharePickup}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {(airport.arrivalDelays || airport.departureDelays) && (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    {airport.arrivalDelays && (
                    <div className="flex items-center gap-2 p-2 bg-green-50 rounded border border-green-100">
                      <PlaneLanding className="w-4 h-4 text-green-600" />
                      <div>
                        <p className="text-xs text-gray-500">Arrivals</p>
                        <p className="text-sm font-medium text-gray-700">
                          {directionalDelayLabel(airport.arrivalDelays, !!faaStatus?.disrupted)}
                        </p>
                      </div>
                    </div>
                    )}

                    {airport.departureDelays && (
                    <div className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-100">
                      <PlaneTakeoff className="w-4 h-4 text-blue-600" />
                      <div>
                        <p className="text-xs text-gray-500">Departures</p>
                        <p className="text-sm font-medium text-gray-700">
                          {directionalDelayLabel(airport.departureDelays, !!faaStatus?.disrupted)}
                        </p>
                      </div>
                    </div>
                    )}
                  </div>
                  )}

                  {airport.groundStops && (
                    <div className="flex items-center gap-2 p-2 bg-red-50 rounded border border-red-200 mb-3">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      <span className="text-sm font-medium text-red-700">Ground Stop in Effect</span>
                    </div>
                  )}

                  {airport.weather && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                      <Cloud className="w-4 h-4 text-gray-400" />
                      <span>{airport.weather}</span>
                    </div>
                  )}

                  {airport.tipsForDrivers && (
                    <div className="p-2 bg-amber-50 rounded border border-amber-200">
                      <p className="text-sm text-amber-800">
                        <span className="font-medium">Tip:</span> {airport.tipsForDrivers}
                      </p>
                    </div>
                  )}
                </div>
                );
              })}

              {busyPeriods.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-600" />
                    Busy Pickup Periods
                  </p>
                  {busyPeriods.map((period, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-2 bg-white/50 rounded border border-sky-100">
                      {typeof period === 'string' ? (
                        <span className="text-sm text-gray-700 flex items-center gap-2">
                          <Clock className="w-3 h-3 text-sky-500" />
                          {period}
                        </span>
                      ) : (
                        <>
                          <Badge variant="outline" className="bg-sky-100 text-sky-700 border-sky-300 font-mono text-xs">
                            {period.time}
                          </Badge>
                          <span className="text-sm text-gray-600">
                            <span className="font-medium">{period.airport}</span> - {period.reason}
                          </span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : airportFailed ? null : !airportConditions ? (
            <p role="status" className="text-gray-500 text-sm text-center py-4">Waiting for airport information…</p>
          ) : airportReason ? (
            <p className="text-gray-500 text-sm text-center py-4">{airportReason}</p>
          ) : (
            <p role="alert" className="text-amber-800 text-sm py-4">Airport information is incomplete: no reason was returned for the empty result.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
