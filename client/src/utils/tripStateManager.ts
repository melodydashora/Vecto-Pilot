export type TripState = 'idle' | 'planning' | 'staging' | 'active' | 'ended';

interface GeolocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number | null;
  altitudeAccuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
}

let currentState: TripState = 'idle';
let originCoords: GeolocationCoordinates | null = null;

let stateTimestamps: Record<TripState, Date | null> = {
  idle: null,
  planning: null,
  staging: null,
  active: null,
  ended: null,
};

export const tripState = {
  get: (): TripState => currentState,

  set: (newState: TripState, coords: GeolocationCoordinates | null = null) => {
    const now = new Date();
    currentState = newState;
    stateTimestamps[newState] = now;

    if (newState === 'staging' && coords) {
      originCoords = coords;
    }

    if (newState === 'ended') {
      logTripDuration();
      promptTripFeedback();
    }

    console.log(`[TripManager] New State: ${newState} at ${now.toISOString()}`);
  },

  getOrigin: () => originCoords,

  getTimestamp: (state: TripState) => stateTimestamps[state],

  getIdleTime: () => {
    const stagingTime = stateTimestamps['staging'];
    const activeTime = stateTimestamps['active'];
    if (stagingTime && activeTime) {
      return (activeTime.getTime() - stagingTime.getTime()) / 1000;
    }
    return null;
  },

  getTripDuration: () => {
    const start = stateTimestamps['staging'];
    const end = stateTimestamps['ended'];
    if (start && end) {
      return (end.getTime() - start.getTime()) / 1000;
    }
    return null;
  },

  reset: () => {
    currentState = 'idle';
    originCoords = null;
    stateTimestamps = {
      idle: new Date(),
      planning: null,
      staging: null,
      active: null,
      ended: null,
    };
  }
};

function promptTripFeedback() {
  const lastBlock = localStorage.getItem('lastSmartBlock');
  const duration = tripState.getTripDuration();
  const idle = tripState.getIdleTime();

  console.log('[Mirror Feedback]', {
    block: lastBlock,
    idleSeconds: idle,
    tripDurationSeconds: duration,
  });

  const feedbackData = {
    timestamp: new Date().toISOString(),
    block: lastBlock,
    idleSeconds: idle,
    tripDurationSeconds: duration,
    origin: originCoords
  };
  
  localStorage.setItem('lastTripFeedback', JSON.stringify(feedbackData));
}

function logTripDuration() {
  const duration = tripState.getTripDuration();
  const idle = tripState.getIdleTime();
  
  console.log(`[Trip] Total Duration: ${duration}s`);
  console.log(`[Trip] Idle Time: ${idle}s`);
  
  const tripHistory = JSON.parse(localStorage.getItem('tripHistory') || '[]');
  tripHistory.push({
    date: new Date().toISOString(),
    duration,
    idle,
    origin: originCoords
  });
  
  if (tripHistory.length > 100) {
    tripHistory.shift();
  }
  
  localStorage.setItem('tripHistory', JSON.stringify(tripHistory));
}