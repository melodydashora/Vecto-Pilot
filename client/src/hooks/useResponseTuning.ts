import { useProfile } from '@/hooks/useProfile';
import { useVectoPilotProfile } from '@/hooks/useVectoPilotProfile';

export const useResponseTuning = () => {
  const { profile } = useProfile();
  const { user: vpUser, getDisplayName } = useVectoPilotProfile();

  const tune = (input: string) => {
    const depth = profile.responseDepth || 1;
    let output = input;

    // Apply depth-based processing
    for (let i = 0; i < depth; i++) {
      output = `Review: ${output}`;
    }

    return output;
  };

  const getInteractionTone = () => {
    switch (profile.interactionStyle) {
      case 'formal':
        return "Please confirm how you'd like to proceed.";
      case 'adaptive':
        return "Here's what I suggest next.";
      case 'neutral':
      default:
        return "What do you want to do?";
    }
  };

  const adaptPrompt = (basePrompt: string) => {
    // Adjust prompt based on user's interaction style
    if (profile.interactionStyle === 'formal') {
      return `${basePrompt}\n\nPlease provide a formal, detailed response with clear structure.`;
    } else if (profile.interactionStyle === 'adaptive') {
      return `${basePrompt}\n\nBe conversational and adaptive, matching the user's tone. User name: ${profile.name}, Vehicle: ${profile.car}`;
    } else {
      return `${basePrompt}\n\nProvide a neutral, straightforward response.`;
    }
  };

  const personalizeGreeting = () => {
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    
    // Use firstName from authenticated user if available
    const displayName = getDisplayName();
    if (displayName && displayName !== 'Driver') {
      return `${timeGreeting}, ${displayName}!`;
    }
    
    // Fallback to profile name if authenticated user not available
    if (profile.name && profile.name !== 'driver-zero') {
      return `${timeGreeting}, ${profile.name}!`;
    }
    
    return `${timeGreeting}, driver!`;
  };

  return { 
    tune, 
    getInteractionTone, 
    adaptPrompt, 
    personalizeGreeting,
    profile 
  };
};