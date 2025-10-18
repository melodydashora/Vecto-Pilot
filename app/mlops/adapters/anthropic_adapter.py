"""Anthropic model adapter"""

import time
import json
from typing import Dict, Any, Optional
from anthropic import AsyncAnthropic
from .base import ModelAdapter, ModelResponse

class AnthropicAdapter(ModelAdapter):
    """Adapter for Anthropic models (Claude)"""
    
    def __init__(self, model_name: str, **config):
        super().__init__(model_name, **config)
        self.client = AsyncAnthropic(
            api_key=config.get("api_key"),
            timeout=config.get("timeout", 180.0)
        )
    
    @property
    def provider_name(self) -> str:
        return "anthropic"
    
    async def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs
    ) -> ModelResponse:
        """Generate completion from Claude"""
        start = time.time()
        
        response = await self.client.messages.create(
            model=self.model_name,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}]
        )
        
        latency_ms = int((time.time() - start) * 1000)
        
        return ModelResponse(
            content=response.content[0].text,
            tokens_in=response.usage.input_tokens,
            tokens_out=response.usage.output_tokens,
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
        """Generate JSON response from Claude"""
        start = time.time()
        
        # Add JSON format instruction to prompt
        json_prompt = f"{prompt}\n\nYou must respond with valid JSON only. Do not include any text before or after the JSON object."
        
        response = await self.client.messages.create(
            model=self.model_name,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": json_prompt}]
        )
        
        latency_ms = int((time.time() - start) * 1000)
        
        # Extract JSON from response
        content = response.content[0].text
        
        # Try to find JSON if wrapped in markdown
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
        
        return ModelResponse(
            content=content,
            tokens_in=response.usage.input_tokens,
            tokens_out=response.usage.output_tokens,
            latency_ms=latency_ms,
            raw_response=response.model_dump()
        )
