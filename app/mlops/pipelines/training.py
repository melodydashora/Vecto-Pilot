"""Training data pipeline - Export event store data to versioned datasets"""

import json
import gzip
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List
from app.mlops.event_store import event_store


class TrainingPipeline:
    """Export and version training datasets from event store"""
    
    def __init__(self, output_dir: str = "data/mlops/datasets"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
    
    def export_dataset(
        self,
        name: str,
        call_type: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        format: str = "jsonl",
        compress: bool = True
    ) -> Dict[str, Any]:
        """
        Export training dataset from event store
        
        Args:
            name: Dataset name (e.g. 'strategist_v1')
            call_type: Filter by call type ('strategist', 'planner', 'validator')
            start_date: ISO date string for filtering
            end_date: ISO date string for filtering
            format: Output format ('jsonl', 'openai', 'anthropic')
            compress: Whether to gzip compress output
            
        Returns:
            Export metadata
        """
        version = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_filename = f"{name}_{version}"
        
        # Export raw data
        temp_file = self.output_dir / f"{base_filename}.jsonl"
        record_count = event_store.export_training_data(
            output_path=str(temp_file),
            call_type=call_type,
            start_date=start_date,
            end_date=end_date
        )
        
        # Convert format if needed
        if format in ("openai", "anthropic"):
            formatted_file = self.output_dir / f"{base_filename}_{format}.jsonl"
            self._convert_format(temp_file, formatted_file, format)
            final_file = formatted_file
        else:
            final_file = temp_file
        
        # Compress if requested
        if compress:
            compressed_file = Path(str(final_file) + ".gz")
            with open(final_file, 'rb') as f_in:
                with gzip.open(compressed_file, 'wb') as f_out:
                    f_out.writelines(f_in)
            final_file.unlink()  # Remove uncompressed
            final_file = compressed_file
        
        # Save metadata
        metadata = {
            "name": name,
            "version": version,
            "call_type": call_type,
            "start_date": start_date,
            "end_date": end_date,
            "format": format,
            "compressed": compress,
            "record_count": record_count,
            "file_path": str(final_file),
            "created_at": datetime.utcnow().isoformat()
        }
        
        metadata_file = self.output_dir / f"{base_filename}.meta.json"
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        print(f"[training] ✓ Exported {record_count} records to {final_file}")
        
        return metadata
    
    def _convert_format(self, input_file: Path, output_file: Path, format: str):
        """Convert raw JSONL to provider-specific format"""
        with open(input_file, 'r') as f_in:
            with open(output_file, 'w') as f_out:
                for line in f_in:
                    record = json.loads(line)
                    
                    if format == "openai":
                        # OpenAI fine-tuning format
                        converted = {
                            "messages": [
                                {"role": "user", "content": record["prompt"]},
                                {"role": "assistant", "content": record["response"]}
                            ]
                        }
                    elif format == "anthropic":
                        # Anthropic fine-tuning format
                        converted = {
                            "prompt": record["prompt"],
                            "completion": record["response"]
                        }
                    else:
                        converted = record
                    
                    f_out.write(json.dumps(converted) + '\n')
    
    def create_train_val_split(
        self,
        dataset_path: str,
        train_ratio: float = 0.8,
        seed: int = 42
    ) -> Dict[str, str]:
        """Split dataset into train/validation sets"""
        import random
        random.seed(seed)
        
        dataset = Path(dataset_path)
        base_name = dataset.stem.replace('.jsonl', '')
        
        # Read all records
        with open(dataset, 'r') as f:
            records = f.readlines()
        
        # Shuffle and split
        random.shuffle(records)
        split_idx = int(len(records) * train_ratio)
        train_records = records[:split_idx]
        val_records = records[split_idx:]
        
        # Write splits
        train_file = dataset.parent / f"{base_name}_train.jsonl"
        val_file = dataset.parent / f"{base_name}_val.jsonl"
        
        with open(train_file, 'w') as f:
            f.writelines(train_records)
        
        with open(val_file, 'w') as f:
            f.writelines(val_records)
        
        print(f"[training] ✓ Split: {len(train_records)} train, {len(val_records)} val")
        
        return {
            "train": str(train_file),
            "val": str(val_file),
            "train_count": len(train_records),
            "val_count": len(val_records)
        }
    
    def list_datasets(self) -> List[Dict[str, Any]]:
        """List all exported datasets"""
        datasets = []
        for meta_file in self.output_dir.glob("*.meta.json"):
            with open(meta_file, 'r') as f:
                datasets.append(json.load(f))
        
        return sorted(datasets, key=lambda x: x["created_at"], reverse=True)


# Global singleton
training_pipeline = TrainingPipeline()
