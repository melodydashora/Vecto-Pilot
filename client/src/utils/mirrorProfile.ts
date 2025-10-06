// 🚦 Phase 16 – Mirror Integration: Adaptive Feedback Injection + Self-Tuning System Behavior
// Links user feedback and interaction patterns to subtle system behavior changes
// Creates a private learning profile tied to the driver

export type MirrorProfile = {
  id: string;
  preferences: {
    noGoZones: string[];
    preferredService: string[];
    avoidsTeenPickups: boolean;
    stagingTolerance: number; // seconds
  };
  personality: 'direct' | 'subtle' | 'tactical' | 'quiet';
  tone: 'professional' | 'lighthearted' | 'minimal' | 'assertive';
  aiMood: 'focused' | 'supportive' | 'strategic' | 'observant';
};

const defaultProfile: MirrorProfile = {
  id: 'default-driver',
  preferences: {
    noGoZones: [],
    preferredService: ['Comfort', 'X'],
    avoidsTeenPickups: true,
    stagingTolerance: 180,
  },
  personality: 'tactical',
  tone: 'professional',
  aiMood: 'focused',
};

let profile: MirrorProfile = defaultProfile;

export const mirrorProfile = {
  get: () => profile,
  
  set: (newData: Partial<MirrorProfile>) => {
    profile = { ...profile, ...newData };
    localStorage.setItem('mirror_profile', JSON.stringify(profile));
    console.log('[Mirror Profile Updated]', profile);
  },
  
  load: () => {
    const cached = localStorage.getItem('mirror_profile');
    if (cached) {
      try {
        profile = JSON.parse(cached);
        console.log('[Mirror Profile Loaded]', profile);
      } catch (e) {
        console.error('[Mirror Profile] Failed to parse cached profile', e);
      }
    }
  },
  
  // Update preferences based on feedback
  updateFromFeedback: (feedback: string, blockName?: string) => {
    const lowerFeedback = feedback.toLowerCase();
    
    if (lowerFeedback.includes('too slow') || lowerFeedback.includes('took forever')) {
      mirrorProfile.set({
        preferences: { ...profile.preferences, stagingTolerance: 60 },
        aiMood: 'strategic',
      });
    }
    
    if (lowerFeedback.includes('perfect') || lowerFeedback.includes('great')) {
      mirrorProfile.set({ aiMood: 'supportive' });
    }
    
    if (lowerFeedback.includes('too far') && blockName) {
      // Add to personal no-go zones if consistently complained about
      const currentNoGo = profile.preferences.noGoZones;
      if (!currentNoGo.includes(blockName)) {
        mirrorProfile.set({
          preferences: { 
            ...profile.preferences, 
            noGoZones: [...currentNoGo, blockName] 
          },
        });
      }
    }
    
    if (lowerFeedback.includes('quiet') || lowerFeedback.includes('less talk')) {
      mirrorProfile.set({ 
        personality: 'quiet',
        tone: 'minimal' 
      });
    }
  }
};

// Load profile on initialization
mirrorProfile.load();