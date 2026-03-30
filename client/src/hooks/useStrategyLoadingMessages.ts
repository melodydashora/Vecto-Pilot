// client/src/hooks/useStrategyLoadingMessages.ts
// Provides cycling detailed messages during strategy generation
// Makes the loading experience feel more active and informative

import { useState, useEffect, useMemo } from 'react';
import type { PipelinePhase } from '@/types/co-pilot';

interface LoadingMessage {
  icon: string;
  text: string;
}

// Default fallback message
const DEFAULT_MESSAGE: LoadingMessage = { icon: '⏳', text: 'Processing...' };

// Detailed sub-messages for each phase
const PHASE_MESSAGES: Record<string, LoadingMessage[]> = {
  starting: [
    { icon: '🚀', text: 'Initializing AI pipeline...' },
    { icon: '⚡', text: 'Connecting to intelligence services...' },
    { icon: '🔌', text: 'Establishing secure connection...' },
  ],
  resolving: [
    { icon: '📍', text: 'Pinpointing your exact location...' },
    { icon: '🗺️', text: 'Identifying your city and neighborhood...' },
    { icon: '🌡️', text: 'Checking local weather conditions...' },
    { icon: '🕐', text: 'Detecting timezone and local time...' },
    { icon: '📅', text: 'Checking for holidays and special events...' },
  ],
  analyzing: [
    { icon: '🚗', text: 'Checking real-time traffic conditions...' },
    { icon: '🎉', text: 'Searching for local events and concerts...' },
    { icon: '🏟️', text: 'Looking for sports games and venues...' },
    { icon: '📰', text: 'Scanning rideshare news and trends...' },
    { icon: '🌃', text: 'Analyzing nightlife activity patterns...' },
    { icon: '✈️', text: 'Checking airport and travel demand...' },
    { icon: '🍽️', text: 'Identifying busy restaurant districts...' },
    { icon: '📊', text: 'Gathering surge pricing data...' },
  ],
  immediate: [
    { icon: '🤖', text: 'Sending data to AI for analysis...' },
    { icon: '🧠', text: 'AI is processing your area intel...' },
    { icon: '💡', text: 'Generating personalized insights...' },
    { icon: '📝', text: 'Crafting your tactical strategy...' },
    { icon: '⚡', text: 'Optimizing recommendations...' },
    { icon: '🔄', text: 'Consolidating all intelligence...' },
    { icon: '✨', text: 'Finalizing your strategy...' },
  ],
  // Venue phases - strategy card may still be visible during transition
  venues: [
    { icon: '🏢', text: 'Strategy ready! Finding optimal venues...' },
    { icon: '🔍', text: 'Searching nearby high-value locations...' },
  ],
  enriching: [
    { icon: '📊', text: 'Enriching venue data with routes...' },
    { icon: '🚗', text: 'Calculating drive times...' },
  ],
  complete: [
    { icon: '✅', text: 'All done! Strategy and venues ready.' },
  ],
};

// Phase titles and step info (7 phases total for full pipeline)
const PHASE_INFO: Record<string, { title: string; step: string; badge: string }> = {
  starting: { title: 'Initializing', step: 'Step 1/7: Starting', badge: 'Starting' },
  resolving: { title: 'Examining Location', step: 'Step 2/7: Location', badge: 'Location' },
  analyzing: { title: 'Gathering Intel', step: 'Step 3/7: Research', badge: 'Researching' },
  immediate: { title: 'AI Analysis', step: 'Step 4/7: AI Processing', badge: 'AI Processing' },
  venues: { title: 'Finding Venues', step: 'Step 5/7: Venues', badge: 'Venues' },
  enriching: { title: 'Enriching Data', step: 'Step 6/7: Enriching', badge: 'Enriching' },
  complete: { title: 'Complete', step: 'Step 7/7: Complete', badge: 'Done' },
};

// Default phase info fallback
const DEFAULT_PHASE_INFO = { title: 'Loading', step: 'Processing...', badge: 'Loading' };

interface UseStrategyLoadingMessagesOptions {
  pipelinePhase: PipelinePhase | undefined | null;
  timeRemainingText?: string | null;
}

export function useStrategyLoadingMessages(
  pipelinePhaseOrOptions: PipelinePhase | undefined | null | UseStrategyLoadingMessagesOptions
) {
  const [messageIndex, setMessageIndex] = useState(0);

  // Support both old signature (just phase) and new signature (options object)
  const options = typeof pipelinePhaseOrOptions === 'object' && pipelinePhaseOrOptions !== null && 'pipelinePhase' in pipelinePhaseOrOptions
    ? pipelinePhaseOrOptions
    : { pipelinePhase: pipelinePhaseOrOptions as PipelinePhase | undefined | null, timeRemainingText: null };

  const { pipelinePhase, timeRemainingText } = options;

  // Normalize phase - default to 'starting' if undefined/null
  const normalizedPhase = pipelinePhase || 'starting';

  // Get messages for current phase with safe fallback
  const messages = useMemo(() => {
    const phaseMessages = PHASE_MESSAGES[normalizedPhase];
    if (phaseMessages && phaseMessages.length > 0) {
      return phaseMessages;
    }
    return PHASE_MESSAGES.starting;
  }, [normalizedPhase]);

  // Get phase info with safe fallback
  const phaseInfo = useMemo(() => {
    return PHASE_INFO[normalizedPhase] || DEFAULT_PHASE_INFO;
  }, [normalizedPhase]);

  // Cycle through messages every 2.5 seconds
  useEffect(() => {
    if (messages.length <= 1) return; // Don't cycle if only one message

    const interval = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % messages.length);
    }, 2500);

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
    title: phaseInfo.title,
    step: phaseInfo.step,
    badge: phaseInfo.badge,
    messageCount: messages.length,
    currentIndex: messageIndex,
    timeRemaining: timeRemainingText || null,
  };
}
