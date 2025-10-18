"""Fine-tuning pipeline - Support for cloud APIs and local model training"""

import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional
from openai import AsyncOpenAI
from anthropic import AsyncAnthropic


class FineTuningPipeline:
    """Manage fine-tuning jobs for cloud providers and local models"""
    
    def __init__(self, jobs_dir: str = "data/mlops/finetuning"):
        self.jobs_dir = Path(jobs_dir)
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
    
    async def create_openai_finetune(
        self,
        training_file_path: str,
        model: str = "gpt-4o-mini-2024-07-18",
        suffix: Optional[str] = None,
        hyperparameters: Optional[Dict[str, Any]] = None,
        api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create OpenAI fine-tuning job"""
        client = AsyncOpenAI(api_key=api_key)
        
        # Upload training file
        print(f"[finetune] Uploading training file to OpenAI...")
        with open(training_file_path, 'rb') as f:
            training_file = await client.files.create(
                file=f,
                purpose='fine-tune'
            )
        
        print(f"[finetune] ✓ File uploaded: {training_file.id}")
        
        # Create fine-tuning job
        params = {
            "training_file": training_file.id,
            "model": model
        }
        
        if suffix:
            params["suffix"] = suffix
        if hyperparameters:
            params["hyperparameters"] = hyperparameters
        
        job = await client.fine_tuning.jobs.create(**params)
        
        # Save job metadata
        job_metadata = {
            "job_id": job.id,
            "provider": "openai",
            "base_model": model,
            "training_file_id": training_file.id,
            "status": job.status,
            "created_at": job.created_at,
            "hyperparameters": hyperparameters,
            "metadata": job.model_dump()
        }
        
        job_file = self.jobs_dir / f"openai_{job.id}.json"
        with open(job_file, 'w') as f:
            json.dump(job_metadata, f, indent=2)
        
        print(f"[finetune] ✓ Fine-tuning job created: {job.id}")
        print(f"[finetune] Status: {job.status}")
        
        return job_metadata
    
    async def check_openai_status(
        self,
        job_id: str,
        api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """Check OpenAI fine-tuning job status"""
        client = AsyncOpenAI(api_key=api_key)
        
        job = await client.fine_tuning.jobs.retrieve(job_id)
        
        status = {
            "job_id": job.id,
            "status": job.status,
            "fine_tuned_model": job.fine_tuned_model,
            "finished_at": job.finished_at,
            "trained_tokens": job.trained_tokens,
            "error": job.error.message if job.error else None
        }
        
        print(f"[finetune] Job {job_id}: {job.status}")
        if job.fine_tuned_model:
            print(f"[finetune] ✓ Model: {job.fine_tuned_model}")
        
        return status
    
    async def create_anthropic_finetune(
        self,
        training_file_path: str,
        model: str = "claude-3-5-sonnet-20241022",
        api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Placeholder for Anthropic fine-tuning
        Note: Anthropic doesn't currently offer public fine-tuning API
        """
        print(f"[finetune] ⚠️  Anthropic fine-tuning not yet available via API")
        print(f"[finetune] Contact Anthropic for enterprise fine-tuning options")
        
        return {
            "provider": "anthropic",
            "status": "not_supported",
            "message": "Contact Anthropic for enterprise fine-tuning"
        }
    
    def create_local_finetune(
        self,
        training_file_path: str,
        base_model: str,
        output_dir: Optional[str] = None,
        hyperparameters: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create configuration for local model fine-tuning
        
        This generates a training config that can be used with:
        - Hugging Face transformers
        - LLaMA.cpp
        - vLLM
        - Other local training frameworks
        """
        if output_dir is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_dir = str(self.jobs_dir / f"local_{timestamp}")
        
        default_hyperparameters = {
            "learning_rate": 2e-5,
            "num_epochs": 3,
            "batch_size": 4,
            "gradient_accumulation_steps": 4,
            "warmup_steps": 100,
            "max_seq_length": 2048,
            "lora_r": 8,
            "lora_alpha": 16,
            "lora_dropout": 0.05
        }
        
        if hyperparameters:
            default_hyperparameters.update(hyperparameters)
        
        config = {
            "provider": "local",
            "base_model": base_model,
            "training_file": training_file_path,
            "output_dir": output_dir,
            "hyperparameters": default_hyperparameters,
            "created_at": datetime.utcnow().isoformat()
        }
        
        config_file = Path(output_dir) / "training_config.json"
        config_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(config_file, 'w') as f:
            json.dump(config, f, indent=2)
        
        # Create training script template
        training_script = f"""#!/usr/bin/env python3
# Auto-generated training script for local fine-tuning

import json
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer
from datasets import load_dataset

# Load config
with open('{config_file}', 'r') as f:
    config = json.load(f)

# Load model and tokenizer
model = AutoModelForCausalLM.from_pretrained(config['base_model'])
tokenizer = AutoTokenizer.from_pretrained(config['base_model'])

# Load dataset
dataset = load_dataset('json', data_files=config['training_file'])

# Training arguments
training_args = TrainingArguments(
    output_dir=config['output_dir'],
    num_train_epochs=config['hyperparameters']['num_epochs'],
    per_device_train_batch_size=config['hyperparameters']['batch_size'],
    learning_rate=config['hyperparameters']['learning_rate'],
    warmup_steps=config['hyperparameters']['warmup_steps'],
    logging_steps=10,
    save_steps=100,
    evaluation_strategy="steps",
    eval_steps=100,
)

# Initialize trainer
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=dataset['train'],
    tokenizer=tokenizer,
)

# Start training
trainer.train()

# Save model
trainer.save_model(config['output_dir'] + '/final')
print(f"✓ Model saved to {{config['output_dir']}}/final")
"""
        
        script_file = Path(output_dir) / "train.py"
        with open(script_file, 'w') as f:
            f.write(training_script)
        
        script_file.chmod(0o755)
        
        print(f"[finetune] ✓ Local training config created: {config_file}")
        print(f"[finetune] ✓ Training script: {script_file}")
        print(f"[finetune] Run: python {script_file}")
        
        return config
    
    def list_jobs(self) -> list:
        """List all fine-tuning jobs"""
        jobs = []
        for job_file in self.jobs_dir.glob("*.json"):
            if job_file.name != "training_config.json":
                with open(job_file, 'r') as f:
                    jobs.append(json.load(f))
        
        return sorted(jobs, key=lambda x: x.get("created_at", ""), reverse=True)


# Global singleton
finetuning_pipeline = FineTuningPipeline()
