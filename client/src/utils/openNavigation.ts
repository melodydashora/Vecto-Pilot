/**
 * Platform-Smart Navigation Utility with Origin Resolution
 * Handles iOS/Android/Web deep links with database origin fetching and reverse geocoding
 */

import { getLatestLocationFromDB } from "@/services/locationService";
import { reverseGeocode } from "@/services/geocodeService";

export type LatLng = { lat: number; lng: number };

/**
 * Resolves the origin coordinates from database or current location context
 * Returns either an address string or coordinates, prioritizing human-readable addresses
 */
export async function resolveOrigin(): Promise<string | LatLng> {
  let coords: LatLng | null = null;

  // Try database first
  try {
    const dbLocation = await getLatestLocationFromDB();
    if (dbLocation?.lat && dbLocation?.lng) {
      coords = { lat: dbLocation.lat, lng: dbLocation.lng };
      console.log(`📍 Origin from DB: ${coords.lat}, ${coords.lng}`);
    }
  } catch (error) {
    console.warn("DB location unavailable:", error);
  }

  // Fallback to header context if available
  if (!coords && (window as any)?.headerContext?.currentLocation) {
    const headerLocation = (window as any).headerContext.currentLocation;
    if (headerLocation.latitude && headerLocation.longitude) {
      coords = { lat: headerLocation.latitude, lng: headerLocation.longitude };
      console.log(`📍 Origin from header context: ${coords.lat}, ${coords.lng}`);
    }
  }

  if (!coords) {
    throw new Error("No origin coordinates found");
  }

  // Try to reverse geocode to get human-readable address
  try {
    const address = await reverseGeocode(coords.lat, coords.lng);
    if (address) {
      console.log(`🏠 Origin resolved to address: ${address}`);
      return address;
    }
  } catch (error) {
    console.warn("Reverse geocoding failed, using coordinates:", error);
  }

  // Fallback to coordinates
  console.log(`📍 Using origin coordinates: ${coords.lat}, ${coords.lng}`);
  return coords;
}

/**
 * Opens platform-appropriate navigation with origin and destination
 */
export async function openNavigation({ 
  destination, 
  label 
}: { 
  destination: LatLng | string; 
  label?: string; 
}) {
  try {
    // Resolve origin (DB -> header context -> error)
    const origin = await resolveOrigin();

    // Format destination and origin for URLs
    const destStr = typeof destination === "string" 
      ? destination 
      : `${destination.lat},${destination.lng}`;
    
    const originStr = typeof origin === "string" 
      ? origin 
      : `${origin.lat},${origin.lng}`;

    console.log(`🧭 Navigation: ${originStr} → ${destStr}`);

    // Platform detection
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isAndroid = /Android/.test(ua);

    // Construct URLs
    const googleWebUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originStr)}&destination=${encodeURIComponent(destStr)}`;

    if (isIOS) {
      // iOS: Try Google Maps app, fallback to Apple Maps, then web
      const googleIOSUrl = `comgooglemaps://?saddr=${encodeURIComponent(originStr)}&daddr=${encodeURIComponent(destStr)}`;
      const appleIOSUrl = `maps://?saddr=${encodeURIComponent(originStr)}&daddr=${encodeURIComponent(destStr)}`;
      
      console.log(`🍎 iOS navigation: Google Maps -> Apple Maps -> Web`);
      
      // Try Google Maps first
      window.location.href = googleIOSUrl;
      
      // Fallback to Apple Maps after delay
      setTimeout(() => {
        console.log(`🍎 Fallback to Apple Maps`);
        window.location.href = appleIOSUrl;
      }, 800);
      
      // Final fallback to web
      setTimeout(() => {
        console.log(`🍎 Final fallback to web`);
        window.open(googleWebUrl, "_blank");
      }, 1600);
      
      return;
    }

    if (isAndroid) {
      // Android: Try Google Maps intent, fallback to web
      const androidNavUrl = `google.navigation:q=${encodeURIComponent(destStr)}`;
      
      console.log(`🤖 Android navigation: Google Maps intent -> Web`);
      
      // Try Google Maps intent
      window.location.href = androidNavUrl;
      
      // Fallback to web after delay
      setTimeout(() => {
        console.log(`🤖 Fallback to web`);
        window.open(googleWebUrl, "_blank");
      }, 1200);
      
      return;
    }

    // Desktop/Web: Direct to Google Maps
    console.log(`🖥️ Web navigation: Google Maps`);
    window.open(googleWebUrl, "_blank");

  } catch (error) {
    console.error("Navigation failed:", error);
    
    // Emergency fallback - basic destination-only navigation
    const destStr = typeof destination === "string" 
      ? destination 
      : `${destination.lat},${destination.lng}`;
    
    const fallbackUrl = `https://www.google.com/maps/search/${encodeURIComponent(destStr)}`;
    
    console.log(`🚨 Emergency fallback navigation`);
    window.open(fallbackUrl, "_blank");
  }
}

/**
 * Get current origin address for display purposes
 */
export async function getCurrentOriginAddress(): Promise<string> {
  try {
    const origin = await resolveOrigin();
    return typeof origin === "string" ? origin : `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`;
  } catch (error) {
    console.warn("Could not resolve current origin:", error);
    return "Current Location";
  }
}