/**
 * DeadheadCalculator Component
 *
 * Interactive tool to calculate whether a long trip is worth taking.
 * Factors in trip duration, destination type, surge level, and deadhead risk.
 * Inspired by the Universal Rideshare Strategizer sample code.
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calculator, Clock, MapPin, TrendingUp, DollarSign, AlertCircle } from 'lucide-react';

type DestinationType = 'city' | 'suburb' | 'rural';
type SurgeLevel = '1' | '1.5' | '2.5';
type Verdict = 'accept' | 'borderline' | 'decline';

interface CalculationResult {
  verdict: Verdict;
  earnings: number;
  deadheadTime: number;
  totalTime: number;
  hourlyRate: number;
  reason: string;
}

const DESTINATION_LABELS: Record<DestinationType, string> = {
  city: 'Another City/Busy Area (High Return Chance)',
  suburb: 'Suburb (Low Return Chance)',
  rural: 'Rural/Casino/Nowhere (Zero Return Chance)',
};

const SURGE_LABELS: Record<SurgeLevel, string> = {
  '1': 'Base Fare (No Surge)',
  '1.5': 'Small Surge/Boost (1.5x)',
  '2.5': 'High Surge (2.0x+)',
};

const VERDICT_CONFIG: Record<Verdict, {
  icon: string;
  title: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  accept: {
    icon: '🤑',
    title: 'ACCEPT',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
  },
  borderline: {
    icon: '🤔',
    title: 'BORDERLINE',
    color: 'text-amber-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  decline: {
    icon: '🛑',
    title: 'DECLINE',
    color: 'text-rose-600',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-200',
  },
};

function calculateTripRisk(
  tripTime: number,
  destType: DestinationType,
  surgeLevel: SurgeLevel
): CalculationResult {
  const surge = parseFloat(surgeLevel);

  // Base pay estimate: ~$0.80/min average gross (blended time/mile)
  const baseEarnings = tripTime * 0.80;
  const totalEarnings = baseEarnings * surge;

  // Deadhead estimation based on destination type
  let deadheadTime = 0;
  if (destType === 'rural') {
    deadheadTime = tripTime; // Full return
  } else if (destType === 'suburb') {
    deadheadTime = tripTime * 0.5; // Half return to civilization
  } else {
    deadheadTime = 5; // Just finding next ride in busy area
  }

  const totalTime = tripTime + deadheadTime;
  const hourlyRate = (totalEarnings / totalTime) * 60;

  // Verdict logic
  let verdict: Verdict;
  let reason: string;

  if (hourlyRate < 15) {
    verdict = 'decline';
    reason = 'You are losing money. The return trip (deadhead) destroys your hourly rate.';
  } else if (hourlyRate < 25) {
    verdict = 'borderline';
    reason = 'Acceptable only if it gets you closer to home or a better zone.';
  } else {
    verdict = 'accept';
    reason = 'Profitable trip! The earnings outweigh the return cost.';
  }

  return {
    verdict,
    earnings: totalEarnings,
    deadheadTime,
    totalTime,
    hourlyRate,
    reason,
  };
}

export function DeadheadCalculator() {
  const [tripTime, setTripTime] = useState(45);
  const [destType, setDestType] = useState<DestinationType>('suburb');
  const [surgeLevel, setSurgeLevel] = useState<SurgeLevel>('1');
  const [result, setResult] = useState<CalculationResult | null>(null);

  const handleCalculate = () => {
    const calc = calculateTripRisk(tripTime, destType, surgeLevel);
    setResult(calc);
  };

  const verdictConfig = result ? VERDICT_CONFIG[result.verdict] : null;

  return (
    <Card className="shadow-lg border-gray-200 overflow-hidden">
      <CardHeader className="bg-gray-900 text-white">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              Deadhead Risk Calculator
            </CardTitle>
            <p className="text-gray-400 text-sm mt-1">
              Universal Logic: Should I take this long trip?
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
          {/* Input Panel */}
          <div className="p-6 space-y-6">
            {/* Trip Duration Slider */}
            <div>
              <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase mb-3">
                <Clock className="w-4 h-4" />
                Trip Duration
              </label>
              <Slider
                value={[tripTime]}
                onValueChange={(v) => setTripTime(v[0])}
                min={15}
                max={180}
                step={5}
                className="mb-2"
              />
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">15m</span>
                <span className="font-bold text-gray-900 text-lg">{tripTime} mins</span>
                <span className="text-gray-400">3h</span>
              </div>
            </div>

            {/* Destination Type */}
            <div>
              <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase mb-3">
                <MapPin className="w-4 h-4" />
                Destination Type
              </label>
              <Select value={destType} onValueChange={(v) => setDestType(v as DestinationType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DESTINATION_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Surge Level */}
            <div>
              <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase mb-3">
                <TrendingUp className="w-4 h-4" />
                Current Surge / Bonus?
              </label>
              <Select value={surgeLevel} onValueChange={(v) => setSurgeLevel(v as SurgeLevel)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SURGE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleCalculate}
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold py-4 shadow-lg"
            >
              Analyze Trip
            </Button>
          </div>

          {/* Result Panel */}
          <div className="p-6 bg-gray-50 flex items-center justify-center min-h-[300px]">
            {!result ? (
              <div className="text-center text-gray-400">
                <span className="text-4xl block mb-2">👇</span>
                <p>Enter details &amp; click Analyze</p>
              </div>
            ) : (
              <div className={`w-full h-full flex flex-col justify-center p-4 rounded-xl ${verdictConfig?.bgColor} border ${verdictConfig?.borderColor} animate-in fade-in duration-300`}>
                {/* Verdict */}
                <div className="text-center mb-6">
                  <span className="text-5xl block mb-2">{verdictConfig?.icon}</span>
                  <h4 className={`text-3xl font-black ${verdictConfig?.color}`}>
                    {verdictConfig?.title}
                  </h4>
                </div>

                {/* Stats */}
                <div className="space-y-3 bg-white/50 p-4 rounded-lg">
                  <div className="flex justify-between text-sm border-b border-gray-200/50 pb-2">
                    <span className="text-gray-500 flex items-center gap-1">
                      <DollarSign className="w-4 h-4" />
                      Estimated Earnings
                    </span>
                    <span className="font-bold text-emerald-600">${result.earnings.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b border-gray-200/50 pb-2">
                    <span className="text-gray-500 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      Unpaid Return (Deadhead)
                    </span>
                    <span className="font-bold text-rose-600">{Math.round(result.deadheadTime)} mins</span>
                  </div>
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-gray-700 font-bold">Effective Hourly Rate</span>
                    <span className="font-black text-gray-900">${result.hourlyRate.toFixed(0)}/hr</span>
                  </div>
                </div>

                {/* Reason */}
                <p className="mt-4 text-sm text-center text-gray-600 italic leading-relaxed">
                  {result.reason}
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default DeadheadCalculator;
