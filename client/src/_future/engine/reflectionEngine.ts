// 🚨 Phase 17 – Mirror Uncaged: Internal Reflection Engine
// Learns from user interaction, trip patterns, block feedback, and context entropy.
// Injects long-form memory into behavioral response and future block suggestions.

export type ReflectionEntry = {
  timestamp: string;
  smartBlock: string;
  idleTime: number | null;
  tripDuration: number | null;
  driverMode: 'comfort' | 'commercial' | 'standard';
  locationZone: string;
  resultRating?: number; // 1-5, prompted optionally
  feedback?: string; // text feedback
};

let mirrorLog: ReflectionEntry[] = [];

export const reflectionEngine = {
  record: (entry: ReflectionEntry) => {
    mirrorLog.push(entry);
    console.log('[Mirror Recorded]', entry);

    // Store to local persistence
    localStorage.setItem('mirrorMemory', JSON.stringify(mirrorLog));
    
    // Keep only last 100 entries to avoid bloat
    if (mirrorLog.length > 100) {
      mirrorLog = mirrorLog.slice(-100);
      localStorage.setItem('mirrorMemory', JSON.stringify(mirrorLog));
    }
  },

  recent: (count = 5): ReflectionEntry[] => {
    return mirrorLog.slice(-count);
  },

  analyze: () => {
    // Detect repeated staging zones with low ratings
    const dangerZones = mirrorLog
      .filter(e => e.resultRating && e.resultRating <= 2)
      .map(e => e.locationZone);

    const frequency: Record<string, number> = {};
    dangerZones.forEach(zone => {
      frequency[zone] = (frequency[zone] || 0) + 1;
    });

    // Return zones that have been rated poorly 3+ times
    const problematicZones = Object.entries(frequency)
      .filter(([_, count]) => count >= 3)
      .map(([zone]) => zone);
      
    // Analyze average idle times by zone
    const zoneIdleTimes: Record<string, number[]> = {};
    mirrorLog.forEach(entry => {
      if (entry.idleTime !== null) {
        if (!zoneIdleTimes[entry.locationZone]) {
          zoneIdleTimes[entry.locationZone] = [];
        }
        zoneIdleTimes[entry.locationZone].push(entry.idleTime);
      }
    });
    
    const avgIdleByZone = Object.entries(zoneIdleTimes).reduce((acc, [zone, times]) => {
      acc[zone] = times.reduce((sum, t) => sum + t, 0) / times.length;
      return acc;
    }, {} as Record<string, number>);
    
    // Identify high-performing blocks
    const goodBlocks = mirrorLog
      .filter(e => e.resultRating && e.resultRating >= 4)
      .map(e => e.smartBlock);
      
    const blockFrequency: Record<string, number> = {};
    goodBlocks.forEach(block => {
      blockFrequency[block] = (blockFrequency[block] || 0) + 1;
    });
    
    const topPerformers = Object.entries(blockFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([block]) => block);

    return {
      problematicZones,
      avgIdleByZone,
      topPerformers,
      totalTrips: mirrorLog.length,
      avgRating: mirrorLog
        .filter(e => e.resultRating)
        .reduce((sum, e) => sum + (e.resultRating || 0), 0) / 
        mirrorLog.filter(e => e.resultRating).length || 0
    };
  },
  
  // Load persisted memory on initialization
  load: () => {
    const cached = localStorage.getItem('mirrorMemory');
    if (cached) {
      try {
        mirrorLog = JSON.parse(cached);
        console.log(`[Reflection Engine] Loaded ${mirrorLog.length} reflection entries`);
      } catch (e) {
        console.error('[Reflection Engine] Failed to parse cached memory', e);
        mirrorLog = [];
      }
    }
  },
  
  // Get suggestions based on patterns
  getSuggestions: () => {
    const analysis = reflectionEngine.analyze();
    const suggestions: string[] = [];
    
    if (analysis.problematicZones.length > 0) {
      suggestions.push(`Avoid these zones: ${analysis.problematicZones.join(', ')}`);
    }
    
    if (analysis.topPerformers.length > 0) {
      suggestions.push(`Focus on these high-performers: ${analysis.topPerformers.slice(0, 3).join(', ')}`);
    }
    
    // Suggest zones with low idle times
    const fastZones = Object.entries(analysis.avgIdleByZone)
      .filter(([_, time]) => time < 120) // Less than 2 minutes average
      .map(([zone]) => zone);
      
    if (fastZones.length > 0) {
      suggestions.push(`Quick pickups at: ${fastZones.slice(0, 3).join(', ')}`);
    }
    
    return suggestions;
  }
};

// Load reflection memory on initialization
reflectionEngine.load();