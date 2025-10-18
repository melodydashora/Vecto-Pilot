"""Evaluation pipeline - Metrics, validation, and model scoring"""

import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
from app.mlops.adapters import get_model_adapter
from app.mlops.event_store import event_store


class EvaluationPipeline:
    """Evaluate model performance on validation datasets"""
    
    def __init__(self, results_dir: str = "data/mlops/evaluations"):
        self.results_dir = Path(results_dir)
        self.results_dir.mkdir(parents=True, exist_ok=True)
    
    async def evaluate_model(
        self,
        provider: str,
        model_name: str,
        validation_file: str,
        metrics: List[str] = None,
        **adapter_config
    ) -> Dict[str, Any]:
        """
        Evaluate a model on a validation dataset
        
        Args:
            provider: Model provider ('openai', 'anthropic', 'google', 'local')
            model_name: Model name/ID
            validation_file: Path to validation JSONL file
            metrics: List of metrics to compute ('accuracy', 'bleu', 'rouge', etc.)
            adapter_config: Additional config for model adapter
            
        Returns:
            Evaluation results
        """
        print(f"[eval] Starting evaluation: {provider}/{model_name}")
        
        if metrics is None:
            metrics = ['latency', 'token_efficiency', 'json_validity']
        
        adapter = get_model_adapter(provider, model_name, **adapter_config)
        
        # Load validation data
        with open(validation_file, 'r') as f:
            val_records = [json.loads(line) for line in f]
        
        results = []
        total_latency = 0
        total_tokens_in = 0
        total_tokens_out = 0
        json_valid_count = 0
        
        for i, record in enumerate(val_records):
            print(f"[eval] Processing record {i+1}/{len(val_records)}")
            
            try:
                # Generate prediction
                response = await adapter.generate(
                    prompt=record['prompt'],
                    temperature=0.2,
                    max_tokens=4096
                )
                
                # Compute metrics
                record_metrics = {
                    'latency_ms': response.latency_ms,
                    'tokens_in': response.tokens_in,
                    'tokens_out': response.tokens_out,
                    'prediction': response.content,
                    'ground_truth': record.get('response'),
                    'success': True
                }
                
                # JSON validity check
                if 'json_validity' in metrics:
                    try:
                        json.loads(response.content)
                        record_metrics['json_valid'] = True
                        json_valid_count += 1
                    except:
                        record_metrics['json_valid'] = False
                
                total_latency += response.latency_ms or 0
                total_tokens_in += response.tokens_in or 0
                total_tokens_out += response.tokens_out or 0
                
                results.append(record_metrics)
                
            except Exception as e:
                print(f"[eval] ❌ Error on record {i}: {str(e)}")
                results.append({
                    'success': False,
                    'error': str(e),
                    'prediction': None,
                    'ground_truth': record.get('response')
                })
        
        # Aggregate metrics
        successful_count = sum(1 for r in results if r.get('success'))
        success_rate = successful_count / len(results) if results else 0
        
        evaluation = {
            "model": {
                "provider": provider,
                "model_name": model_name
            },
            "dataset": {
                "file": validation_file,
                "record_count": len(val_records)
            },
            "metrics": {
                "success_rate": success_rate,
                "avg_latency_ms": total_latency / successful_count if successful_count > 0 else None,
                "total_tokens_in": total_tokens_in,
                "total_tokens_out": total_tokens_out,
                "avg_tokens_in": total_tokens_in / successful_count if successful_count > 0 else None,
                "avg_tokens_out": total_tokens_out / successful_count if successful_count > 0 else None,
                "json_validity_rate": json_valid_count / len(results) if results else 0
            },
            "results": results,
            "evaluated_at": datetime.utcnow().isoformat()
        }
        
        # Save results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        result_file = self.results_dir / f"eval_{provider}_{model_name}_{timestamp}.json"
        with open(result_file, 'w') as f:
            json.dump(evaluation, f, indent=2)
        
        print(f"[eval] ✓ Evaluation complete: {success_rate:.1%} success rate")
        print(f"[eval] ✓ Results saved to {result_file}")
        
        return evaluation
    
    def compare_models(
        self,
        eval_file_1: str,
        eval_file_2: str
    ) -> Dict[str, Any]:
        """Compare two model evaluation results"""
        with open(eval_file_1, 'r') as f:
            eval1 = json.load(f)
        
        with open(eval_file_2, 'r') as f:
            eval2 = json.load(f)
        
        comparison = {
            "model_1": eval1["model"],
            "model_2": eval2["model"],
            "metric_comparison": {
                "success_rate": {
                    "model_1": eval1["metrics"]["success_rate"],
                    "model_2": eval2["metrics"]["success_rate"],
                    "delta": eval2["metrics"]["success_rate"] - eval1["metrics"]["success_rate"]
                },
                "avg_latency_ms": {
                    "model_1": eval1["metrics"]["avg_latency_ms"],
                    "model_2": eval2["metrics"]["avg_latency_ms"],
                    "delta": eval2["metrics"]["avg_latency_ms"] - eval1["metrics"]["avg_latency_ms"]
                },
                "json_validity_rate": {
                    "model_1": eval1["metrics"]["json_validity_rate"],
                    "model_2": eval2["metrics"]["json_validity_rate"],
                    "delta": eval2["metrics"]["json_validity_rate"] - eval1["metrics"]["json_validity_rate"]
                }
            }
        }
        
        return comparison
    
    def get_performance_report(self, hours: int = 24) -> Dict[str, Any]:
        """Get performance report from event store"""
        report = {
            "overall": event_store.get_performance_metrics(hours=hours),
            "by_stage": {
                "strategist": event_store.get_performance_metrics(call_type="strategist", hours=hours),
                "planner": event_store.get_performance_metrics(call_type="planner", hours=hours),
                "validator": event_store.get_performance_metrics(call_type="validator", hours=hours)
            }
        }
        
        return report


# Global singleton
evaluation_pipeline = EvaluationPipeline()
