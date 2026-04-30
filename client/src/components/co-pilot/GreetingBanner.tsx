// client/src/components/co-pilot/GreetingBanner.tsx
// Holiday and time-based greeting banner for Co-Pilot

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { PartyPopper, Sun, Moon } from 'lucide-react';
import { getGreeting } from '@/utils/co-pilot-helpers';
<<<<<<< HEAD
=======
import { useAuth } from '@/contexts/auth-context';
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7

interface GreetingBannerProps {
  holiday?: string | null;
}

export function GreetingBanner({ holiday }: GreetingBannerProps) {
<<<<<<< HEAD
  const greeting = getGreeting();
=======
  const { profile } = useAuth();
  const greeting = getGreeting();
  // 2026-02-12: Use driver's nickname, fall back to firstName, then "driver"
  const driverName = profile?.nickname || profile?.firstName || 'driver';
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7

  // Holiday banner (if holiday detected and not 'none')
  // When holiday is 'none' or falsy, show the default driver greeting
  const hasHoliday = holiday && holiday !== 'none';

  if (hasHoliday) {
    return (
      <Card
        className="mb-6 border-2 border-amber-400 bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 shadow-lg"
        data-testid="holiday-banner"
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100">
              <PartyPopper className="w-6 h-6 text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-amber-900 text-lg">
                🎉 Happy {holiday}!
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Time-based greeting (default)
  return (
    <Card
      className="mb-6 border-2 border-blue-300 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 shadow-md"
      data-testid="greeting-banner"
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-100">
            {greeting.period === 'morning' && (
              <Sun className="w-6 h-6 text-blue-600" />
            )}
            {greeting.period === 'afternoon' && (
              <Sun className="w-6 h-6 text-orange-500" />
            )}
            {greeting.period === 'evening' && (
              <Moon className="w-6 h-6 text-indigo-600" />
            )}
          </div>
          <div className="flex-1">
            <p className="font-bold text-gray-900 text-lg">
<<<<<<< HEAD
              {greeting.icon} {greeting.text}, driver!
=======
              {greeting.icon} {greeting.text}, {driverName}!
>>>>>>> d39d570fbc330b69f07cc3bdd525a0b234e73be7
            </p>
            <p className="text-sm text-gray-700">
              Your AI strategy is analyzing real-time conditions to maximize your earnings
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default GreetingBanner;
