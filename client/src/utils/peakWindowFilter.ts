// 📦 Crash-Proof Peak Window Filter – Phase 16: Smart Filtering
// 📂 File: src/utils/peakWindowFilter.ts
// 👤 Owner: VectoPilot Driver Intelligence Layer
// 🔒 Filters out broken or closed businesses during off-hours

interface BlockFilters {
  onlyDuringBusinessHours?: boolean;
  hideOnWeekend?: boolean;
  showOnlyInTime?: string;
}

interface TimeContext {
  timeLabel: string;
  isBusinessHours: boolean;
  isWeekend: boolean;
  hour: number;
  day: string;
}

export const crashProofFilter = (
  blocks: any[],
  timeContext: TimeContext
): any[] => {
  if (!blocks || blocks.length === 0) return [];

  console.log(`🛡️ [Peak Filter] Processing ${blocks.length} blocks at ${timeContext.timeLabel}`);

  const filtered = blocks.filter((block) => {
    // Skip filtering if no time restrictions
    if (!block.onlyDuringBusinessHours && 
        !block.hideOnWeekend && 
        !block.showOnlyInTime) {
      return true;
    }

    // Business hours filter (9 AM - 6 PM)
    if (block.onlyDuringBusinessHours && !timeContext.isBusinessHours) {
      console.log(`⏰ Filtered out "${block.location}" - outside business hours`);
      return false;
    }

    // Weekend filter
    if (block.hideOnWeekend && timeContext.isWeekend) {
      console.log(`📅 Filtered out "${block.location}" - hidden on weekends`);
      return false;
    }

    // Time-specific filter
    if (block.showOnlyInTime && block.showOnlyInTime !== timeContext.timeLabel) {
      console.log(`⏳ Filtered out "${block.location}" - only shows during ${block.showOnlyInTime}`);
      return false;
    }

    // Location-based peak window logic
    return applyLocationPeakLogic(block, timeContext);
  });

  console.log(`✅ [Peak Filter] Returned ${filtered.length} blocks after filtering`);
  return filtered;
};

// Apply location-specific peak window logic
const applyLocationPeakLogic = (block: any, timeContext: TimeContext): boolean => {
  const locationStr = block.location?.toLowerCase() || '';
  
  // Airport surge during morning rush (4 AM - 8 AM)
  if (locationStr.includes('airport') || locationStr.includes('dfw')) {
    if (timeContext.hour >= 4 && timeContext.hour < 8) {
      block.urgency = 'high'; // Boost priority
      block.reason = `${block.reason} 🚀 Morning airport rush hour!`;
      console.log(`✈️ Airport block boosted during morning rush`);
    }
  }

  // Restaurant districts during lunch/dinner
  if (locationStr.includes('restaurant') || locationStr.includes('dining')) {
    const isLunch = timeContext.hour >= 11 && timeContext.hour < 14;
    const isDinner = timeContext.hour >= 17 && timeContext.hour < 21;
    
    if (isLunch || isDinner) {
      block.urgency = 'high';
      block.reason = `${block.reason} 🍽️ Peak meal time!`;
      console.log(`🍴 Restaurant block boosted during meal hours`);
    } else if (timeContext.hour < 11 || timeContext.hour > 21) {
      // Filter out restaurants during off-hours
      console.log(`🚫 Restaurant filtered out during off-hours`);
      return false;
    }
  }

  // Nightlife venues after dark
  if (locationStr.includes('bar') || locationStr.includes('club') || locationStr.includes('nightlife')) {
    if (timeContext.hour < 20 && timeContext.hour > 4) {
      console.log(`🌙 Nightlife venue filtered out during daytime`);
      return false;
    }
    block.urgency = 'high';
    block.reason = `${block.reason} 🌃 Nightlife peak hours!`;
  }

  // Business districts during weekdays
  if (locationStr.includes('downtown') || locationStr.includes('financial')) {
    if (timeContext.isWeekend) {
      block.urgency = 'low';
      console.log(`🏢 Business district downgraded on weekend`);
    } else if (timeContext.isBusinessHours) {
      block.urgency = 'high';
      block.reason = `${block.reason} 💼 Business hours rush!`;
    }
  }

  // Shopping areas on weekends
  if (locationStr.includes('mall') || locationStr.includes('shopping')) {
    if (timeContext.isWeekend) {
      block.urgency = 'high';
      block.reason = `${block.reason} 🛍️ Weekend shopping rush!`;
    }
  }

  // School zones during pickup/dropoff
  if (locationStr.includes('school') || locationStr.includes('university')) {
    const isMorningDropoff = timeContext.hour >= 7 && timeContext.hour < 9;
    const isAfternoonPickup = timeContext.hour >= 14 && timeContext.hour < 16;
    
    if (isMorningDropoff || isAfternoonPickup) {
      block.urgency = 'high';
      block.reason = `${block.reason} 🎒 School rush hour!`;
    } else if (timeContext.hour >= 9 && timeContext.hour < 14) {
      // Filter out during class hours
      console.log(`🏫 School zone filtered during class hours`);
      return false;
    }
  }

  // Medical facilities during business hours
  if (locationStr.includes('hospital') || locationStr.includes('medical')) {
    if (timeContext.hour >= 8 && timeContext.hour < 17) {
      block.urgency = 'medium';
      block.reason = `${block.reason} 🏥 Medical appointment hours`;
    }
  }

  // Gas stations late at night for safety
  if (locationStr.includes('gas') || locationStr.includes('fuel')) {
    if (timeContext.timeLabel === 'late_night') {
      block.urgency = 'high';
      block.reason = `${block.reason} ⛽ Safe refuel location`;
    }
  }

  return true;
};

// Export for testing and external use
export const getPeakWindowStatus = (hour: number, day: string): string => {
  const isWeekend = day === 'Saturday' || day === 'Sunday';
  
  if (hour >= 4 && hour < 8) return 'morning_rush';
  if (hour >= 8 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'lunch_rush';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening_rush';
  if (hour >= 20 && hour < 23) return 'night';
  return 'late_night';
};