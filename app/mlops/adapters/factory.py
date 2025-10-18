"""Model adapter factory"""

from typing import Dict, Any
from .base import ModelAdapter
from .openai_adapter import OpenAIAdapter
from .anthropic_adapter import AnthropicAdapter
from .local_adapter import LocalModelAdapter

def get_model_adapter(
    provider: str,
    model_name: str,
    **config
) -> ModelAdapter:
    """Factory function to get the appropriate model adapter"""
    
    provider_lower = provider.lower()
    
    if provider_lower == "openai":
        return OpenAIAdapter(model_name, **config)
    elif provider_lower == "anthropic":
        return AnthropicAdapter(model_name, **config)
    elif provider_lower == "google":
        # Lazy load Google adapter to avoid protobuf dependency issues
        from .google_adapter import GoogleAdapter
        return GoogleAdapter(model_name, **config)
    elif provider_lower == "local":
        return LocalModelAdapter(model_name, **config)
    else:
        raise ValueError(f"Unknown provider: {provider}. Supported: openai, anthropic, google, local")
