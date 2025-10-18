#!/usr/bin/env python3
"""MLOps Promotion Script - Promote models through deployment stages"""

import asyncio
import argparse
import json
import getpass
from pathlib import Path
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.mlops.safety_guardrails import safety, DeploymentStage


async def main():
    parser = argparse.ArgumentParser(description="Promote model through deployment stages")
    parser.add_argument("--model-id", required=True, help="Model ID to promote")
    parser.add_argument("--from-stage", required=True, 
                       choices=["development", "canary", "staged", "production"],
                       help="Current deployment stage")
    parser.add_argument("--to-stage", required=True,
                       choices=["canary", "staged", "production", "rollback"],
                       help="Target deployment stage")
    parser.add_argument("--eval-file", help="Path to evaluation results JSON")
    parser.add_argument("--release-token", help="RELEASE_TOKEN (for production)")
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("VECTO PILOT™ - MODEL PROMOTION")
    print("=" * 60)
    
    # Load evaluation metrics if provided
    eval_metrics = None
    if args.eval_file:
        with open(args.eval_file, 'r') as f:
            eval_metrics = json.load(f)
        
        print(f"\n📊 Evaluation metrics loaded:")
        print(f"   Success rate: {eval_metrics['metrics']['success_rate']:.1%}")
        print(f"   Avg latency: {eval_metrics['metrics']['avg_latency_ms']:.0f}ms")
    
    # Prompt for RELEASE_TOKEN if promoting to production
    release_token = args.release_token
    if args.to_stage == "production" and not release_token:
        release_token = getpass.getpass("\n🔐 Enter RELEASE_TOKEN for production deployment: ")
    
    # Validate deployment readiness
    if eval_metrics and args.to_stage in ["canary", "staged", "production"]:
        print(f"\n🔍 Checking deployment readiness...")
        readiness = safety.validate_deployment_readiness(
            model_id=args.model_id,
            evaluation_results=eval_metrics
        )
        
        print(f"\n✅ Readiness checks:")
        for check_name, check_data in readiness["checks"].items():
            status = "✓" if check_data["passed"] else "✗"
            print(f"   {status} {check_name}: {check_data['value']} (threshold: {check_data['threshold']})")
        
        if not readiness["ready"]:
            print(f"\n❌ Model not ready for deployment!")
            print(f"   Failed checks prevent promotion to {args.to_stage}")
            return
        
        if readiness["warnings"]:
            print(f"\n⚠️  Warnings:")
            for warning in readiness["warnings"]:
                print(f"   - {warning}")
    
    # Promote model
    print(f"\n🚀 Promoting {args.model_id}: {args.from_stage} → {args.to_stage}")
    
    try:
        promotion = safety.promote_model(
            model_id=args.model_id,
            from_stage=DeploymentStage(args.from_stage),
            to_stage=DeploymentStage(args.to_stage),
            release_token=release_token,
            evaluation_metrics=eval_metrics
        )
        
        print(f"\n✅ Promotion successful!")
        print(f"   Model: {promotion['model_id']}")
        print(f"   Stage: {promotion['to_stage']}")
        print(f"   Traffic: {promotion['traffic_percentage']}%")
        print(f"   Timestamp: {promotion['promoted_at']}")
        
    except ValueError as e:
        print(f"\n❌ Promotion failed: {str(e)}")
        return
    
    print("\n" + "=" * 60)
    print("✨ Promotion complete!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
