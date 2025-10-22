import { useState, useEffect } from 'react';
import { useVectoPilotProfile } from './useVectoPilotProfile';

export interface UserProfile {
  name: string;
  car: string;
  traits: string[];
  interactionStyle: 'adaptive' | 'neutral' | 'formal';
  responseDepth: number;
}

export const useProfile = () => {
  const { user: vpUser } = useVectoPilotProfile();
  
  const [profile, setProfile] = useState<UserProfile>({
    name: vpUser?.firstName || 'Driver',
    car: vpUser?.vehicle ? `${vpUser.vehicle.year || ''} ${vpUser.vehicle.make || ''} ${vpUser.vehicle.model || ''}`.trim() || 'unknown' : 'unknown',
    traits: [],
    interactionStyle: 'adaptive',  // Options: adaptive, neutral, formal
    responseDepth: 2               // Controls how reflective or direct responses are
  });

  // Update profile when VectoPilot user data changes
  useEffect(() => {
    if (vpUser) {
      setProfile(prev => ({
        ...prev,
        name: vpUser.firstName || 'Driver',
        car: vpUser.vehicle ? `${vpUser.vehicle.year || ''} ${vpUser.vehicle.make || ''} ${vpUser.vehicle.model || ''}`.trim() || 'unknown' : 'unknown'
      }));
    }
  }, [vpUser]);

  useEffect(() => {
    const cached = localStorage.getItem('vecto-profile');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // Merge localStorage preferences with real user data
        setProfile(prev => ({
          ...prev,
          interactionStyle: parsed.interactionStyle || 'adaptive',
          responseDepth: parsed.responseDepth || 2,
          traits: parsed.traits || []
        }));
      } catch (error) {
        console.error('Failed to parse profile from localStorage:', error);
      }
    }
  }, []);

  useEffect(() => {
    // Only save preferences to localStorage, not real user data
    const preferencesToSave = {
      interactionStyle: profile.interactionStyle,
      responseDepth: profile.responseDepth,
      traits: profile.traits
    };
    localStorage.setItem('vecto-profile', JSON.stringify(preferencesToSave));
  }, [profile.interactionStyle, profile.responseDepth, profile.traits]);

  return { profile, setProfile };
};