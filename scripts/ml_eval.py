#!/usr/bin/env python3
"""MLOps Evaluation Script - Evaluate model performance"""

import asyncio
import argparse
import json
from pathlib import Path
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.mlops.pipelines.evaluation import evaluation_pipeline
from app.core.config import settings


async def main():
    parser = argparse.ArgumentParser(description="Evaluate model performance")
    parser.add_argument("--provider", required=True, 
                       choices=["openai", "anthropic", "google", "local"],
                       help="Model provider")
    parser.add_argument("--model", required=True, help="Model name/ID")
    parser.add_argument("--val-file", required=True, help="Path to validation JSONL file")
    parser.add_argument("--api-key", help="API key (if not in env)")
    parser.add_argument("--metrics", nargs="+", 
                       default=["latency", "token_efficiency", "json_validity"],
                       help="Metrics to compute")
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("VECTO PILOT™ - ML EVALUATION PIPELINE")
    print("=" * 60)
    
    print(f"\n🔍 Evaluating model: {args.provider}/{args.model}")
    print(f"   Validation file: {args.val_file}")
    print(f"   Metrics: {', '.join(args.metrics)}")
    
    # Get API key
    api_key = args.api_key
    if not api_key:
        if args.provider == "openai":
            api_key = settings.OPENAI_API_KEY
        elif args.provider == "anthropic":
            api_key = settings.ANTHROPIC_API_KEY
        elif args.provider == "google":
            api_key = settings.GOOGLEAQ_API_KEY
    
    # Run evaluation
    results = await evaluation_pipeline.evaluate_model(
        provider=args.provider,
        model_name=args.model,
        validation_file=args.val_file,
        metrics=args.metrics,
        api_key=api_key
    )
    
    # Print results
    print(f"\n📊 EVALUATION RESULTS")
    print("=" * 60)
    print(f"Success Rate: {results['metrics']['success_rate']:.1%}")
    print(f"Avg Latency: {results['metrics']['avg_latency_ms']:.0f}ms")
    print(f"JSON Validity: {results['metrics']['json_validity_rate']:.1%}")
    print(f"Total Tokens In: {results['metrics']['total_tokens_in']}")
    print(f"Total Tokens Out: {results['metrics']['total_tokens_out']}")
    
    print("\n" + "=" * 60)
    print("✨ Evaluation complete!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
