"""Strategy API routes - Core Triad pipeline integration"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
from datetime import datetime

from app.mlops.triad_orchestrator import triad
from app.mlops.event_store import event_store


router = APIRouter(prefix="/api/strategy", tags=["strategy"])


class LocationContext(BaseModel):
    """Driver location context"""
    latitude: float
    longitude: float
    formatted_address: Optional[str] = None


class TimeContext(BaseModel):
    """Time context"""
    local_time: str
    timezone: str
    day_of_week: str


class WeatherContext(BaseModel):
    """Weather context"""
    temperature: Optional[float] = None
    description: Optional[str] = None
    conditions: Optional[str] = None


class StrategyRequest(BaseModel):
    """Request for strategic recommendations"""
    gps: LocationContext
    location: Optional[Dict[str, Any]] = None
    time: TimeContext
    weather: Optional[WeatherContext] = None
    airport: Optional[Dict[str, Any]] = None
    catalog_venues: Optional[List[Dict[str, Any]]] = None


class StrategyResponse(BaseModel):
    """Strategic recommendations response"""
    job_id: str
    timestamp: str
    staging_area: Dict[str, Any]
    venues: List[Dict[str, Any]]
    metadata: Dict[str, Any]


@router.post("/generate", response_model=StrategyResponse)
async def generate_strategy(request: StrategyRequest):
    """
    Generate strategic recommendations using Triad pipeline
    
    This endpoint executes the three-stage ML pipeline:
    1. Claude Strategist: Market analysis
    2. GPT-5 Planner: Tactical venue selection
    3. Gemini Validator: Quality assurance
    
    Returns validated venue recommendations with staging area.
    """
    try:
        # Prepare user context for Triad
        user_context = {
            "gps": request.gps.model_dump(),
            "location": request.location or {},
            "time": request.time.model_dump(),
            "weather": request.weather.model_dump() if request.weather else {},
            "airport": request.airport or {},
            "catalog_venues": request.catalog_venues or []
        }
        
        # Execute Triad pipeline
        result = await triad.execute(user_context)
        
        # Build response
        import uuid
        return StrategyResponse(
            job_id=str(uuid.uuid4()),
            timestamp=datetime.utcnow().isoformat(),
            staging_area=result.get("staging_area", {}),
            venues=result.get("venues", []),
            metadata={
                "success": True,
                "model_pipeline": "claude-sonnet-4-20250514 → gpt-5 → gemini-2.0-flash-001"
            }
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Strategy generation failed: {str(e)}")


@router.get("/performance")
async def get_performance_metrics(hours: int = 24):
    """Get strategy generation performance metrics"""
    try:
        metrics = event_store.get_performance_metrics(hours=hours)
        
        by_stage = {
            "strategist": event_store.get_performance_metrics(call_type="strategist", hours=hours),
            "planner": event_store.get_performance_metrics(call_type="planner", hours=hours),
            "validator": event_store.get_performance_metrics(call_type="validator", hours=hours)
        }
        
        return {
            "window_hours": hours,
            "overall": metrics,
            "by_stage": by_stage,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
