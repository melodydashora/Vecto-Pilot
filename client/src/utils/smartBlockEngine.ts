
function getCurrentTimeSlot(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 24) return 'evening';
  return 'night';
}


/**
 * Smart Block Engine - Intelligent block generation with dynamic context
 * Generates real-time recommendations based on time, location, and driver preferences
 * Uses AI APIs to generate location-specific blocks without hardcoded data
 */

import { getTimeMetadata } from './getTimeMetadata';
import { apiRequest } from '@/lib/queryClient';

interface DriverPreferences {
  vehicleTier: string;
  minEarningsPerHour: number;
  preferredZones: string[];
  noGoZones: string[];
}

export interface SmartBlock {
  id: string;
  title: string;
  confidence: number;
  fuelCost: string;
  expectedEarnings: string;
  showOnlyInTime?: 'morning' | 'afternoon' | 'evening' | 'overnight';
  onlyDuringBusinessHours?: boolean;
  hideOnWeekend?: boolean;
  tier: string;
  estimatedDistance: string;
  bestTime: string;
  location?: string;
  address?: string;
  surgeLevel?: number;
  category?: 'local' | 'medium_distance' | 'long_distance';
  reason?: string;
}

export const getDriverPreferences = async (): Promise<DriverPreferences> => {
  // Get from localStorage or use defaults
  const stored = localStorage.getItem('driverPreferences');
  if (stored) {
    return JSON.parse(stored);
  }

  // Default preferences with neutral tier naming
  return {
    vehicleTier: 'Standard Rideshare',
    minEarningsPerHour: 25,
    preferredZones: ['Downtown', 'Airport', 'Business District'],
    noGoZones: []
  };
};

export const getCurrentLocation = async () => {
  const locationData = localStorage.getItem('vecto-location');
  if (locationData) {
    const parsed = JSON.parse(locationData);
    if (parsed.latitude && parsed.longitude) {
      return {
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        locationName: parsed.currentLocation || 'Current Location'
      };
    }
  }
  
  throw new Error('GPS location required. Please enable location services to use Vecto Pilot.');
};

export const generateSmartBlocks = async (time: any): Promise<SmartBlock[]> => {
  const prefs = await getDriverPreferences();
  const location = await getCurrentLocation();

  try {
    // Try to get zones first (primary API)
    const zonesResponse = await apiRequest('POST', '/api/zones', {
      lat: location.latitude,
      lng: location.longitude
    });

    if (zonesResponse.ok) {
      const zones = await zonesResponse.json();
      if (Array.isArray(zones) && zones.length > 0) {
        // Transform zone data to SmartBlock format with time/tier filtering
        return transformToSmartBlocks(zones, time, prefs);
      }
    }

    // Fallback to location-aware blocks API
    const blocksResponse = await apiRequest('GET', 
      `/api/location-aware-blocks?lat=${location.latitude}&lon=${location.longitude}&vehicleTypes=${prefs.vehicleTier}&minEarnings=${prefs.minEarningsPerHour}`);

    if (blocksResponse.ok) {
      const blocks = await blocksResponse.json();
      if (Array.isArray(blocks) && blocks.length > 0) {
        return transformToSmartBlocks(blocks, time, prefs);
      }
    }

    // If both APIs fail, throw error (no hardcoded fallback)
    throw new Error('Unable to retrieve Smart Blocks from API');

  } catch (error) {
    console.error('Smart Block Engine API Error:', error);
    throw new Error('Smart Blocks API is currently unavailable. Please try again later.');
  }
};

// Transform API response to SmartBlock format with intelligent filtering
const transformToSmartBlocks = (apiBlocks: any[], time: any, prefs: DriverPreferences): SmartBlock[] => {
  const timeLabels = getTimeBasedLabels(time);

  return apiBlocks.map((block, index) => {
    // Calculate confidence based on surge level and earnings
    const confidence = calculateConfidence(block.surgeLevel, block.earningsPerHour);

    // Estimate fuel cost based on distance
    const fuelCost = estimateFuelCost(block.distanceFromCurrent || block.distanceAway || 10);

    // Determine time slot
    const timeSlot = determineTimeSlot(time);

    // Generate smart block with time-aware metadata
    return {
      id: block.id || `block-${index}`,
      title: block.location || block.name || 'Opportunity Zone',
      confidence,
      fuelCost,
      expectedEarnings: `$${block.estimatedFare || 25}–$${(block.estimatedFare || 25) + 15}`,
      showOnlyInTime: timeSlot,
      onlyDuringBusinessHours: block.category === 'business' || block.location?.includes('Business'),
      hideOnWeekend: block.category === 'business' || block.location?.includes('Corporate'),
      tier: mapToTierName(block.vehicleType || 'standard'),
      estimatedDistance: block.driveTimeText || `${block.driveTimeMin || 10} min`,
      bestTime: generateBestTime(time),
      location: block.location,
      address: block.address,
      surgeLevel: block.surgeLevel || 1.0,
      category: block.category || 'local',
      reason: block.reason || generateReason(block, confidence)
    };
  }).filter(block => {
    // Apply time-based filtering
    const currentTimeSlot = getCurrentTimeSlot();
    if (block.showOnlyInTime && block.showOnlyInTime !== currentTimeSlot) {
      return false;
    }
    if (block.onlyDuringBusinessHours && !time.isBusinessHours) {
      return false;
    }
    if (block.hideOnWeekend && time.isWeekend) {
      return false;
    }

    // Apply tier filtering
    if (block.tier && prefs.vehicleTier !== block.tier && 
        prefs.vehicleTier !== 'Standard Rideshare') {
      return false;
    }

    return true;
  });
};

// Helper functions for intelligent block generation
const calculateConfidence = (surgeLevel: number = 1, earningsPerHour: number = 30): number => {
  const surgeFactor = Math.min(surgeLevel / 2, 1) * 0.5;
  const earningsFactor = Math.min(earningsPerHour / 60, 1) * 0.5;
  return Math.min(0.95, surgeFactor + earningsFactor + 0.3);
};

const estimateFuelCost = (distance: number): string => {
  const costPerMile = 0.15; // Average fuel cost per mile
  const estimatedCost = distance * costPerMile;
  return `$${estimatedCost.toFixed(2)}`;
};

const determineTimeSlot = (time: any): 'morning' | 'afternoon' | 'evening' | 'overnight' | undefined => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 23) return 'evening';
  return 'overnight';
};

const mapToTierName = (vehicleType: string): string => {
  const tierMap: Record<string, string> = {
    'standard': 'Standard Rideshare',
    'comfort': 'Comfort / Spacious Vehicle',
    'xl': 'Large / Group Rides',
    'premium': 'Premium / Luxury / Commercial',
    'delivery': 'Delivery Services'
  };
  return tierMap[vehicleType.toLowerCase()] || 'Standard Rideshare';
};

const generateBestTime = (time: any): string => {
  const now = new Date();
  const later = new Date(now.getTime() + 90 * 60000); // 90 minutes later
  return `Now – ${later.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

const generateReason = (block: any, confidence: number): string => {
  const surgeLevel = block.surgeLevel || 1.0;
  const earnings = block.earningsPerHour || 30;

  if (confidence > 0.9) {
    return `✅ HIGHEST EARNING: $${earnings}/hr with ${surgeLevel}x surge. Top opportunity in your area.`;
  } else if (confidence > 0.8) {
    return `⚡ SURGE ACTIVE: $${earnings}/hr with ${surgeLevel}x surge. Strong earning potential.`;
  } else if (confidence > 0.7) {
    return `💰 STEADY DEMAND: $${earnings}/hr. Consistent earning opportunity.`;
  } else {
    return `📍 AVAILABLE: $${earnings}/hr. Active zone with rider demand.`;
  }
};

const getTimeBasedLabels = (time: any) => {
  return {
    isMorning: time.timeLabel === 'morning' || time.timeLabel === 'morningRush',
    isAfternoon: time.timeLabel === 'afternoon' || time.timeLabel === 'lunch',
    isEvening: time.timeLabel === 'evening' || time.timeLabel === 'dinner',
    isOvernight: time.timeLabel === 'overnight' || time.timeLabel === 'lateNight'
  };
};

// Add block to user's agenda
export const addToAgenda = (block: SmartBlock) => {
  const agenda = JSON.parse(localStorage.getItem('userAgenda') || '[]');
  agenda.push({ 
    ...block, 
    addedAt: new Date().toISOString(),
    status: 'pending'
  });
  localStorage.setItem('userAgenda', JSON.stringify(agenda));

  // Dispatch event for UI updates
  window.dispatchEvent(new CustomEvent('agendaUpdated', { detail: agenda }));
};

// Get user's saved agenda
export const getUserAgenda = () => {
  return JSON.parse(localStorage.getItem('userAgenda') || '[]');
};

// Clear completed agenda items
export const clearCompletedAgenda = () => {
  const agenda = getUserAgenda();
  const pending = agenda.filter((item: any) => item.status !== 'completed');
  localStorage.setItem('userAgenda', JSON.stringify(pending));
  window.dispatchEvent(new CustomEvent('agendaUpdated', { detail: pending }));
};