"""Model adapter factory"""

from typing import Dict, Any
from .base import ModelAdapter
from .openai_adapter import OpenAIAdapter
from .anthropic_adapter import AnthropicAdapter
from .google_adapter import GoogleAdapter
from .local_adapter import LocalModelAdapter

def get_model_adapter(
    provider: str,
    model_name: str,
    **config
) -> ModelAdapter:
    """Factory function to get the appropriate model adapter"""
    
    adapters = {
        "openai": OpenAIAdapter,
        "anthropic": AnthropicAdapter,
        "google": GoogleAdapter,
        "local": LocalModelAdapter
    }
    
    adapter_class = adapters.get(provider.lower())
    if not adapter_class:
        raise ValueError(f"Unknown provider: {provider}. Supported: {list(adapters.keys())}")
    
    return adapter_class(model_name, **config)
