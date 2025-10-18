"""Local model adapter for fine-tuned models"""

import time
import json
import aiohttp
from typing import Dict, Any, Optional
from .base import ModelAdapter, ModelResponse

class LocalModelAdapter(ModelAdapter):
    """Adapter for locally-hosted fine-tuned models"""
    
    def __init__(self, model_name: str, **config):
        super().__init__(model_name, **config)
        self.endpoint = config.get("endpoint", "http://localhost:8000")
        self.api_key = config.get("api_key")
    
    @property
    def provider_name(self) -> str:
        return "local"
    
    async def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs
    ) -> ModelResponse:
        """Generate completion from local model"""
        start = time.time()
        
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "temperature": temperature,
            "max_tokens": max_tokens,
            **kwargs
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/completions",
                json=payload,
                headers=headers
            ) as response:
                data = await response.json()
        
        latency_ms = int((time.time() - start) * 1000)
        
        return ModelResponse(
            content=data.get("choices", [{}])[0].get("text", ""),
            tokens_in=data.get("usage", {}).get("prompt_tokens"),
            tokens_out=data.get("usage", {}).get("completion_tokens"),
            latency_ms=latency_ms,
            raw_response=data
        )
    
    async def generate_json(
        self,
        prompt: str,
        json_schema: Optional[Dict[str, Any]] = None,
        temperature: float = 0.2,
        max_tokens: int = 8192,
        **kwargs
    ) -> ModelResponse:
        """Generate JSON response from local model"""
        start = time.time()
        
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        json_prompt = f"{prompt}\n\nRespond with valid JSON only."
        
        payload = {
            "model": self.model_name,
            "prompt": json_prompt,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            **kwargs
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/completions",
                json=payload,
                headers=headers
            ) as response:
                data = await response.json()
        
        latency_ms = int((time.time() - start) * 1000)
        
        return ModelResponse(
            content=data.get("choices", [{}])[0].get("text", ""),
            tokens_in=data.get("usage", {}).get("prompt_tokens"),
            tokens_out=data.get("usage", {}).get("completion_tokens"),
            latency_ms=latency_ms,
            raw_response=data
        )
