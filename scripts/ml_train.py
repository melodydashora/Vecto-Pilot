#!/usr/bin/env python3
"""MLOps Training Script - Export training data and create datasets"""

import asyncio
import argparse
from pathlib import Path
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.mlops.pipelines.training import training_pipeline


async def main():
    parser = argparse.ArgumentParser(description="Export and prepare training datasets")
    parser.add_argument("--name", required=True, help="Dataset name (e.g. 'strategist_v1')")
    parser.add_argument("--call-type", choices=["strategist", "planner", "validator"], 
                       help="Filter by call type")
    parser.add_argument("--start-date", help="Start date (ISO format)")
    parser.add_argument("--end-date", help="End date (ISO format)")
    parser.add_argument("--format", choices=["jsonl", "openai", "anthropic"], 
                       default="jsonl", help="Output format")
    parser.add_argument("--no-compress", action="store_true", help="Don't compress output")
    parser.add_argument("--split", action="store_true", help="Create train/val split")
    parser.add_argument("--train-ratio", type=float, default=0.8, 
                       help="Train split ratio (default: 0.8)")
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("VECTO PILOT™ - ML TRAINING PIPELINE")
    print("=" * 60)
    
    # Export dataset
    print(f"\n📊 Exporting dataset: {args.name}")
    metadata = training_pipeline.export_dataset(
        name=args.name,
        call_type=args.call_type,
        start_date=args.start_date,
        end_date=args.end_date,
        format=args.format,
        compress=not args.no_compress
    )
    
    print(f"\n✅ Dataset exported successfully!")
    print(f"   Records: {metadata['record_count']}")
    print(f"   File: {metadata['file_path']}")
    print(f"   Format: {metadata['format']}")
    
    # Create train/val split if requested
    if args.split:
        print(f"\n🔀 Creating train/validation split (ratio: {args.train_ratio})...")
        split_info = training_pipeline.create_train_val_split(
            dataset_path=metadata['file_path'].replace('.gz', ''),
            train_ratio=args.train_ratio
        )
        
        print(f"\n✅ Split created:")
        print(f"   Train: {split_info['train']} ({split_info['train_count']} records)")
        print(f"   Val: {split_info['val']} ({split_info['val_count']} records)")
    
    # List all datasets
    print(f"\n📚 Available datasets:")
    datasets = training_pipeline.list_datasets()
    for ds in datasets[:5]:  # Show latest 5
        print(f"   - {ds['name']} ({ds['record_count']} records) - {ds['created_at']}")
    
    print("\n" + "=" * 60)
    print("✨ Training pipeline complete!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
