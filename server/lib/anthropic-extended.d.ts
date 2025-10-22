
export interface AnthropicMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AnthropicResponse {
  content?: Array<{ text: string }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
}

export interface AnthropicExtendedClient {
  messages: {
    create(params: AnthropicCreateParams): Promise<AnthropicResponse>;
  };
}

export interface AnthropicClientOptions {
  baseURL?: string;
  version?: string;
  timeout?: number;
}

export function createAnthropicClient(
  apiKey: string, 
  options?: AnthropicClientOptions
): AnthropicExtendedClient;

export default AnthropicExtendedClient;
