"""Observability system - Metrics, drift detection, and alerting"""

import json
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from pathlib import Path
from app.mlops.event_store import event_store


class ObservabilitySystem:
    """Monitor model performance, detect drift, and trigger alerts"""
    
    def __init__(self, config_file: str = "data/mlops/observability_config.json"):
        self.config_file = Path(config_file)
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        self.load_config()
    
    def load_config(self):
        """Load observability configuration"""
        default_config = {
            "thresholds": {
                "error_rate": 0.05,  # 5% max error rate
                "avg_latency_ms": 90000,  # 90s max avg latency
                "p95_latency_ms": 120000,  # 120s max P95 latency
                "success_rate": 0.95,  # 95% min success rate
                "token_efficiency": 0.8  # Min 80% of expected tokens
            },
            "windows": {
                "real_time": 15,  # 15 minutes
                "hourly": 60,  # 1 hour
                "daily": 1440  # 24 hours
            },
            "alerts": {
                "enabled": True,
                "channels": ["log", "webhook"],
                "webhook_url": None
            }
        }
        
        if self.config_file.exists():
            with open(self.config_file, 'r') as f:
                self.config = {**default_config, **json.load(f)}
        else:
            self.config = default_config
            with open(self.config_file, 'w') as f:
                json.dump(self.config, f, indent=2)
    
    def get_metrics_summary(self, window_minutes: int = 60) -> Dict[str, Any]:
        """Get comprehensive metrics summary"""
        hours = window_minutes / 60
        
        overall = event_store.get_performance_metrics(hours=hours)
        by_stage = {
            "strategist": event_store.get_performance_metrics(call_type="strategist", hours=hours),
            "planner": event_store.get_performance_metrics(call_type="planner", hours=hours),
            "validator": event_store.get_performance_metrics(call_type="validator", hours=hours)
        }
        
        summary = {
            "timestamp": datetime.utcnow().isoformat(),
            "window_minutes": window_minutes,
            "overall": overall,
            "by_stage": by_stage,
            "health_status": self._calculate_health_status(overall)
        }
        
        return summary
    
    def _calculate_health_status(self, metrics: Dict[str, Any]) -> str:
        """Calculate overall health status"""
        thresholds = self.config["thresholds"]
        
        # Check success rate
        if metrics["success_rate"] < thresholds["success_rate"]:
            return "critical"
        
        # Check latency
        if metrics["avg_latency_ms"] and metrics["avg_latency_ms"] > thresholds["avg_latency_ms"]:
            return "degraded"
        
        # All good
        return "healthy"
    
    def detect_drift(self, window_current: int = 60, window_baseline: int = 1440) -> Dict[str, Any]:
        """Detect performance drift by comparing current vs baseline metrics"""
        current = event_store.get_performance_metrics(hours=window_current / 60)
        baseline = event_store.get_performance_metrics(hours=window_baseline / 60)
        
        drift_analysis = {
            "timestamp": datetime.utcnow().isoformat(),
            "current_window_minutes": window_current,
            "baseline_window_minutes": window_baseline,
            "drift_detected": False,
            "metrics_comparison": {}
        }
        
        # Compare key metrics
        for metric in ["success_rate", "avg_latency_ms", "avg_tokens_in", "avg_tokens_out"]:
            current_val = current.get(metric)
            baseline_val = baseline.get(metric)
            
            if current_val is not None and baseline_val is not None and baseline_val > 0:
                pct_change = ((current_val - baseline_val) / baseline_val) * 100
                
                drift_analysis["metrics_comparison"][metric] = {
                    "current": current_val,
                    "baseline": baseline_val,
                    "percent_change": pct_change,
                    "drift": abs(pct_change) > 20  # 20% threshold
                }
                
                if abs(pct_change) > 20:
                    drift_analysis["drift_detected"] = True
        
        if drift_analysis["drift_detected"]:
            self._trigger_alert("drift", drift_analysis)
        
        return drift_analysis
    
    def check_sla_compliance(self, hours: int = 24) -> Dict[str, Any]:
        """Check if metrics meet SLA thresholds"""
        metrics = event_store.get_performance_metrics(hours=hours)
        thresholds = self.config["thresholds"]
        
        compliance = {
            "timestamp": datetime.utcnow().isoformat(),
            "window_hours": hours,
            "overall_compliant": True,
            "checks": {}
        }
        
        checks = [
            ("success_rate", metrics["success_rate"], thresholds["success_rate"], ">="),
            ("avg_latency_ms", metrics["avg_latency_ms"], thresholds["avg_latency_ms"], "<="),
        ]
        
        for name, value, threshold, operator in checks:
            if value is None:
                compliant = True
            elif operator == ">=":
                compliant = value >= threshold
            else:  # "<="
                compliant = value <= threshold
            
            compliance["checks"][name] = {
                "value": value,
                "threshold": threshold,
                "compliant": compliant
            }
            
            if not compliant:
                compliance["overall_compliant"] = False
        
        if not compliance["overall_compliant"]:
            self._trigger_alert("sla_violation", compliance)
        
        return compliance
    
    def _trigger_alert(self, alert_type: str, data: Dict[str, Any]):
        """Trigger an alert"""
        if not self.config["alerts"]["enabled"]:
            return
        
        alert = {
            "type": alert_type,
            "timestamp": datetime.utcnow().isoformat(),
            "data": data
        }
        
        # Log alert
        if "log" in self.config["alerts"]["channels"]:
            print(f"[observability] 🚨 ALERT: {alert_type}")
            print(json.dumps(alert, indent=2))
        
        # Webhook alert
        if "webhook" in self.config["alerts"]["channels"] and self.config["alerts"]["webhook_url"]:
            import aiohttp
            import asyncio
            
            async def send_webhook():
                async with aiohttp.ClientSession() as session:
                    await session.post(
                        self.config["alerts"]["webhook_url"],
                        json=alert
                    )
            
            try:
                asyncio.create_task(send_webhook())
            except:
                pass  # Best effort
    
    def export_prometheus_metrics(self, hours: int = 1) -> str:
        """Export metrics in Prometheus format"""
        metrics = self.get_metrics_summary(window_minutes=hours * 60)
        
        prom_metrics = []
        
        # Overall metrics
        overall = metrics["overall"]
        prom_metrics.append(f"vecto_total_calls {overall['total_calls']}")
        prom_metrics.append(f"vecto_success_rate {overall['success_rate']}")
        prom_metrics.append(f"vecto_avg_latency_ms {overall['avg_latency_ms'] or 0}")
        prom_metrics.append(f"vecto_total_tokens_in {overall['total_tokens_in'] or 0}")
        prom_metrics.append(f"vecto_total_tokens_out {overall['total_tokens_out'] or 0}")
        
        # Stage-specific metrics
        for stage, stage_metrics in metrics["by_stage"].items():
            prom_metrics.append(f'vecto_stage_calls{{stage="{stage}"}} {stage_metrics["total_calls"]}')
            prom_metrics.append(f'vecto_stage_success_rate{{stage="{stage}"}} {stage_metrics["success_rate"]}')
            prom_metrics.append(f'vecto_stage_avg_latency_ms{{stage="{stage}"}} {stage_metrics["avg_latency_ms"] or 0}')
        
        return "\n".join(prom_metrics)


# Global singleton
observability = ObservabilitySystem()
