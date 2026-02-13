import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plane, Loader, Sparkles, Clock, PlaneLanding, PlaneTakeoff, AlertTriangle, Cloud, ChevronUp, ChevronDown } from "lucide-react";

interface AirportDelay {
  status: string;
  avgMinutes: number;
}

interface Airport {
  code: string;
  name: string;
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
}

interface AirportCardProps {
  airportData?: { airport_conditions?: AirportConditions };
  isAirportLoading: boolean;
}

export function AirportCard({ airportData, isAirportLoading }: AirportCardProps) {
  const [expandedAirport, setExpandedAirport] = useState(true);

  const airportConditions = airportData?.airport_conditions;
  const airports = airportConditions?.airports || [];
  const busyPeriods = airportConditions?.busyPeriods || [];
  const airportRecommendations = airportConditions?.recommendations;

  const getAirportStatusColor = (status: string) => {
    switch (status) {
      case 'severe_delays': return 'bg-red-100 text-red-700 border-red-300';
      case 'delays': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      default: return 'bg-green-100 text-green-700 border-green-300';
    }
  };

  const getAirportStatusLabel = (status: string) => {
    switch (status) {
      case 'severe_delays': return 'Severe Delays';
      case 'delays': return 'Delays';
      default: return 'On Time';
    }
  };

  return (
    <Card className="bg-gradient-to-r from-sky-50 to-cyan-50 border-sky-200">
      <CardHeader
        className="pb-2 cursor-pointer hover:bg-sky-100/50 transition-colors"
        onClick={() => setExpandedAirport(!expandedAirport)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {!airportData ? (
              <Loader className="w-5 h-5 animate-spin text-sky-600" />
            ) : (
              <>
                <Plane className="w-5 h-5 text-sky-600" />
                Airport Conditions
                {airports.length > 0 && (
                  <Badge variant="outline" className="bg-sky-100 text-sky-700 border-sky-300 ml-2">
                    {airports.length} {airports.length === 1 ? 'airport' : 'airports'}
                  </Badge>
                )}
              </>
            )}
          </CardTitle>
          {expandedAirport ? (
            <ChevronUp className="w-5 h-5 text-sky-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-sky-600" />
          )}
        </div>
      </CardHeader>
      {expandedAirport && (
        <CardContent>
          {isAirportLoading ? (
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
                const airportStatus = airport.overallStatus || airport.status || 'normal';

                return (
                <div
                  key={idx}
                  className="p-4 bg-white/60 rounded-lg border border-sky-100 hover:border-sky-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-lg bg-sky-100">
                        <Plane className="w-5 h-5 text-sky-600" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900">{airport.code}</h4>
                        <p className="text-xs text-gray-500">{airport.name}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={getAirportStatusColor(airportStatus)}>
                      {getAirportStatusLabel(airportStatus)}
                    </Badge>
                  </div>

                  {airport.delays && (
                    <div className="p-3 bg-white/50 rounded-lg border border-sky-100 mb-3">
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

                  {(airport.arrivalDelays || airport.departureDelays) && (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="flex items-center gap-2 p-2 bg-green-50 rounded border border-green-100">
                      <PlaneLanding className="w-4 h-4 text-green-600" />
                      <div>
                        <p className="text-xs text-gray-500">Arrivals</p>
                        <p className="text-sm font-medium text-gray-700">
                          {airport.arrivalDelays?.status === 'none' ? 'On Time' :
                            airport.arrivalDelays?.avgMinutes ? `~${airport.arrivalDelays.avgMinutes} min delay` :
                              airport.arrivalDelays?.status || 'Normal'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-100">
                      <PlaneTakeoff className="w-4 h-4 text-blue-600" />
                      <div>
                        <p className="text-xs text-gray-500">Departures</p>
                        <p className="text-sm font-medium text-gray-700">
                          {airport.departureDelays?.status === 'none' ? 'On Time' :
                            airport.departureDelays?.avgMinutes ? `~${airport.departureDelays.avgMinutes} min delay` :
                              airport.departureDelays?.status || 'Normal'}
                        </p>
                      </div>
                    </div>
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
          ) : (
            <p className="text-gray-500 text-sm text-center py-4">
              {airportConditions?.isFallback ? 'Airport data temporarily unavailable' : 'No nearby airports found'}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
