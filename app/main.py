"""
Vecto Pilot FastAPI Backend
Production-grade gateway with strict CORS, trust proxy, and per-route JSON parsing
"""
import os
import time
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn

from app.core.config import settings, engine
from app.models.database import Base
from app.routes import strategy, mlops, chat, files


# Lifespan context manager for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events"""
    # Startup
    print(f"🚀 [vecto-api] Starting in {settings.NODE_ENV.upper()} mode")
    print(f"🚀 [vecto-api] Port: {settings.PORT}, Host: {settings.HOST}")
    print(f"🚀 [vecto-api] UI Origin: {settings.UI_ORIGIN}")
    print(f"🚀 [vecto-api] Triad Models: {settings.STRATEGIST_MODEL} → {settings.PLANNER_MODEL} → {settings.VALIDATOR_MODEL}")
    
    # Verify database connection
    try:
        with engine.connect() as conn:
            print("[db] ✅ PostgreSQL connection verified")
    except Exception as e:
        print(f"[db] ⚠️  Database connection failed: {e}")
    
    yield
    
    # Shutdown
    print("[vecto-api] Shutting down gracefully...")
    engine.dispose()


# Initialize FastAPI app
app = FastAPI(
    title="Vecto Pilot API",
    description="Rideshare driver assistance platform with AI-powered recommendations",
    version="4.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)


# ============================================================================
# PRODUCTION-GRADE MIDDLEWARE (per attached requirements)
# ============================================================================

# Trust proxy configuration (Replit platform has exactly 1 proxy layer)
app.state.trust_proxy = 1


# CORS: strict origin validation for vectopilot.com only
@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    """Manual CORS with strict origin validation and Vary header"""
    origin = request.headers.get("origin")
    response = await call_next(request)
    
    # Set Vary header to prevent cache poisoning
    response.headers["Vary"] = "Origin"
    
    # Allow no-origin requests (curl, server-to-server)
    if not origin:
        return response
    
    # Strict origin check: only vectopilot.com
    if origin == settings.UI_ORIGIN:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    else:
        # Reject unauthorized origins
        pass
    
    return response


# Handle preflight OPTIONS requests
@app.options("/{full_path:path}")
async def preflight_handler(request: Request):
    """Handle CORS preflight requests"""
    origin = request.headers.get("origin")
    
    if origin == settings.UI_ORIGIN:
        return Response(
            status_code=status.HTTP_204_NO_CONTENT,
            headers={
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Max-Age": "600",
            }
        )
    
    return Response(status_code=status.HTTP_403_FORBIDDEN)


# Client abort detection (return 499 without noise)
@app.middleware("http")
async def client_disconnect_handler(request: Request, call_next):
    """Handle client disconnects gracefully (499 status)"""
    try:
        response = await call_next(request)
        return response
    except asyncio.CancelledError:
        # Client disconnected mid-request (common in SSE)
        return PlainTextResponse("Client Disconnected", status_code=499)


# Request timing
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Add processing time to response headers"""
    start_time = time.time()
    response = await call_next(request)
    process_time = (time.time() - start_time) * 1000  # Convert to ms
    response.headers["X-Process-Time-Ms"] = str(round(process_time, 2))
    return response


# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handle HTTP exceptions"""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail, "ok": False}
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle request validation errors"""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"error": "Validation error", "details": exc.errors(), "ok": False}
    )


# ============================================================================
# HEALTH & DIAGNOSTIC ENDPOINTS
# ============================================================================

@app.get("/health")
async def health_check():
    """Basic health check"""
    return {
        "ok": True,
        "name": "Vecto Pilot API",
        "version": "4.1.0",
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "env": settings.NODE_ENV
    }


@app.get("/healthz")
async def kubernetes_health():
    """Kubernetes-style health check"""
    return {
        "status": "ok",
        "ok": True,
        "healthy": True,
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }


@app.get("/ready")
async def kubernetes_readiness():
    """Kubernetes-style readiness check"""
    return {
        "status": "ok",
        "ok": True,
        "ready": True,
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }


@app.get("/api/diagnostics")
async def diagnostics():
    """System diagnostics endpoint"""
    return {
        "ok": True,
        "system": {
            "port": settings.PORT,
            "host": settings.HOST,
            "environment": settings.NODE_ENV,
            "is_production": settings.is_production,
            "is_replit": settings.is_replit,
        },
        "ai_models": {
            "strategist": settings.STRATEGIST_MODEL,
            "planner": settings.PLANNER_MODEL,
            "validator": settings.VALIDATOR_MODEL,
        },
        "integrations": {
            "anthropic": bool(settings.ANTHROPIC_API_KEY),
            "openai": bool(settings.OPENAI_API_KEY),
            "google_maps": bool(settings.GOOGLE_MAPS_API_KEY),
            "google_ai": bool(settings.GOOGLEAQ_API_KEY),
            "perplexity": bool(settings.PERPLEXITY_API_KEY),
            "faa": bool(settings.FAA_ASWS_CLIENT_ID),
        },
        "database": {
            "connected": True if settings.DATABASE_URL else False,
        }
    }


@app.get("/")
async def root():
    """Landing page - AI Chat Assistant"""
    from fastapi.responses import FileResponse
    return FileResponse("app/static/chat.html")


# ============================================================================
# API ROUTES
# ============================================================================

# Mount static files
from fastapi.staticfiles import StaticFiles
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Register API routers
app.include_router(strategy.router)
app.include_router(mlops.router)
app.include_router(chat.router)
app.include_router(files.router)


# ============================================================================
# SERVER ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=not settings.is_production,
        log_level="info",
        access_log=True,
    )
