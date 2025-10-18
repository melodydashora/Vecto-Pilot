"""Model adapter abstraction layer"""

from .base import ModelAdapter
from .openai_adapter import OpenAIAdapter
from .anthropic_adapter import AnthropicAdapter
from .local_adapter import LocalModelAdapter
from .factory import get_model_adapter

# Google adapter is lazy-loaded due to protobuf dependency issues
__all__ = [
    "ModelAdapter",
    "OpenAIAdapter",
    "AnthropicAdapter",
    "LocalModelAdapter",
    "get_model_adapter"
]
