export function getSchoolClosureInterval(closure: unknown): {
  startDate: string;
  endDate: string;
  endExclusive: boolean;
  closedThroughDate: string;
} | null;
export function getSchoolClosureStatusOnDate(closure: unknown, today: unknown): 'closed' | 'reopening_today' | null;
export function isSchoolClosureActiveOnDate(closure: unknown, today: unknown): boolean;
