import { useProfile } from '@/hooks/useProfile';

export interface DriverProfile {
  name?: string;
  vehicle?: string;
  experienceLevel?: 'beginner' | 'intermediate' | 'expert';
  intelligenceLevel?: 'adaptive' | 'neutral' | 'formal';
  interactionStyle?: 'adaptive' | 'neutral' | 'formal';
}

export const engageMirror = (driverProfile: DriverProfile | null): string => {
  if (!driverProfile) {
    return 'Mirror Off: No driver profile detected. Configure your profile to enable adaptive recommendations.';
  }

  if (driverProfile.intelligenceLevel === 'adaptive' || driverProfile.interactionStyle === 'adaptive') {
    const possessiveName = driverProfile.name ? `${driverProfile.name}'s` : 'your';
    return `Mirror On: Calibrating environment based on ${possessiveName} driving style. Learning patterns from your ${driverProfile.vehicle || 'vehicle'} preferences.`;
  }
  
  if (driverProfile.interactionStyle === 'formal') {
    return 'Mirror Mode: Professional recommendation mode active.';
  }
  
  return 'Mirror Off: Static recommendation mode. Enable adaptive mode in your profile for personalized suggestions.';
};

export const getMirrorStatus = (driverProfile: DriverProfile | null): {
  active: boolean;
  message: string;
  adaptiveLevel: 'high' | 'medium' | 'low' | 'off';
} => {
  const message = engageMirror(driverProfile);
  const isAdaptive = driverProfile?.intelligenceLevel === 'adaptive' || driverProfile?.interactionStyle === 'adaptive';
  
  let adaptiveLevel: 'high' | 'medium' | 'low' | 'off' = 'off';
  if (isAdaptive && driverProfile?.experienceLevel === 'expert') {
    adaptiveLevel = 'high';
  } else if (isAdaptive) {
    adaptiveLevel = 'medium';
  } else if (driverProfile?.interactionStyle === 'formal') {
    adaptiveLevel = 'low';
  }
  
  return {
    active: isAdaptive,
    message,
    adaptiveLevel
  };
};