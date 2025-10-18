"""
Configuration and database setup for Vecto Pilot Python backend
"""
import os
from typing import Optional
from pydantic_settings import BaseSettings
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool


class Settings(BaseSettings):
    """Application settings from environment variables"""
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    
    # API Keys
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GOOGLEAQ_API_KEY: str = os.getenv("GOOGLEAQ_API_KEY", "")
    GOOGLE_MAPS_API_KEY: Optional[str] = os.getenv("GOOGLE_MAPS_API_KEY")
    PERPLEXITY_API_KEY: Optional[str] = os.getenv("PERPLEXITY_API_KEY")
    
    # FAA Airport Data
    FAA_ASWS_CLIENT_ID: Optional[str] = os.getenv("FAA_ASWS_CLIENT_ID")
    FAA_ASWS_CLIENT_SECRET: Optional[str] = os.getenv("FAA_ASWS_CLIENT_SECRET")
    
    # Server settings
    PORT: int = int(os.getenv("PORT", "5000"))
    HOST: str = os.getenv("HOST", "0.0.0.0")
    UI_ORIGIN: str = os.getenv("UI_ORIGIN", "https://vectopilot.com")
    
    # AI Model Configuration (GPT-5 single-path Triad)
    STRATEGIST_MODEL: str = os.getenv("STRATEGIST_MODEL", "claude-sonnet-4-20250514")
    PLANNER_MODEL: str = os.getenv("PLANNER_MODEL", "gpt-5")
    VALIDATOR_MODEL: str = os.getenv("VALIDATOR_MODEL", "gemini-2.0-flash-001")
    
    # Model parameters
    OPENAI_MAX_COMPLETION_TOKENS: Optional[int] = int(os.getenv("OPENAI_MAX_COMPLETION_TOKENS", "16000")) if os.getenv("OPENAI_MAX_COMPLETION_TOKENS") else None
    OPENAI_REASONING_EFFORT: str = os.getenv("OPENAI_REASONING_EFFORT", "high")
    GPT5_REASONING_EFFORT: str = os.getenv("GPT5_REASONING_EFFORT", "high")
    
    # Environment
    NODE_ENV: str = os.getenv("NODE_ENV", "development")
    REPL_ID: Optional[str] = os.getenv("REPL_ID")
    REPL_SLUG: Optional[str] = os.getenv("REPL_SLUG")
    REPL_OWNER: Optional[str] = os.getenv("REPL_OWNER")
    
    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"
    
    @property
    def is_replit(self) -> bool:
        return self.REPL_ID is not None
    
    model_config = {
        "env_file": ".env",
        "case_sensitive": True,
        "extra": "ignore"  # Allow extra env vars not in Settings model
    }


settings = Settings()


# Database engine setup
engine = create_engine(
    settings.DATABASE_URL,
    poolclass=NullPool,  # Replit-friendly: no persistent connections
    echo=False,  # Set to True for SQL query logging
    pool_pre_ping=True,  # Verify connections before using
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """FastAPI dependency for database sessions"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
