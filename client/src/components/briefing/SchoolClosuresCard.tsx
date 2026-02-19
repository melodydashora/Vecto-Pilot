import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Loader, Clock, ChevronUp, ChevronDown } from "lucide-react";

interface SchoolClosure {
  schoolName: string;
  closureStart: string;
  reopeningDate: string;
  type: 'district' | 'college';
  reason: string;
  impact: 'high' | 'medium' | 'low';
}

interface SchoolClosuresData {
  school_closures?: SchoolClosure[];
  reason?: string;
}

interface SchoolClosuresCardProps {
  schoolClosuresData?: SchoolClosuresData;
  isSchoolClosuresLoading: boolean;
}

// 2026-02-18: FIX - Added isSchoolClosuresLoading prop to match Traffic/Airport/News loading pattern
export function SchoolClosuresCard({ schoolClosuresData, isSchoolClosuresLoading }: SchoolClosuresCardProps) {
  const [expandedClosures, setExpandedClosures] = useState(true);

  const allClosures = schoolClosuresData?.school_closures || [];
  const closuresReason = schoolClosuresData?.reason || null;

  // Show closures that are currently active OR start within next 30 days
  const isClosureRelevant = (closure: SchoolClosure): boolean => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const reopeningDate = new Date(closure.reopeningDate);
      reopeningDate.setHours(0, 0, 0, 0);
      return reopeningDate >= today;
    } catch {
      return true;
    }
  };

  const schoolClosures = allClosures.filter(isClosureRelevant);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
          {isSchoolClosuresLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-5 h-5 animate-spin text-purple-600 mr-2" />
              <span className="text-gray-600">Loading school closures...</span>
            </div>
          ) : schoolClosures.length > 0 ? (
            <div className="space-y-3">
              {schoolClosures.map((closure, idx) => (
                <div
                  key={idx}
                  className="border rounded-lg p-3 bg-gradient-to-r from-purple-50 to-blue-50"
                  data-testid={`closure-${closure.type}-${idx}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900">{closure.schoolName}</p>
                        <Badge variant="outline" className="text-xs">
                          {closure.type === 'college' ? '🎓 College' : '🏫 District'}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{closure.reason}</p>
                      <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-gray-500" />
                          <span>Closed: {formatDate(closure.closureStart)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-green-600" />
                          <span>Reopens: {formatDate(closure.reopeningDate)}</span>
                        </div>
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
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-4">
              {closuresReason || 'No school closures reported'}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
