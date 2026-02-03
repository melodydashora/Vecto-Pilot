/**
 * VehicleInfoSection Component
 * Collects vehicle information for platform eligibility determination
 */

import React, { useState, useEffect } from 'react';
import { Car, Users, Check } from 'lucide-react';

interface VehicleInfo {
  year: string;
  make: string;
  model: string;
  color: string;
  seatCapacity: number;
  licensePlate?: string;
}

interface VehicleInfoSectionProps {
  value: VehicleInfo;
  onChange: (info: VehicleInfo) => void;
  errors?: Partial<Record<keyof VehicleInfo, string>>;
}

// Common vehicle makes
const VEHICLE_MAKES = [
  'Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler',
  'Dodge', 'Ford', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar',
  'Jeep', 'Kia', 'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz',
  'Nissan', 'Ram', 'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo',
];

// Generate year options (current year to 15 years back)
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 16 }, (_, i) => String(currentYear - i));

// Seat capacity options
const SEAT_OPTIONS = [4, 5, 6, 7, 8];

// Vehicle colors
const COLORS = [
  'Black', 'White', 'Silver', 'Gray', 'Red', 'Blue',
  'Brown', 'Green', 'Beige', 'Gold', 'Orange', 'Other',
];

// Platform eligibility by year
function getEligibilityTiers(year: number): string[] {
  const vehicleAge = currentYear - year;
  const tiers: string[] = [];

  if (vehicleAge <= 15) tiers.push('UberX', 'Lyft');
  if (vehicleAge <= 10) tiers.push('UberXL', 'Lyft XL');
  if (vehicleAge <= 6) tiers.push('Uber Comfort', 'Lyft Lux');
  if (vehicleAge <= 4) tiers.push('Uber Black');

  return tiers;
}

export function VehicleInfoSection({
  value,
  onChange,
  errors = {},
}: VehicleInfoSectionProps) {
  const [eligibility, setEligibility] = useState<string[]>([]);

  // Update eligibility when year changes
  useEffect(() => {
    if (value.year) {
      const tiers = getEligibilityTiers(parseInt(value.year));
      setEligibility(tiers);
    }
  }, [value.year]);

  const handleChange = (field: keyof VehicleInfo, newValue: string | number) => {
    onChange({ ...value, [field]: newValue });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-gray-700">
        <Car className="w-5 h-5" />
        <h3 className="font-medium">Vehicle Information</h3>
      </div>

      {/* Year and Make row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Year
          </label>
          <select
            value={value.year}
            onChange={(e) => handleChange('year', e.target.value)}
            className={`
              w-full px-3 py-2 border rounded-lg text-sm
              focus:ring-2 focus:ring-blue-500 focus:border-blue-500
              ${errors.year ? 'border-red-500' : 'border-gray-300'}
            `}
          >
            <option value="">Select year</option>
            {YEARS.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          {errors.year && (
            <p className="text-red-500 text-xs mt-1">{errors.year}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Make
          </label>
          <select
            value={value.make}
            onChange={(e) => handleChange('make', e.target.value)}
            className={`
              w-full px-3 py-2 border rounded-lg text-sm
              focus:ring-2 focus:ring-blue-500 focus:border-blue-500
              ${errors.make ? 'border-red-500' : 'border-gray-300'}
            `}
          >
            <option value="">Select make</option>
            {VEHICLE_MAKES.map(make => (
              <option key={make} value={make}>{make}</option>
            ))}
          </select>
          {errors.make && (
            <p className="text-red-500 text-xs mt-1">{errors.make}</p>
          )}
        </div>
      </div>

      {/* Model and Color row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Model
          </label>
          <input
            type="text"
            value={value.model}
            onChange={(e) => handleChange('model', e.target.value)}
            placeholder="e.g., Camry, Accord"
            className={`
              w-full px-3 py-2 border rounded-lg text-sm
              focus:ring-2 focus:ring-blue-500 focus:border-blue-500
              ${errors.model ? 'border-red-500' : 'border-gray-300'}
            `}
          />
          {errors.model && (
            <p className="text-red-500 text-xs mt-1">{errors.model}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Color
          </label>
          <select
            value={value.color}
            onChange={(e) => handleChange('color', e.target.value)}
            className={`
              w-full px-3 py-2 border rounded-lg text-sm
              focus:ring-2 focus:ring-blue-500 focus:border-blue-500
              ${errors.color ? 'border-red-500' : 'border-gray-300'}
            `}
          >
            <option value="">Select color</option>
            {COLORS.map(color => (
              <option key={color} value={color}>{color}</option>
            ))}
          </select>
          {errors.color && (
            <p className="text-red-500 text-xs mt-1">{errors.color}</p>
          )}
        </div>
      </div>

      {/* Seat Capacity */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          <Users className="w-4 h-4 inline mr-1" />
          Passenger Capacity
        </label>
        <div className="flex gap-2">
          {SEAT_OPTIONS.map(seats => (
            <button
              key={seats}
              type="button"
              onClick={() => handleChange('seatCapacity', seats)}
              className={`
                flex-1 py-2 rounded-lg text-sm font-medium
                transition-colors border-2
                ${value.seatCapacity === seats
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                }
              `}
            >
              {seats}
            </button>
          ))}
        </div>
        {errors.seatCapacity && (
          <p className="text-red-500 text-xs mt-1">{errors.seatCapacity}</p>
        )}
      </div>

      {/* Platform Eligibility Preview */}
      {eligibility.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-sm font-medium text-green-800 mb-2">
            Eligible for:
          </p>
          <div className="flex flex-wrap gap-2">
            {eligibility.map(tier => (
              <span
                key={tier}
                className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full"
              >
                <Check className="w-3 h-3" />
                {tier}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default VehicleInfoSection;
