// 📦 Driver Preference Injection – Phase 17: Personalized Filtering
// 📂 File: src/utils/driverPreferences.ts
// 👤 Owner: VectoPilot Driver Intelligence Layer
// 🔒 Injects personal preferences into block recommendations

export interface DriverPreferences {
  maxDriveTime: number; // Maximum drive time in minutes
  minEarningsPerHour: number; // Minimum earnings threshold
  preferredSurgeLevel: number; // Minimum surge level preference
  vehicleType: 'sedan' | 'suv' | 'minivan' | 'electric' | 'luxury';
  avoidHighways: boolean;
  preferAirport: boolean;
  preferDowntown: boolean;
  avoidNightShifts: boolean;
  preferredRadius: number; // Maximum radius in miles
  noGoZones: string[]; // Areas to avoid
  favoriteSpots: string[]; // Preferred locations
  workSchedule: {
    preferredStartTime: number; // Hour (0-23)
    preferredEndTime: number; // Hour (0-23)
    preferredDays: string[]; // Days of week
  };
}

// Get stored preferences or defaults
export const getDriverPreferences = (): DriverPreferences => {
  const stored = localStorage.getItem('driver-preferences');
  if (stored) {
    return JSON.parse(stored);
  }
  
  // Default preferences
  return {
    maxDriveTime: 15,
    minEarningsPerHour: 25,
    preferredSurgeLevel: 1.5,
    vehicleType: 'sedan',
    avoidHighways: false,
    preferAirport: false,
    preferDowntown: true,
    avoidNightShifts: false,
    preferredRadius: 10,
    noGoZones: [],
    favoriteSpots: [],
    workSchedule: {
      preferredStartTime: 8,
      preferredEndTime: 20,
      preferredDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    }
  };
};

// Save preferences
export const saveDriverPreferences = (prefs: DriverPreferences) => {
  localStorage.setItem('driver-preferences', JSON.stringify(prefs));
  console.log('💾 Driver preferences saved:', prefs);
};

// Inject preferences into block recommendations
export const injectPreferences = (
  blocks: any[],
  preferences: DriverPreferences
): any[] => {
  if (!blocks || blocks.length === 0) return [];
  
  console.log(`🎯 [Preference Injection] Processing ${blocks.length} blocks with driver preferences`);
  
  const filtered = blocks.filter((block) => {
    // Filter by max drive time
    const driveTime = parseInt(block.driveTime?.replace(' min', '') || '0');
    if (driveTime > preferences.maxDriveTime) {
      console.log(`⏱️ Filtered out "${block.location}" - exceeds max drive time (${driveTime} > ${preferences.maxDriveTime})`);
      return false;
    }
    
    // Filter by minimum earnings
    if (block.earningsPerHour < preferences.minEarningsPerHour) {
      console.log(`💰 Filtered out "${block.location}" - below minimum earnings ($${block.earningsPerHour} < $${preferences.minEarningsPerHour})`);
      return false;
    }
    
    // Filter by surge level
    if (block.surgeLevel < preferences.preferredSurgeLevel) {
      console.log(`📈 Filtered out "${block.location}" - below preferred surge (${block.surgeLevel}x < ${preferences.preferredSurgeLevel}x)`);
      return false;
    }
    
    // Check no-go zones
    const locationLower = block.location?.toLowerCase() || '';
    for (const noGo of preferences.noGoZones) {
      if (locationLower.includes(noGo.toLowerCase())) {
        console.log(`🚫 Filtered out "${block.location}" - in no-go zone (${noGo})`);
        return false;
      }
    }
    
    // Apply time preferences
    const currentHour = new Date().getHours();
    const currentDay = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    
    if (preferences.avoidNightShifts) {
      if (currentHour < 6 || currentHour > 22) {
        console.log(`🌙 Filtered out "${block.location}" - driver avoids night shifts`);
        return false;
      }
    }
    
    // Check work schedule
    if (!preferences.workSchedule.preferredDays.includes(currentDay)) {
      block.urgency = 'low'; // Downgrade urgency on non-preferred days
      console.log(`📅 Downgraded "${block.location}" - not a preferred work day`);
    }
    
    if (currentHour < preferences.workSchedule.preferredStartTime || 
        currentHour > preferences.workSchedule.preferredEndTime) {
      block.urgency = 'low'; // Downgrade urgency outside preferred hours
      console.log(`⏰ Downgraded "${block.location}" - outside preferred work hours`);
    }
    
    return true;
  });
  
  // Boost favorite spots
  const boosted = filtered.map((block) => {
    const locationLower = block.location?.toLowerCase() || '';
    
    // Boost favorite spots
    for (const favorite of preferences.favoriteSpots) {
      if (locationLower.includes(favorite.toLowerCase())) {
        block.urgency = 'high';
        block.reason = `${block.reason} ⭐ Your favorite spot!`;
        block.earningsPerHour = Math.round(block.earningsPerHour * 1.15); // 15% psychological boost
        console.log(`⭐ Boosted favorite spot: ${block.location}`);
      }
    }
    
    // Apply location preferences
    if (preferences.preferAirport && locationLower.includes('airport')) {
      block.urgency = 'high';
      block.reason = `${block.reason} ✈️ Airport preference matched!`;
      console.log(`✈️ Boosted airport location: ${block.location}`);
    }
    
    if (preferences.preferDowntown && 
        (locationLower.includes('downtown') || locationLower.includes('city center'))) {
      block.urgency = 'high';
      block.reason = `${block.reason} 🏙️ Downtown preference matched!`;
      console.log(`🏙️ Boosted downtown location: ${block.location}`);
    }
    
    // Vehicle-specific adjustments
    if (preferences.vehicleType === 'luxury' && block.surgeLevel >= 2) {
      block.earningsPerHour = Math.round(block.earningsPerHour * 1.25); // Luxury premium
      block.reason = `${block.reason} 💎 Luxury vehicle premium!`;
    }
    
    if (preferences.vehicleType === 'electric' && locationLower.includes('charging')) {
      block.urgency = 'medium';
      block.reason = `${block.reason} 🔋 Charging station nearby`;
    }
    
    if (preferences.vehicleType === 'suv' && locationLower.includes('airport')) {
      block.earningsPerHour = Math.round(block.earningsPerHour * 1.1); // SUV airport advantage
      block.reason = `${block.reason} 🚙 SUV advantage for luggage`;
    }
    
    return block;
  });
  
  console.log(`✅ [Preference Injection] Returned ${boosted.length} blocks after preference filtering`);
  return boosted;
};

// Learn from driver behavior
export const learnFromBehavior = (
  acceptedBlock: any,
  preferences: DriverPreferences
): DriverPreferences => {
  const updated = { ...preferences };
  
  // Learn from accepted drive times
  const driveTime = parseInt(acceptedBlock.driveTime?.replace(' min', '') || '0');
  if (driveTime > updated.maxDriveTime) {
    updated.maxDriveTime = Math.min(driveTime + 5, 30); // Gradually increase tolerance
    console.log(`📈 Learned: Driver accepts longer drives (up to ${updated.maxDriveTime} min)`);
  }
  
  // Learn from accepted earnings
  if (acceptedBlock.earningsPerHour < updated.minEarningsPerHour) {
    updated.minEarningsPerHour = Math.max(
      acceptedBlock.earningsPerHour - 2, 
      20
    ); // Gradually decrease threshold
    console.log(`📈 Learned: Driver accepts lower earnings ($${updated.minEarningsPerHour}/hr)`);
  }
  
  // Learn from surge acceptance
  if (acceptedBlock.surgeLevel < updated.preferredSurgeLevel) {
    updated.preferredSurgeLevel = Math.max(
      acceptedBlock.surgeLevel - 0.2,
      1.0
    ); // Gradually decrease surge requirement
    console.log(`📈 Learned: Driver accepts lower surge (${updated.preferredSurgeLevel}x)`);
  }
  
  // Learn location preferences
  const locationLower = acceptedBlock.location?.toLowerCase() || '';
  if (locationLower.includes('airport') && !updated.preferAirport) {
    updated.preferAirport = true;
    console.log(`📈 Learned: Driver prefers airport runs`);
  }
  
  if (locationLower.includes('downtown') && !updated.preferDowntown) {
    updated.preferDowntown = true;
    console.log(`📈 Learned: Driver prefers downtown areas`);
  }
  
  // Add to favorite spots if accepted multiple times
  const acceptCount = parseInt(localStorage.getItem(`accept-${acceptedBlock.location}`) || '0');
  localStorage.setItem(`accept-${acceptedBlock.location}`, String(acceptCount + 1));
  
  if (acceptCount >= 3 && !updated.favoriteSpots.includes(acceptedBlock.location)) {
    updated.favoriteSpots.push(acceptedBlock.location);
    console.log(`⭐ Added favorite spot: ${acceptedBlock.location}`);
  }
  
  // Save updated preferences
  saveDriverPreferences(updated);
  return updated;
};

// Get preference summary for UI display
export const getPreferenceSummary = (preferences: DriverPreferences): string => {
  const parts = [];
  
  if (preferences.maxDriveTime <= 10) parts.push('Short trips');
  else if (preferences.maxDriveTime >= 20) parts.push('Long trips OK');
  
  if (preferences.preferredSurgeLevel >= 2) parts.push('High surge only');
  else if (preferences.preferredSurgeLevel <= 1.2) parts.push('Any surge');
  
  if (preferences.preferAirport) parts.push('Airport runs');
  if (preferences.preferDowntown) parts.push('Downtown');
  if (preferences.avoidNightShifts) parts.push('Day shifts');
  
  if (preferences.vehicleType === 'luxury') parts.push('Luxury');
  else if (preferences.vehicleType === 'electric') parts.push('EV');
  
  return parts.join(' • ') || 'Standard preferences';
};