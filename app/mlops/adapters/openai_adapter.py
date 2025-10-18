"""OpenAI model adapter"""

import time
from typing import Dict, Any, Optional
from openai import AsyncOpenAI
from .base import ModelAdapter, ModelResponse

class OpenAIAdapter(ModelAdapter):
    """Adapter for OpenAI models (GPT-4, GPT-5, o3-mini, etc.)"""
    
    def __init__(self, model_name: str, **config):
        super().__init__(model_name, **config)
        self.client = AsyncOpenAI(
            api_key=config.get("api_key"),
            base_url=config.get("base_url"),
            organization=config.get("organization"),
            timeout=config.get("timeout", 180.0)
        )
    
    @property
    def provider_name(self) -> str:
        return "openai"
    
    async def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs
    ) -> ModelResponse:
        """Generate completion from OpenAI model"""
        start = time.time()
        
        # Handle reasoning models (o3, o3-mini, o4)
        is_reasoning_model = self.model_name.startswith(('o3', 'o4', 'gpt-5'))
        
        request_params = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
        }
        
        if is_reasoning_model:
            # Reasoning models use reasoning_effort instead of temperature
            request_params.pop("temperature")
            request_params["reasoning_effort"] = kwargs.get("reasoning_effort", "medium")
        
        if not is_reasoning_model or self.model_name.startswith('gpt-5'):
            request_params["max_completion_tokens"] = max_tokens
        
        response = await self.client.chat.completions.create(**request_params)
        
        latency_ms = int((time.time() - start) * 1000)
        
        return ModelResponse(
            content=response.choices[0].message.content,
            tokens_in=response.usage.prompt_tokens if response.usage else None,
            tokens_out=response.usage.completion_tokens if response.usage else None,
            latency_ms=latency_ms,
            raw_response=response.model_dump()
        )
    
    async def generate_json(
        self,
        prompt: str,
        json_schema: Optional[Dict[str, Any]] = None,
        temperature: float = 0.2,
        max_tokens: int = 8192,
        **kwargs
    ) -> ModelResponse:
        """Generate JSON response from OpenAI model"""
        start = time.time()
        
        is_reasoning_model = self.model_name.startswith(('o3', 'o4', 'gpt-5'))
        
        request_params = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
        }
        
        if is_reasoning_model:
            request_params["reasoning_effort"] = kwargs.get("reasoning_effort", "low")
        else:
            request_params["temperature"] = temperature
        
        if not is_reasoning_model or self.model_name.startswith('gpt-5'):
            request_params["max_completion_tokens"] = max_tokens
        
        if json_schema:
            request_params["response_format"] = {
                "type": "json_schema",
                "json_schema": json_schema
            }
        
        response = await self.client.chat.completions.create(**request_params)
        
        latency_ms = int((time.time() - start) * 1000)
        
        return ModelResponse(
            content=response.choices[0].message.content,
            tokens_in=response.usage.prompt_tokens if response.usage else None,
            tokens_out=response.usage.completion_tokens if response.usage else None,
            latency_ms=latency_ms,
            raw_response=response.model_dump()
        )
