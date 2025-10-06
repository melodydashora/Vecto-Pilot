// VectoPilot Profile Hook
// Manages user profile data across the app

import { useState, useEffect } from 'react';

export interface VPVehicle {
  year?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
}

export interface VPUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  vehicle?: VPVehicle;
  appsUsed?: string[];
  termsAccepted?: boolean;
  marketingOptIn?: boolean;
  // Driver profile from database
  driverProfile?: {
    vehicleMpg?: string | null;
    rideTypes?: string[];
    baseLocation?: string | null;
    noGoZones?: string[];
    preferredHours?: string | null;
    dailyEarningsGoal?: string | null;
    hourlyEarningsGoal?: string | null;
    tripPreferences?: string[];
  } | null;
}

declare global {
  interface Window {
    vp?: {
      user?: VPUser;
      vehicleClass?: string;
      updateProfile?: (updates: Partial<VPUser>) => Promise<boolean>;
    };
  }
}

export function useVectoPilotProfile() {
  const [user, setUser] = useState<VPUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Function to fetch complete profile from database
  const fetchCompleteProfile = async (): Promise<VPUser | null> => {
    try {
      console.log('📡 Making complete profile API request...');
      const response = await fetch('/api/user/complete-profile', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('📈 Complete profile API response status:', response.status);

      if (response.ok) {
        const completeProfile = await response.json();
        console.log('✅ Complete profile data received:', completeProfile.firstName);
        
        // Map the complete profile to VPUser format
        return {
          id: completeProfile.id,
          email: completeProfile.email,
          firstName: completeProfile.firstName,
          lastName: completeProfile.lastName,
          vehicle: completeProfile.vehicle,
          appsUsed: completeProfile.appsUsed || [],
          termsAccepted: completeProfile.termsAccepted || false,
          marketingOptIn: completeProfile.marketingOptIn || false,
          // Include driver profile data for future use
          driverProfile: completeProfile.driverProfile
        };
      } else {
        const errorText = await response.text();
        console.error('❌ Complete profile API failed:', response.status, errorText);
      }
      return null;
    } catch (error) {
      console.error('💥 Failed to fetch complete profile:', error);
      return null;
    }
  };

  // Function to parse JWT token to extract user data
  const parseJWTUserData = (token: string): VPUser | null => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return {
        id: payload.id?.toString() || '',
        email: payload.email || '',
        firstName: payload.firstName || null,
        lastName: payload.lastName || null,
        vehicle: payload.vehicle || null,
        appsUsed: payload.appsUsed || [],
        termsAccepted: payload.termsAccepted || false,
        marketingOptIn: payload.marketingOptIn || false,
      };
    } catch (err) {
      console.error('Failed to parse JWT token:', err);
      return null;
    }
  };

  // Function to get cookie value
  const getCookie = (name: string): string | null => {
    if (typeof document === 'undefined') return null;
    
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      const cookieValue = parts.pop()?.split(';').shift() || null;
      console.log(`🍪 Cookie '${name}':`, cookieValue ? 'found' : 'not found');
      return cookieValue;
    }
    console.log(`🍪 Cookie '${name}': not found in document.cookie`);
    console.log('🍪 All cookies:', document.cookie);
    return null;
  };

  useEffect(() => {
    console.log('🔄 VectoPilot Profile Hook initializing...');
    
    // Since browser cookies aren't accessible via document.cookie,
    // directly try to fetch the profile using the API with credentials
    console.log('📡 Attempting to fetch profile via API with credentials...');
    
    fetchCompleteProfile()
      .then(completeProfile => {
        if (completeProfile) {
          console.log('✅ Complete profile loaded via API:', completeProfile.firstName);
          setUser(completeProfile);
          setIsAuthenticated(true);
          setLoading(false);
          return;
        }
        
        console.log('⚠️ API authentication failed, trying cookie fallback...');
        
        // Fallback: Try to get authentication token from cookie
        const authToken = getCookie('auth_token');
        console.log('🔐 Auth token found in cookies:', !!authToken);
        
        if (authToken) {
          // Fallback to JWT data if API fails
          const userData = parseJWTUserData(authToken);
          if (userData) {
            console.log('✅ JWT profile loaded:', userData.firstName);
            setUser(userData);
            setIsAuthenticated(true);
            setLoading(false);
            return;
          }
        }
        
        console.log('⚠️ No authentication found, checking localStorage...');
        // Further fallback to localStorage for VectoPilot profile system
        const token = localStorage.getItem('vp_access');
        const cachedUser = localStorage.getItem('vp_user');
        
        if (token && cachedUser) {
          try {
            const userData = JSON.parse(cachedUser);
            console.log('✅ localStorage profile loaded:', userData.firstName);
            setUser(userData);
            setIsAuthenticated(true);
          } catch (err) {
            console.error('Failed to parse cached user:', err);
          }
        }
        
        setLoading(false);
      })
      .catch(err => {
        console.error('💥 Failed to fetch complete profile:', err);
        setLoading(false);
      });

    // Listen for profile updates from init-profile.js
    const handleProfileLoaded = (e: CustomEvent) => {
      setUser(e.detail);
      setIsAuthenticated(true);
    };

    const handleProfileUpdated = (e: CustomEvent) => {
      setUser(e.detail);
    };

    window.addEventListener('vp-profile-loaded' as any, handleProfileLoaded);
    window.addEventListener('vp-profile-updated' as any, handleProfileUpdated);

    // Listen for storage changes (cross-tab sync)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'vp_user' && e.newValue) {
        try {
          const userData = JSON.parse(e.newValue);
          setUser(userData);
          setIsAuthenticated(true);
        } catch (err) {
          console.error('Failed to parse user from storage:', err);
        }
      } else if (e.key === 'vp_access' && !e.newValue) {
        // Token removed - user logged out
        setUser(null);
        setIsAuthenticated(false);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('vp-profile-loaded' as any, handleProfileLoaded);
      window.removeEventListener('vp-profile-updated' as any, handleProfileUpdated);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const updateProfile = async (updates: Partial<VPUser>): Promise<boolean> => {
    try {
      if (!user) {
        console.error('No user found for profile update');
        return false;
      }
      
      console.log('🔄 Attempting profile update:', updates);
      console.log('🔐 Authentication status:', isAuthenticated);
      
      // Try to update in database if authenticated
      if (isAuthenticated) {
        console.log('📡 Making API request to /api/user/update-profile');
        const response = await fetch('/api/user/update-profile', {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updates)
        });
        
        console.log('📈 API Response status:', response.status);
        
        if (response.ok) {
          const updatedProfile = await response.json();
          setUser(updatedProfile);
          console.log('✅ Profile updated in database:', updatedProfile.firstName);
          return true;
        } else {
          const errorText = await response.text();
          console.error('❌ Failed to update profile in database:', response.status, errorText);
          return false;
        }
      }
      
      console.log('💾 Falling back to localStorage update');
      // Fallback to localStorage update
      const updatedUser = { ...user, ...updates };
      setUser(updatedUser);
      localStorage.setItem('vp_user', JSON.stringify(updatedUser));
      
      return true;
    } catch (error) {
      console.error('💥 Error updating profile:', error);
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem('vp_access');
    localStorage.removeItem('vp_user');
    setUser(null);
    setIsAuthenticated(false);
    window.location.href = '/auth/signin.html';
  };

  const getVehicleLabel = (): string => {
    if (!user?.vehicle) return 'Vehicle not set';
    const { year, make, model, color } = user.vehicle;
    return [year, make, model, color].filter(Boolean).join(' ') || 'Vehicle not set';
  };

  const getVehicleClass = (): string => {
    if (!user?.vehicle) return 'standard';
    
    const { make, model } = user.vehicle;
    const fullName = `${make || ''} ${model || ''}`.toLowerCase();
    
    if (/tesla|bmw|mercedes|audi|lexus|cadillac|porsche|jaguar/.test(fullName)) {
      return 'luxury';
    }
    if (/suv|explorer|tahoe|suburban|pilot|highlander|traverse/.test(fullName)) {
      return 'suv';
    }
    if (/tesla|bolt|leaf|ioniq|id\.4|mach-e|polestar/.test(fullName)) {
      return 'electric';
    }
    return 'standard';
  };

  const getDisplayName = (): string => {
    return user?.firstName || 'Driver';
  };

  const getInitials = (): string => {
    const first = user?.firstName?.[0] || 'D';
    const last = user?.lastName?.[0] || '';
    return (first + last).toUpperCase();
  };

  return {
    user,
    loading,
    isAuthenticated,
    updateProfile,
    logout,
    getVehicleLabel,
    getVehicleClass,
    getDisplayName,
    getInitials,
  };
}