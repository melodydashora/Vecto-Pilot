"""MLOps admin API routes - Training, evaluation, deployment"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Dict, Any, Optional, List

from app.mlops.pipelines.training import training_pipeline
from app.mlops.pipelines.evaluation import evaluation_pipeline
from app.mlops.pipelines.finetuning import finetuning_pipeline
from app.mlops.observability import observability
from app.mlops.safety_guardrails import safety, DeploymentStage


router = APIRouter(prefix="/api/mlops", tags=["mlops"])


# Training endpoints

class ExportDatasetRequest(BaseModel):
    """Request to export training dataset"""
    name: str
    call_type: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    format: str = "jsonl"
    compress: bool = True


@router.post("/training/export")
async def export_dataset(request: ExportDatasetRequest):
    """Export training dataset from event store"""
    try:
        metadata = training_pipeline.export_dataset(
            name=request.name,
            call_type=request.call_type,
            start_date=request.start_date,
            end_date=request.end_date,
            format=request.format,
            compress=request.compress
        )
        return {"success": True, "metadata": metadata}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/training/datasets")
async def list_datasets():
    """List all exported training datasets"""
    try:
        datasets = training_pipeline.list_datasets()
        return {"datasets": datasets}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Evaluation endpoints

class EvaluateModelRequest(BaseModel):
    """Request to evaluate a model"""
    provider: str
    model_name: str
    validation_file: str
    metrics: Optional[List[str]] = None
    api_key: Optional[str] = None


@router.post("/evaluation/run")
async def evaluate_model(request: EvaluateModelRequest, background_tasks: BackgroundTasks):
    """
    Evaluate a model on a validation dataset
    Note: This runs in the background for long-running evaluations
    """
    try:
        # Run evaluation in background
        async def run_eval():
            await evaluation_pipeline.evaluate_model(
                provider=request.provider,
                model_name=request.model_name,
                validation_file=request.validation_file,
                metrics=request.metrics or ["latency", "token_efficiency", "json_validity"],
                api_key=request.api_key
            )
        
        background_tasks.add_task(run_eval)
        
        return {
            "success": True,
            "message": "Evaluation started in background",
            "provider": request.provider,
            "model": request.model_name
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/evaluation/report")
async def get_performance_report(hours: int = 24):
    """Get comprehensive performance report"""
    try:
        report = evaluation_pipeline.get_performance_report(hours=hours)
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Fine-tuning endpoints

class CreateFineTuneRequest(BaseModel):
    """Request to create fine-tuning job"""
    provider: str
    training_file_path: str
    model: str
    suffix: Optional[str] = None
    hyperparameters: Optional[Dict[str, Any]] = None
    api_key: Optional[str] = None


@router.post("/finetuning/create")
async def create_finetune(request: CreateFineTuneRequest):
    """Create a fine-tuning job"""
    try:
        if request.provider == "openai":
            job = await finetuning_pipeline.create_openai_finetune(
                training_file_path=request.training_file_path,
                model=request.model,
                suffix=request.suffix,
                hyperparameters=request.hyperparameters,
                api_key=request.api_key
            )
        elif request.provider == "local":
            job = finetuning_pipeline.create_local_finetune(
                training_file_path=request.training_file_path,
                base_model=request.model,
                hyperparameters=request.hyperparameters
            )
        else:
            raise ValueError(f"Unsupported provider: {request.provider}")
        
        return {"success": True, "job": job}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/finetuning/jobs")
async def list_finetune_jobs():
    """List all fine-tuning jobs"""
    try:
        jobs = finetuning_pipeline.list_jobs()
        return {"jobs": jobs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Observability endpoints

@router.get("/observability/metrics")
async def get_metrics(window_minutes: int = 60):
    """Get comprehensive metrics summary"""
    try:
        summary = observability.get_metrics_summary(window_minutes=window_minutes)
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/observability/drift")
async def detect_drift(current_window: int = 60, baseline_window: int = 1440):
    """Detect performance drift"""
    try:
        drift = observability.detect_drift(
            window_current=current_window,
            window_baseline=baseline_window
        )
        return drift
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/observability/sla")
async def check_sla(hours: int = 24):
    """Check SLA compliance"""
    try:
        compliance = observability.check_sla_compliance(hours=hours)
        return compliance
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/observability/prometheus")
async def prometheus_metrics(hours: int = 1):
    """Export metrics in Prometheus format"""
    try:
        metrics = observability.export_prometheus_metrics(hours=hours)
        return {"metrics": metrics, "format": "prometheus"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Deployment & Safety endpoints

class PromoteModelRequest(BaseModel):
    """Request to promote a model"""
    model_id: str
    from_stage: str
    to_stage: str
    release_token: Optional[str] = None
    evaluation_file: Optional[str] = None


@router.post("/deployment/promote")
async def promote_model(request: PromoteModelRequest):
    """Promote model through deployment stages"""
    try:
        # Load evaluation metrics if provided
        eval_metrics = None
        if request.evaluation_file:
            import json
            with open(request.evaluation_file, 'r') as f:
                eval_metrics = json.load(f)
        
        # Validate deployment readiness
        if eval_metrics and request.to_stage in ["canary", "staged", "production"]:
            readiness = safety.validate_deployment_readiness(
                model_id=request.model_id,
                evaluation_results=eval_metrics
            )
            
            if not readiness["ready"]:
                return {
                    "success": False,
                    "message": "Model not ready for deployment",
                    "readiness": readiness
                }
        
        # Promote
        promotion = safety.promote_model(
            model_id=request.model_id,
            from_stage=DeploymentStage(request.from_stage),
            to_stage=DeploymentStage(request.to_stage),
            release_token=request.release_token,
            evaluation_metrics=eval_metrics
        )
        
        return {"success": True, "promotion": promotion}
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/deployment/history")
async def get_deployment_history(model_id: Optional[str] = None, limit: int = 100):
    """Get deployment history"""
    try:
        history = safety.get_deployment_history(model_id=model_id, limit=limit)
        return {"history": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class RollbackRequest(BaseModel):
    """Request to rollback a deployment"""
    current_model_id: str
    previous_model_id: str
    reason: str


@router.post("/deployment/rollback")
async def rollback_deployment(request: RollbackRequest):
    """Emergency rollback to previous model"""
    try:
        rollback_result = safety.rollback(
            current_model_id=request.current_model_id,
            previous_model_id=request.previous_model_id,
            reason=request.reason
        )
        return {"success": True, "rollback": rollback_result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
