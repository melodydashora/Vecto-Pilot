"""Base model adapter interface"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from dataclasses import dataclass

@dataclass
class ModelResponse:
    """Standardized model response"""
    content: str
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    latency_ms: Optional[int] = None
    raw_response: Optional[Dict[str, Any]] = None


class ModelAdapter(ABC):
    """Abstract base class for model adapters"""
    
    def __init__(self, model_name: str, **config):
        self.model_name = model_name
        self.config = config
    
    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Provider name (e.g. 'openai', 'anthropic', 'google', 'local')"""
        pass
    
    @abstractmethod
    async def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs
    ) -> ModelResponse:
        """Generate completion from model"""
        pass
    
    @abstractmethod
    async def generate_json(
        self,
        prompt: str,
        json_schema: Optional[Dict[str, Any]] = None,
        temperature: float = 0.2,
        max_tokens: int = 8192,
        **kwargs
    ) -> ModelResponse:
        """Generate JSON response from model"""
        pass
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get model metadata"""
        return {
            "provider": self.provider_name,
            "model": self.model_name,
            "config": self.config
        }
