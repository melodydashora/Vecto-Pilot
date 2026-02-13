import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Car, Loader, AlertTriangle, ChevronUp, ChevronDown } from "lucide-react";

interface TrafficIncident {
  title?: string;
  severity?: string;
  location?: string;
  description?: string;
}

interface TrafficData {
  traffic?: {
    summary?: string;
    briefing?: string;
    incidents?: TrafficIncident[];
    incidentsCount?: number;
    congestionLevel?: 'low' | 'medium' | 'high';
    keyIssues?: string[];
    driverImpact?: string;
  };
}

interface TrafficCardProps {
  trafficData?: TrafficData;
  isTrafficLoading: boolean;
}

export function TrafficCard({ trafficData, isTrafficLoading }: TrafficCardProps) {
  const [expandedTraffic, setExpandedTraffic] = useState(true);
  const [expandedIncidents, setExpandedIncidents] = useState(false);

  const traffic = trafficData?.traffic;

  const getCongestionColor = (level: string) => {
    switch (level) {
      case 'high': return 'text-red-600';
      case 'medium': return 'text-yellow-600';
      default: return 'text-green-600';
    }
  };

  return (
    <Card className="bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200">
      <CardHeader 
        className="pb-2 cursor-pointer hover:bg-orange-100/50 transition-colors"
        onClick={() => setExpandedTraffic(!expandedTraffic)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {!traffic ? (
              <Loader className="w-5 h-5 animate-spin text-orange-600" />
            ) : (
              <>
                <Car className="w-5 h-5 text-orange-600" />
                Traffic Conditions
                {traffic && (
                  <Badge variant="outline" className={`ml-2 ${getCongestionColor(traffic.congestionLevel || 'medium')} bg-orange-100 border-orange-300`}>
                    {traffic.congestionLevel}
                  </Badge>
                )}
              </>
            )}
          </CardTitle>
          {expandedTraffic ? (
            <ChevronUp className="w-5 h-5 text-orange-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-orange-600" />
          )}
        </div>
      </CardHeader>
      {expandedTraffic && (
        <CardContent>
          {isTrafficLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-5 h-5 animate-spin text-orange-600 mr-2" />
              <span className="text-gray-600">Loading traffic...</span>
            </div>
          ) : traffic ? (
            <div className="space-y-3">
              {/* Traffic Briefing (3-4 sentences) */}
              <div className="p-3 bg-white/50 rounded-lg border border-orange-100">
                <p className="text-gray-700 font-medium leading-relaxed">
                  {traffic.briefing || traffic.summary || 'No significant traffic issues'}
                </p>
              </div>

              {/* Key Issues - if available */}
              {traffic.keyIssues && traffic.keyIssues.length > 0 && (
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-sm font-semibold text-amber-800 mb-2">Key Issues:</p>
                  <ul className="space-y-1">
                    {traffic.keyIssues.map((issue, idx) => (
                      <li key={idx} className="text-sm text-amber-700 flex items-start gap-2">
                        <span className="text-amber-500">•</span>
                        <span>{issue}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Collapsible Active Incidents */}
              {traffic.incidents && traffic.incidents.length > 0 && (
                <div className="border border-orange-200 rounded-lg overflow-hidden">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedIncidents(!expandedIncidents);
                    }}
                    className="w-full flex items-center justify-between p-3 bg-orange-50 hover:bg-orange-100 transition-colors"
                  >
                    <span className="text-sm font-medium text-orange-800 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-orange-500" />
                      Active Incidents ({traffic.incidentsCount || traffic.incidents.length})
                    </span>
                    {expandedIncidents ? (
                      <ChevronUp className="w-4 h-4 text-orange-600" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-orange-600" />
                    )}
                  </button>
                  {expandedIncidents && (
                    <div className="p-3 space-y-2 bg-white/50">
                      {traffic.incidents.map((incident, idx) => (
                        <div key={idx} className="flex items-start gap-2 p-2 bg-white rounded border border-orange-100">
                          <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm text-gray-700">{incident.description}</p>
                            <Badge variant="outline" className="text-xs mt-1 bg-orange-100 text-orange-700 border-orange-300">
                              {incident.severity}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Driver Impact - if available */}
              {traffic.driverImpact && (
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <p className="text-sm text-blue-800">
                    <span className="font-semibold">Driver Impact:</span> {traffic.driverImpact}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Traffic data not available</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
