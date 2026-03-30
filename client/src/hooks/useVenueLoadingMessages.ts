// client/src/hooks/useVenueLoadingMessages.ts
// Provides cycling detailed messages during venue/blocks generation
// Shows what's happening during Places API calls, enrichment, etc.

import { useState, useEffect, useMemo } from 'react';
import type { PipelinePhase } from '@/types/co-pilot';

interface LoadingMessage {
  icon: string;
  text: string;
}

// Default fallback message
const DEFAULT_MESSAGE: LoadingMessage = { icon: '⏳', text: 'Processing venues...' };

// Detailed sub-messages for venue-related phases
const PHASE_MESSAGES: Record<string, LoadingMessage[]> = {
  // Strategy phases (shouldn't show in venue loader, but just in case)
  starting: [
    { icon: '🚀', text: 'Starting pipeline...' },
  ],
  resolving: [
    { icon: '📍', text: 'Resolving location...' },
  ],
  analyzing: [
    { icon: '🔍', text: 'Analyzing area...' },
  ],
  immediate: [
    { icon: '🤖', text: 'AI processing...' },
  ],
  // Venue-specific phases with detailed messages
  // SmartBlocks phases: venues → routing → places → verifying → complete
  venues: [
    { icon: '🤖', text: 'GPT-5.2 tactical planner analyzing your area...' },
    { icon: '🏢', text: 'Identifying high-value venue categories...' },
    { icon: '🎯', text: 'Selecting optimal pickup locations...' },
    { icon: '⭐', text: 'Ranking venues by rideshare potential...' },
    { icon: '📍', text: 'Building venue recommendation list...' },
  ],
  routing: [
    { icon: '🚗', text: 'Calling Google Routes API for drive times...' },
    { icon: '📊', text: 'Calculating distance from your location...' },
    { icon: '⏱️', text: 'Computing travel times with traffic...' },
    { icon: '💰', text: 'Estimating value per minute metrics...' },
  ],
  places: [
    { icon: '📍', text: 'Looking up venue details from Places API...' },
    { icon: '🕐', text: 'Fetching business hours and ratings...' },
    { icon: '📞', text: 'Getting contact info and addresses...' },
    { icon: '🎪', text: 'Matching venues to local events...' },
  ],
  verifying: [
    { icon: '🔍', text: 'Gemini verifying event information...' },
    { icon: '✅', text: 'Cross-checking venue details...' },
    { icon: '🏷️', text: 'Assigning venue grades (A/B/C)...' },
    { icon: '✨', text: 'Finalizing Smart Block recommendations...' },
  ],
  enriching: [
    { icon: '🚗', text: 'Calling Routes API for drive times...' },
    { icon: '📊', text: 'Calculating distance from your location...' },
    { icon: '💰', text: 'Estimating earnings potential per venue...' },
    { icon: '⏱️', text: 'Computing value per minute metrics...' },
    { icon: '🕐', text: 'Checking venue business hours...' },
    { icon: '📞', text: 'Fetching venue contact details...' },
    { icon: '🏷️', text: 'Grading venues by value (A/B/C)...' },
    { icon: '✨', text: 'Finalizing Smart Block recommendations...' },
  ],
  complete: [
    { icon: '✅', text: 'Venues ready!' },
  ],
};

// Phase titles for the badge
const PHASE_BADGES: Record<string, string> = {
  starting: 'Starting',
  resolving: 'Location',
  analyzing: 'Analyzing',
  immediate: 'AI Processing',
  venues: 'Tactical Planner',
  routing: 'Routes API',
  places: 'Places API',
  verifying: 'Verifying',
  enriching: 'Enriching Data',
  complete: 'Complete',
};

// Default phase info
const DEFAULT_BADGE = 'Processing';

export function useVenueLoadingMessages(pipelinePhase: PipelinePhase | undefined | null) {
  const [messageIndex, setMessageIndex] = useState(0);

  // Normalize phase
  const normalizedPhase = pipelinePhase || 'venues';

  // Get messages for current phase
  const messages = useMemo(() => {
    const phaseMessages = PHASE_MESSAGES[normalizedPhase];
    if (phaseMessages && phaseMessages.length > 0) {
      return phaseMessages;
    }
    return PHASE_MESSAGES.venues;
  }, [normalizedPhase]);

  // Get badge text
  const badge = useMemo(() => {
    return PHASE_BADGES[normalizedPhase] || DEFAULT_BADGE;
  }, [normalizedPhase]);

  // Cycle through messages every 2 seconds (faster than strategy since these are more granular)
  useEffect(() => {
    if (messages.length <= 1) return;

    const interval = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % messages.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [messages.length]);

  // Reset index when phase changes
  useEffect(() => {
    setMessageIndex(0);
  }, [normalizedPhase]);

  // Safely get current message
  const currentMessage = messages[messageIndex] || DEFAULT_MESSAGE;

  return {
    icon: currentMessage.icon,
    text: currentMessage.text,
    badge,
    messageCount: messages.length,
    currentIndex: messageIndex,
    phase: normalizedPhase,
  };
}
