import { UserProfile } from '@/hooks/useProfile';
import { buildContext } from './buildContext';
import { getLocationZone } from './getLocationZone';

export const buildPrompt = async (input: string, profile: UserProfile): Promise<string> => {
  const { name, car, interactionStyle, traits, responseDepth } = profile;

  const traitLine = traits?.length > 0 ? `Known traits: ${traits.join(', ')}.` : '';
  const stylePrefix =
    interactionStyle === 'formal'
      ? 'Please provide a professional response based on the following:'
      : interactionStyle === 'adaptive'
      ? 'Give a helpful suggestion based on the following input:'
      : 'Respond directly without formality:';

  // Get real-time context
  const timeContext = buildContext();
  const locationContext = await getLocationZone();

  return `
    ${stylePrefix}

    Real-time Context:
    ${timeContext}
    ${locationContext}

    User: ${name}
    Vehicle: ${car}
    ${traitLine}
    Context Depth: ${responseDepth}

    Input: ${input}
  `.trim();
};

export const buildCopilotPrompt = async (
  locationName: string,
  profile: UserProfile,
  noGoZones: any[] = []
): Promise<string> => {
  const { name, car, interactionStyle, traits, responseDepth } = profile;
  
  const traitLine = traits?.length > 0 ? `Driver traits: ${traits.join(', ')}.` : '';
  const vehicleInfo = car !== 'unknown' ? `Vehicle: ${car}` : '';
  
  const depthInstruction = 
    responseDepth === 1 ? 'Provide brief, concise recommendations.' :
    responseDepth === 3 ? 'Provide comprehensive, detailed recommendations with full explanations.' :
    'Provide balanced recommendations with moderate detail.';
  
  const styleInstruction =
    interactionStyle === 'formal' 
      ? 'Use professional language and detailed explanations.'
      : interactionStyle === 'adaptive'
      ? 'Adapt your tone to be helpful and conversational.'
      : 'Be direct and straightforward.';
  
  // Get real-time context
  const timeContext = buildContext();
  const locationContext = await getLocationZone();

  const contextualPrompt = `
    Real-time Context:
    ${timeContext}
    ${locationContext}
    
    Driver Profile:
    - Name: ${name}
    ${vehicleInfo}
    ${traitLine}
    
    Communication Preferences:
    - ${styleInstruction}
    - ${depthInstruction}
    
    Current Location: ${locationName}
    ${noGoZones.length > 0 ? `Avoid zones: ${noGoZones.map(z => z.name).join(', ')}` : ''}
  `.trim();
  
  return contextualPrompt;
};