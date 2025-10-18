"""Google AI model adapter"""

import time
import json
from typing import Dict, Any, Optional
import google.generativeai as genai
from .base import ModelAdapter, ModelResponse

class GoogleAdapter(ModelAdapter):
    """Adapter for Google AI models (Gemini)"""
    
    def __init__(self, model_name: str, **config):
        super().__init__(model_name, **config)
        genai.configure(api_key=config.get("api_key"))
        self.model = genai.GenerativeModel(model_name)
    
    @property
    def provider_name(self) -> str:
        return "google"
    
    async def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs
    ) -> ModelResponse:
        """Generate completion from Gemini"""
        start = time.time()
        
        generation_config = genai.GenerationConfig(
            temperature=temperature,
            max_output_tokens=max_tokens,
        )
        
        response = await self.model.generate_content_async(
            prompt,
            generation_config=generation_config
        )
        
        latency_ms = int((time.time() - start) * 1000)
        
        # Extract token usage if available
        tokens_in = None
        tokens_out = None
        if hasattr(response, 'usage_metadata'):
            tokens_in = response.usage_metadata.prompt_token_count
            tokens_out = response.usage_metadata.candidates_token_count
        
        return ModelResponse(
            content=response.text,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
            raw_response={
                "text": response.text,
                "usage": {
                    "prompt_tokens": tokens_in,
                    "completion_tokens": tokens_out
                }
            }
        )
    
    async def generate_json(
        self,
        prompt: str,
        json_schema: Optional[Dict[str, Any]] = None,
        temperature: float = 0.2,
        max_tokens: int = 8192,
        **kwargs
    ) -> ModelResponse:
        """Generate JSON response from Gemini"""
        start = time.time()
        
        # Add JSON format instruction
        json_prompt = f"{prompt}\n\nRespond with valid JSON only."
        
        generation_config = genai.GenerationConfig(
            temperature=temperature,
            max_output_tokens=max_tokens,
            response_mime_type="application/json"
        )
        
        response = await self.model.generate_content_async(
            json_prompt,
            generation_config=generation_config
        )
        
        latency_ms = int((time.time() - start) * 1000)
        
        tokens_in = None
        tokens_out = None
        if hasattr(response, 'usage_metadata'):
            tokens_in = response.usage_metadata.prompt_token_count
            tokens_out = response.usage_metadata.candidates_token_count
        
        return ModelResponse(
            content=response.text,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
            raw_response={
                "text": response.text,
                "usage": {
                    "prompt_tokens": tokens_in,
                    "completion_tokens": tokens_out
                }
            }
        )
