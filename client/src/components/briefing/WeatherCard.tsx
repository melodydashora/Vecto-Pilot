import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Cloud, CloudRain, Sun } from "lucide-react";

interface ForecastItem {
  day?: string;
  time?: string;
  high?: number;
  low?: number;
  tempF?: number;
  conditions?: string;
  conditionType?: string;
  isDaytime?: boolean;
  precipitationProbability?: number;
}

interface WeatherData {
  weather?: {
    current?: {
      tempF?: number;
      conditions?: string;
      humidity?: number;
      windDirection?: string;
      isDaytime?: boolean;
    };
    forecast?: ForecastItem[];
  };
}

interface WeatherCardProps {
  weatherData?: WeatherData;
}

export function WeatherCard({ weatherData }: WeatherCardProps) {
  const weather = weatherData?.weather;

  if (!weather?.forecast || weather.forecast.length === 0) return null;

  const getWeatherIcon = (conditionType?: string | null, isDaytime?: boolean | null) => {
    if (!conditionType) return <Cloud className="w-6 h-6 text-gray-500" />;
    const type = conditionType.toLowerCase();
    if (type.includes('rain') || type.includes('shower')) return <CloudRain className="w-6 h-6 text-blue-500" />;
    if (type.includes('clear') || type.includes('sunny')) {
      return isDaytime ? <Sun className="w-6 h-6 text-yellow-500" /> : <Cloud className="w-6 h-6 text-gray-400" />;
    }
    if (type.includes('partly') || type.includes('cloud')) return <Sun className="w-6 h-6 text-gray-400" />;
    return <Cloud className="w-6 h-6 text-gray-500" />;
  };

  return (
    <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Cloud className="w-5 h-5 text-blue-600" />
          6-Hour Forecast
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {weather.forecast.slice(0, 6).map((hour, idx) => (
            <div key={idx} className="flex flex-col items-center min-w-[70px] text-center p-2 bg-white/50 rounded">
              <span className="text-xs text-gray-500 font-medium">
                {hour.time ? new Date(hour.time).toLocaleTimeString([], { hour: 'numeric' }) : `+${idx + 1}h`}
              </span>
              <div className="my-1">{getWeatherIcon(hour.conditionType, hour.isDaytime)}</div>
              <span className="text-sm font-medium text-gray-800">
                {hour.tempF || 0}°F
              </span>
              {hour.precipitationProbability !== null && hour.precipitationProbability !== undefined && hour.precipitationProbability > 0 && (
                <span className="text-xs text-blue-600 font-medium">{hour.precipitationProbability}% rain</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
