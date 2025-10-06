import { latLngToCell, cellToLatLng, gridDistance } from 'h3-js';

export function scoreCandidate(venue, context) {
  const proximityBand = calculateProximityBand(venue, context);
  const reliability = venue.reliability_score ?? 0.5;
  const eventBoost = venue.event_intensity ?? 0;
  const openProb = venue.open_now_prob ?? 0.5;
  const personalBoost = calculatePersonalizationBoost(venue, context);
  
  return 2.0 * proximityBand + 1.2 * reliability + 0.6 * eventBoost + 0.8 * openProb + personalBoost;
}

function calculateProximityBand(venue, context) {
  if (!venue.lat || !venue.lng || !context.lat || !context.lng) {
    return 0.3;
  }
  
  try {
    const driverH3 = latLngToCell(context.lat, context.lng, 8);
    const venueH3 = latLngToCell(venue.lat, venue.lng, 8);
    const distance = gridDistance(driverH3, venueH3);
    
    if (distance === 0) return 1.0;
    if (distance === 1) return 0.8;
    if (distance === 2) return 0.6;
    if (distance <= 4) return 0.4;
    return 0.2;
  } catch (err) {
    console.error('H3 distance calculation error:', err);
    return 0.3;
  }
}

function calculatePersonalizationBoost(venue, context) {
  if (!context.driverProfile) return 0;
  
  let boost = 0;
  
  if (context.driverProfile.preferredCategories?.includes(venue.category)) {
    boost += 0.2;
  }
  
  if (venue.staging_notes?.type && context.driverProfile.preferredStagingTypes?.includes(venue.staging_notes.type)) {
    boost += 0.1;
  }
  
  if (context.driverProfile.successfulVenues?.includes(venue.venue_id)) {
    boost += 0.3;
  }
  
  return Math.min(boost, 0.5);
}

export function applyDiversityGuardrails(sortedCandidates, context = {}) {
  const picked = [];
  const seenCategories = new Set();
  const seenH3Distances = new Set();
  
  for (const candidate of sortedCandidates) {
    if (picked.length === 0) {
      picked.push(candidate);
      seenCategories.add(candidate.category);
      if (candidate.h3_distance !== undefined) seenH3Distances.add(candidate.h3_distance);
      continue;
    }
    
    if (picked.length >= 5) break;
    
    const categoryOK = !seenCategories.has(candidate.category) || picked.length >= 3;
    const localityOK = candidate.h3_distance === undefined || 
                       !seenH3Distances.has(candidate.h3_distance) || 
                       picked.length >= 2;
    
    if (categoryOK && localityOK) {
      picked.push(candidate);
      seenCategories.add(candidate.category);
      if (candidate.h3_distance !== undefined) seenH3Distances.add(candidate.h3_distance);
    }
  }
  
  if (picked.length < 5 && Math.random() < 0.2) {
    const exploratory = findExploratoryCandidate(sortedCandidates, picked);
    if (exploratory) {
      picked.push(exploratory);
    }
  }
  
  return picked.slice(0, 5);
}

function findExploratoryCandidate(allCandidates, picked) {
  const pickedIds = new Set(picked.map(p => p.venue_id));
  const unexplored = allCandidates.filter(c => !pickedIds.has(c.venue_id));
  
  if (unexplored.length === 0) return null;
  
  const nearbyUnexplored = unexplored.filter(c => c.h3_distance <= 2);
  if (nearbyUnexplored.length > 0) {
    return nearbyUnexplored[Math.floor(Math.random() * nearbyUnexplored.length)];
  }
  
  return unexplored[Math.floor(Math.random() * Math.min(5, unexplored.length))];
}

export function enrichCandidateWithH3Distance(candidate, driverLat, driverLng) {
  if (!candidate.lat || !candidate.lng || !driverLat || !driverLng) {
    return { ...candidate, h3_distance: 999 };
  }
  
  try {
    const driverH3 = latLngToCell(driverLat, driverLng, 8);
    const venueH3 = latLngToCell(candidate.lat, candidate.lng, 8);
    const distance = gridDistance(driverH3, venueH3);
    return { ...candidate, h3_distance: distance };
  } catch (err) {
    console.error('H3 enrichment error:', err);
    return { ...candidate, h3_distance: 999 };
  }
}
