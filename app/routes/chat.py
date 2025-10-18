"""AI Chat Assistant API routes"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from openai import AsyncOpenAI
from app.core.config import settings


router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    """Chat message request"""
    message: str


class ChatResponse(BaseModel):
    """Chat message response"""
    response: str


@router.post("", response_model=ChatResponse)
async def chat_with_assistant(request: ChatRequest):
    """
    Chat with AI assistant to edit code and manage the repository
    
    The assistant can:
    - Explain code and architecture
    - Suggest improvements and refactoring
    - Help debug issues
    - Generate new features
    """
    try:
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        
        system_prompt = """You are a helpful AI assistant for the Vecto Pilot rideshare driver assistance platform.

You have access to this codebase which includes:
- Python FastAPI backend with MLOps infrastructure
- Triad AI pipeline (Claude Strategist → GPT-5 Planner → Gemini Validator)
- 15-table PostgreSQL database for ML tracking
- Event store, model adapters, training/evaluation pipelines
- Fine-tuning infrastructure and observability system
- Safety guardrails with RELEASE_TOKEN and canary rollouts

Help the user by:
1. Explaining how the code works
2. Suggesting improvements and best practices
3. Debugging issues
4. Generating code snippets
5. Answering questions about the MLOps infrastructure

Be concise and provide code examples when relevant. Format code with triple backticks."""

        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": request.message}
            ],
            temperature=0.7,
            max_tokens=1000
        )
        
        return ChatResponse(response=response.choices[0].message.content)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")
