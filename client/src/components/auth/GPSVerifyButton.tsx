/**
 * GPSVerifyButton Component
 * Gets current GPS location and reverse geocodes to an address
 */

import React, { useState } from 'react';
import { MapPin, Loader2, Check, AlertCircle } from 'lucide-react';

interface GPSResult {
  lat: number;
  lng: number;
  address: string;
  confidence?: {
    score: number;
    grade: string;
  };
}

interface GPSVerifyButtonProps {
  onLocationFound: (result: GPSResult) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
}

type VerifyState = 'idle' | 'locating' | 'geocoding' | 'success' | 'error';

export function GPSVerifyButton({
  onLocationFound,
  onError,
  disabled = false,
}: GPSVerifyButtonProps) {
  const [state, setState] = useState<VerifyState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GPSResult | null>(null);

  const handleClick = async () => {
    if (state === 'locating' || state === 'geocoding' || disabled) {
      return;
    }

    setError(null);
    setState('locating');

    try {
      // Get GPS position
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation is not supported by your browser'));
          return;
        }

        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      });

      const { latitude: lat, longitude: lng } = position.coords;

      setState('geocoding');

      // Reverse geocode the coordinates
      const response = await fetch(`/api/location/reverse-geocode?lat=${lat}&lng=${lng}`);

      if (!response.ok) {
        throw new Error('Failed to get address for location');
      }

      const data = await response.json();

      if (!data.ok) {
        throw new Error(data.error || 'Could not determine address');
      }

      const gpsResult: GPSResult = {
        lat,
        lng,
        address: data.formatted_address || data.address,
        confidence: data.confidence,
      };

      setResult(gpsResult);
      setState('success');
      onLocationFound(gpsResult);

      // Reset to idle after 3 seconds
      setTimeout(() => {
        setState('idle');
      }, 3000);

    } catch (err) {
      const errorMessage = err instanceof GeolocationPositionError
        ? getGeolocationError(err)
        : err instanceof Error
          ? err.message
          : 'Unknown error occurred';

      setError(errorMessage);
      setState('error');
      onError?.(errorMessage);

      // Reset to idle after 5 seconds
      setTimeout(() => {
        setState('idle');
        setError(null);
      }, 5000);
    }
  };

  const getButtonContent = () => {
    switch (state) {
      case 'locating':
        return (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Getting location...</span>
          </>
        );
      case 'geocoding':
        return (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Finding address...</span>
          </>
        );
      case 'success':
        return (
          <>
            <Check className="w-4 h-4" />
            <span>Location verified</span>
          </>
        );
      case 'error':
        return (
          <>
            <AlertCircle className="w-4 h-4" />
            <span>Try again</span>
          </>
        );
      default:
        return (
          <>
            <MapPin className="w-4 h-4" />
            <span>Use Current Location</span>
          </>
        );
    }
  };

  const getButtonStyle = () => {
    const base = 'flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all w-full';

    switch (state) {
      case 'success':
        return `${base} bg-green-100 text-green-700 border border-green-300`;
      case 'error':
        return `${base} bg-red-100 text-red-700 border border-red-300 hover:bg-red-200`;
      case 'locating':
      case 'geocoding':
        return `${base} bg-blue-100 text-blue-700 border border-blue-300 cursor-wait`;
      default:
        return `${base} bg-blue-600 text-white hover:bg-blue-700 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || state === 'locating' || state === 'geocoding'}
        className={getButtonStyle()}
      >
        {getButtonContent()}
      </button>

      {/* Error message */}
      {error && (
        <p className="text-red-600 text-xs flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}

      {/* Success result */}
      {state === 'success' && result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-sm text-green-800">{result.address}</p>
          {result.confidence && (
            <p className="text-xs text-green-600 mt-1">
              Confidence: {result.confidence.grade} ({result.confidence.score}/100)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function getGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location permission denied. Please enable location access.';
    case error.POSITION_UNAVAILABLE:
      return 'Location information unavailable. Try again.';
    case error.TIMEOUT:
      return 'Location request timed out. Please try again.';
    default:
      return 'Could not get your location.';
  }
}

export default GPSVerifyButton;
