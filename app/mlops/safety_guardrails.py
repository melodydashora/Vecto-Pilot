"""Safety guardrails - RELEASE_TOKEN, canary rollouts, audit logs"""

import json
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List
from enum import Enum


class DeploymentStage(str, Enum):
    """Deployment stages for canary rollouts"""
    DEVELOPMENT = "development"
    CANARY = "canary"  # 5% of traffic
    STAGED = "staged"  # 25% of traffic
    PRODUCTION = "production"  # 100% of traffic
    ROLLBACK = "rollback"  # Emergency rollback


class SafetyGuardrails:
    """Production safety system for model deployments"""
    
    def __init__(
        self,
        audit_log_path: str = "data/mlops/audit.jsonl",
        release_token_path: str = "data/mlops/release_token.txt"
    ):
        self.audit_log_path = Path(audit_log_path)
        self.audit_log_path.parent.mkdir(parents=True, exist_ok=True)
        
        self.release_token_path = Path(release_token_path)
        self.release_token_path.parent.mkdir(parents=True, exist_ok=True)
    
    def verify_release_token(self, token: str) -> bool:
        """Verify RELEASE_TOKEN for production deployments"""
        if not self.release_token_path.exists():
            print("[safety] ⚠️  No release token configured")
            return False
        
        with open(self.release_token_path, 'r') as f:
            valid_token = f.read().strip()
        
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        valid_hash = hashlib.sha256(valid_token.encode()).hexdigest()
        
        return token_hash == valid_hash
    
    def set_release_token(self, token: str):
        """Set the RELEASE_TOKEN"""
        with open(self.release_token_path, 'w') as f:
            f.write(token)
        
        self.audit_log("release_token_set", {
            "timestamp": datetime.utcnow().isoformat()
        })
        
        print(f"[safety] ✓ Release token set")
    
    def audit_log(
        self,
        action: str,
        details: Dict[str, Any],
        user: Optional[str] = None
    ):
        """Write to audit log"""
        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "action": action,
            "user": user or "system",
            "details": details
        }
        
        with open(self.audit_log_path, 'a') as f:
            f.write(json.dumps(entry) + '\n')
    
    def promote_model(
        self,
        model_id: str,
        from_stage: DeploymentStage,
        to_stage: DeploymentStage,
        release_token: Optional[str] = None,
        evaluation_metrics: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Promote model through deployment stages
        
        Promotion path:
        development → canary → staged → production
        
        Requirements:
        - Canary: Evaluation metrics required
        - Production: RELEASE_TOKEN required
        """
        # Validate promotion path
        valid_paths = {
            DeploymentStage.DEVELOPMENT: [DeploymentStage.CANARY],
            DeploymentStage.CANARY: [DeploymentStage.STAGED, DeploymentStage.ROLLBACK],
            DeploymentStage.STAGED: [DeploymentStage.PRODUCTION, DeploymentStage.ROLLBACK],
            DeploymentStage.PRODUCTION: [DeploymentStage.ROLLBACK]
        }
        
        if to_stage not in valid_paths.get(from_stage, []):
            raise ValueError(f"Invalid promotion: {from_stage} → {to_stage}")
        
        # Check requirements
        if to_stage in [DeploymentStage.CANARY, DeploymentStage.STAGED, DeploymentStage.PRODUCTION]:
            if not evaluation_metrics:
                raise ValueError(f"Evaluation metrics required for promotion to {to_stage}")
        
        if to_stage == DeploymentStage.PRODUCTION:
            if not release_token or not self.verify_release_token(release_token):
                raise ValueError("Valid RELEASE_TOKEN required for production deployment")
        
        # Execute promotion
        promotion = {
            "model_id": model_id,
            "from_stage": from_stage,
            "to_stage": to_stage,
            "promoted_at": datetime.utcnow().isoformat(),
            "evaluation_metrics": evaluation_metrics,
            "traffic_percentage": self._get_traffic_percentage(to_stage)
        }
        
        # Audit log
        self.audit_log("model_promotion", promotion)
        
        print(f"[safety] ✓ Promoted {model_id}: {from_stage} → {to_stage}")
        print(f"[safety] Traffic allocation: {promotion['traffic_percentage']}%")
        
        return promotion
    
    def _get_traffic_percentage(self, stage: DeploymentStage) -> int:
        """Get traffic percentage for deployment stage"""
        percentages = {
            DeploymentStage.DEVELOPMENT: 0,
            DeploymentStage.CANARY: 5,
            DeploymentStage.STAGED: 25,
            DeploymentStage.PRODUCTION: 100,
            DeploymentStage.ROLLBACK: 0
        }
        return percentages[stage]
    
    def rollback(
        self,
        current_model_id: str,
        previous_model_id: str,
        reason: str
    ) -> Dict[str, Any]:
        """Emergency rollback to previous model"""
        rollback_action = {
            "current_model": current_model_id,
            "rollback_to": previous_model_id,
            "reason": reason,
            "rolled_back_at": datetime.utcnow().isoformat()
        }
        
        # Audit log
        self.audit_log("emergency_rollback", rollback_action)
        
        print(f"[safety] 🚨 ROLLBACK: {current_model_id} → {previous_model_id}")
        print(f"[safety] Reason: {reason}")
        
        return rollback_action
    
    def get_deployment_history(
        self,
        model_id: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get deployment/promotion history"""
        if not self.audit_log_path.exists():
            return []
        
        history = []
        with open(self.audit_log_path, 'r') as f:
            for line in f:
                entry = json.loads(line)
                if entry["action"] in ["model_promotion", "emergency_rollback"]:
                    if model_id is None or entry["details"].get("model_id") == model_id:
                        history.append(entry)
        
        return sorted(history, key=lambda x: x["timestamp"], reverse=True)[:limit]
    
    def validate_deployment_readiness(
        self,
        model_id: str,
        evaluation_results: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Check if model is ready for deployment"""
        readiness = {
            "model_id": model_id,
            "ready": True,
            "checks": {},
            "warnings": []
        }
        
        # Check success rate
        success_rate = evaluation_results.get("metrics", {}).get("success_rate", 0)
        readiness["checks"]["success_rate"] = {
            "value": success_rate,
            "threshold": 0.95,
            "passed": success_rate >= 0.95
        }
        if success_rate < 0.95:
            readiness["ready"] = False
        
        # Check latency
        avg_latency = evaluation_results.get("metrics", {}).get("avg_latency_ms", 0)
        readiness["checks"]["latency"] = {
            "value": avg_latency,
            "threshold": 90000,  # 90s
            "passed": avg_latency <= 90000
        }
        if avg_latency > 90000:
            readiness["warnings"].append("High latency detected")
        
        # Check JSON validity
        json_validity = evaluation_results.get("metrics", {}).get("json_validity_rate", 0)
        readiness["checks"]["json_validity"] = {
            "value": json_validity,
            "threshold": 0.98,
            "passed": json_validity >= 0.98
        }
        if json_validity < 0.98:
            readiness["ready"] = False
        
        return readiness


# Global singleton
safety = SafetyGuardrails()
