import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Loader, Clock, ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import { getLocalDateString } from '@shared/dayparts.js';
import { getSchoolClosureInterval, getSchoolClosureStatusOnDate } from '@shared/school-closures.js';

interface SchoolClosure {
  schoolName?: string;
  school_name?: string;
  name?: string;
  district?: string;
  closureStart?: string;
  start_date?: string;
  startDate?: string;
  closure_date?: string;
  date?: string;
  reopeningDate?: string;
  reopening_date?: string;
  end_date?: string;
  endDate?: string;
  type: 'public' | 'private' | 'district' | 'college';
  reason?: string;
  closure_reason?: string;
  impact: 'high' | 'medium' | 'low';
}

interface SchoolClosuresData {
  school_closures?: SchoolClosure[];
  reason?: string;
  // 2026-07-06 (todo #24): pending/failed/verified-empty are three states
  _pending?: boolean;
  _generationFailed?: boolean;
}

interface SchoolClosuresCardProps {
  schoolClosuresData?: SchoolClosuresData;
  isSchoolClosuresLoading: boolean;
  timezone?: string | null;
}

// 2026-02-18: FIX - Added isSchoolClosuresLoading prop to match Traffic/Airport/News loading pattern
export function SchoolClosuresCard({ schoolClosuresData, isSchoolClosuresLoading, timezone }: SchoolClosuresCardProps) {
  const [expandedClosures, setExpandedClosures] = useState(true);
  const [, setCalendarRevision] = useState(0);
  useEffect(() => {
    // Completed briefings stop polling. Keep the local-day display accurate when
    // a phone stays open overnight or resumes, without another research request.
    const refresh = () => setCalendarRevision(revision => revision + 1);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const allClosures = Array.isArray(schoolClosuresData?.school_closures) ? schoolClosuresData.school_closures : [];
  const closuresReason = schoolClosuresData?.reason || null;
  let today: string | null = null;
  try {
    if (timezone) today = getLocalDateString(new Date(), timezone);
  } catch { /* An invalid snapshot timezone cannot establish today's closures. */ }
  const invalidDates = allClosures.some(closure => !getSchoolClosureInterval(closure));
  const schoolClosures = today
    ? allClosures.map(closure => ({ closure, status: getSchoolClosureStatusOnDate(closure, today) }))
      .filter(({ status }) => status !== null)
    : [];

  const formatDate = (dateStr: string) => {
    try {
      // Calendar dates are not instants in the browser's timezone.
      return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200" data-testid="school-closures-card">
      <CardHeader className="pb-2 cursor-pointer hover:bg-purple-100/50 transition-colors" onClick={() => setExpandedClosures(!expandedClosures)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {!schoolClosuresData ? (
              <Loader className="w-5 h-5 animate-spin text-purple-600" />
            ) : (
              <>
                <BookOpen className="w-5 h-5 text-purple-600" />
                School Closures
                {schoolClosures.length > 0 && (
                  <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300 ml-2">
                    {schoolClosures.length}
                  </Badge>
                )}
              </>
            )}
          </CardTitle>
          {expandedClosures ? <ChevronUp className="w-4 h-4 text-purple-600" /> : <ChevronDown className="w-4 h-4 text-purple-600" />}
        </div>
      </CardHeader>
      {expandedClosures && (
        <CardContent>
          {schoolClosuresData?._generationFailed ? (
            <div role="alert" className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>School closure data couldn't be retrieved{closuresReason ? ` — ${closuresReason}` : ''}.</span>
            </div>
          ) : isSchoolClosuresLoading || schoolClosuresData?._pending ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-5 h-5 animate-spin text-purple-600 mr-2" />
              <span role="status" className="text-gray-600">Loading school closures...</span>
            </div>
          ) : !schoolClosuresData ? (
            <p role="status" className="text-gray-500 text-sm">Waiting for school closure information…</p>
          ) : !today ? (
            <p role="alert" className="text-sm text-amber-800">School closure dates are unavailable because the location timezone is missing or invalid.</p>
          ) : invalidDates ? (
            <p role="alert" className="text-sm text-amber-800">School closure dates could not be verified.</p>
          ) : schoolClosures.length > 0 ? (
            <div className="space-y-3">
              {schoolClosures.map(({ closure, status }, idx) => {
                const interval = getSchoolClosureInterval(closure)!;
                const reopeningToday = status === 'reopening_today';
                const closedRange = `Closed: ${formatDate(interval.startDate)}${interval.closedThroughDate !== interval.startDate ? ` – ${formatDate(interval.closedThroughDate)}` : ''}`;
                return (
                <div
                  key={idx}
                  className={`border rounded-lg p-3 ${reopeningToday ? 'border-green-200 bg-green-50' : 'bg-gradient-to-r from-purple-50 to-blue-50'}`}
                  data-testid={`closure-${closure.type}-${idx}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900">{closure.school_name || closure.schoolName || closure.name || closure.district}</p>
                        <Badge variant="outline" className="text-xs">
                          {closure.type === 'college' ? '🎓 College' : closure.type === 'private' ? '🏫 Private School' : '🏫 District'}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{closure.closure_reason || closure.reason}</p>
                      <div className="flex flex-col gap-1">
                        <div className={`flex items-start gap-1 text-sm font-medium ${reopeningToday ? 'text-green-800' : 'text-gray-800'}`}>
                          <Clock className={`w-3 h-3 mt-1 shrink-0 ${reopeningToday ? 'text-green-600' : 'text-gray-500'}`} />
                          <span>{reopeningToday ? 'Students return today' : closedRange}</span>
                        </div>
                        {reopeningToday ? (
                          <p className="text-xs text-gray-600">{closedRange}</p>
                        ) : interval.endExclusive && (
                          <p className="text-xs text-gray-600">Students return: {formatDate(interval.endDate)}</p>
                        )}
                      </div>
                    </div>
                    <Badge className={`${
                      closure.impact === 'high' ? 'bg-red-100 text-red-700' :
                      closure.impact === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {closure.impact} impact
                    </Badge>
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-4">
              {closuresReason || 'No school closures reported for today'}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
