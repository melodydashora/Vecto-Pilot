// Performance snapshot types
export interface PerformanceSnapshot {
  id: string;
  timestamp: string;
  period: "shift" | "day" | "week" | "month";
  earnings: {
    total: number;
    target: number;
    percentage: number;
    streak: number;
  };
  efficiency: {
    earningsPerHour: number;
    earningsPerMile: number;
    activeHours: number;
    totalMiles: number;
  };
  trips: {
    total: number;
    averageRating: number;
    topLocations: string[];
    bestHour: string;
  };
  achievements: {
    goalsReached: number;
    perfectDays: number;
    milestones: string[];
    badges: string[];
  };
  insights: {
    topPerformingZone: string;
    recommendedImprovement: string;
    nextTarget: string;
    celebrationLevel: "none" | "good" | "excellent" | "outstanding";
  };
}

export interface SnapshotRequest {
  period: "shift" | "day" | "week" | "month";
  location?: string;
  timestamp: string;
}