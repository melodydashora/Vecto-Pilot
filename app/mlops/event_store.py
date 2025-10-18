"""MLOps Event Store - Captures all model interactions for training data"""

import sqlite3
import json
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List
from contextlib import contextmanager

class MLOpsEventStore:
    """SQLite-based event store for ML observability and training data capture"""
    
    def __init__(self, db_path: str = "data/mlops/events.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
    
    def _init_db(self):
        """Initialize event store schema"""
        with self._get_conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS model_calls (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    model_provider TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    call_type TEXT NOT NULL,  -- 'strategist', 'planner', 'validator', 'agent'
                    prompt_hash TEXT NOT NULL,
                    response_hash TEXT,
                    latency_ms INTEGER,
                    tokens_in INTEGER,
                    tokens_out INTEGER,
                    success BOOLEAN NOT NULL,
                    error_message TEXT,
                    metadata TEXT  -- JSON
                );
                
                CREATE TABLE IF NOT EXISTS prompts (
                    hash TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                
                CREATE TABLE IF NOT EXISTS responses (
                    hash TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                
                CREATE TABLE IF NOT EXISTS triad_jobs (
                    id TEXT PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    user_context TEXT NOT NULL,  -- JSON: GPS, weather, time, etc.
                    strategist_call_id INTEGER,
                    planner_call_id INTEGER,
                    validator_call_id INTEGER,
                    final_output TEXT,  -- JSON
                    success BOOLEAN NOT NULL,
                    total_latency_ms INTEGER,
                    error_stage TEXT,
                    FOREIGN KEY (strategist_call_id) REFERENCES model_calls(id),
                    FOREIGN KEY (planner_call_id) REFERENCES model_calls(id),
                    FOREIGN KEY (validator_call_id) REFERENCES model_calls(id)
                );
                
                CREATE TABLE IF NOT EXISTS metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    metric_type TEXT NOT NULL,  -- 'latency', 'token_usage', 'error_rate'
                    metric_name TEXT NOT NULL,
                    value REAL NOT NULL,
                    labels TEXT  -- JSON
                );
                
                CREATE TABLE IF NOT EXISTS experiments (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    config TEXT NOT NULL,  -- JSON
                    started_at TEXT NOT NULL,
                    completed_at TEXT,
                    status TEXT NOT NULL,  -- 'running', 'completed', 'failed'
                    results TEXT  -- JSON
                );
                
                CREATE TABLE IF NOT EXISTS model_versions (
                    id TEXT PRIMARY KEY,
                    model_name TEXT NOT NULL,
                    version TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    config TEXT NOT NULL,  -- JSON
                    deployed_at TEXT NOT NULL,
                    promoted_from TEXT,  -- experiment_id
                    performance_metrics TEXT,  -- JSON
                    status TEXT NOT NULL  -- 'canary', 'active', 'deprecated'
                );
                
                CREATE INDEX IF NOT EXISTS idx_model_calls_timestamp ON model_calls(timestamp);
                CREATE INDEX IF NOT EXISTS idx_model_calls_type ON model_calls(call_type);
                CREATE INDEX IF NOT EXISTS idx_triad_jobs_timestamp ON triad_jobs(timestamp);
                CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
            """)
    
    @contextmanager
    def _get_conn(self):
        """Context manager for database connections"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def _hash_content(self, content: str) -> str:
        """Generate SHA256 hash of content"""
        return hashlib.sha256(content.encode()).hexdigest()
    
    def log_model_call(
        self,
        model_provider: str,
        model_name: str,
        call_type: str,
        prompt: str,
        response: Optional[str] = None,
        latency_ms: Optional[int] = None,
        tokens_in: Optional[int] = None,
        tokens_out: Optional[int] = None,
        success: bool = True,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> int:
        """Log a model API call"""
        prompt_hash = self._hash_content(prompt)
        response_hash = self._hash_content(response) if response else None
        
        with self._get_conn() as conn:
            # Store prompt
            conn.execute(
                "INSERT OR IGNORE INTO prompts (hash, content, created_at) VALUES (?, ?, ?)",
                (prompt_hash, prompt, datetime.utcnow().isoformat())
            )
            
            # Store response
            if response:
                conn.execute(
                    "INSERT OR IGNORE INTO responses (hash, content, created_at) VALUES (?, ?, ?)",
                    (response_hash, response, datetime.utcnow().isoformat())
                )
            
            # Store model call
            cursor = conn.execute(
                """INSERT INTO model_calls 
                   (timestamp, model_provider, model_name, call_type, prompt_hash, response_hash,
                    latency_ms, tokens_in, tokens_out, success, error_message, metadata)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    datetime.utcnow().isoformat(),
                    model_provider,
                    model_name,
                    call_type,
                    prompt_hash,
                    response_hash,
                    latency_ms,
                    tokens_in,
                    tokens_out,
                    success,
                    error_message,
                    json.dumps(metadata) if metadata else None
                )
            )
            return cursor.lastrowid
    
    def log_triad_job(
        self,
        job_id: str,
        user_context: Dict[str, Any],
        strategist_call_id: Optional[int],
        planner_call_id: Optional[int],
        validator_call_id: Optional[int],
        final_output: Optional[Dict[str, Any]],
        success: bool,
        total_latency_ms: int,
        error_stage: Optional[str] = None
    ):
        """Log a complete Triad pipeline execution"""
        with self._get_conn() as conn:
            conn.execute(
                """INSERT INTO triad_jobs 
                   (id, timestamp, user_context, strategist_call_id, planner_call_id, 
                    validator_call_id, final_output, success, total_latency_ms, error_stage)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    job_id,
                    datetime.utcnow().isoformat(),
                    json.dumps(user_context),
                    strategist_call_id,
                    planner_call_id,
                    validator_call_id,
                    json.dumps(final_output) if final_output else None,
                    success,
                    total_latency_ms,
                    error_stage
                )
            )
    
    def log_metric(self, metric_type: str, metric_name: str, value: float, labels: Optional[Dict[str, str]] = None):
        """Log a metric for observability"""
        with self._get_conn() as conn:
            conn.execute(
                "INSERT INTO metrics (timestamp, metric_type, metric_name, value, labels) VALUES (?, ?, ?, ?, ?)",
                (
                    datetime.utcnow().isoformat(),
                    metric_type,
                    metric_name,
                    value,
                    json.dumps(labels) if labels else None
                )
            )
    
    def export_training_data(
        self,
        output_path: str,
        call_type: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> int:
        """Export model calls to JSONL for training"""
        query = """
            SELECT 
                mc.id,
                mc.timestamp,
                mc.model_provider,
                mc.model_name,
                mc.call_type,
                p.content as prompt,
                r.content as response,
                mc.tokens_in,
                mc.tokens_out,
                mc.success,
                mc.metadata
            FROM model_calls mc
            LEFT JOIN prompts p ON mc.prompt_hash = p.hash
            LEFT JOIN responses r ON mc.response_hash = r.hash
            WHERE mc.success = 1
        """
        params = []
        
        if call_type:
            query += " AND mc.call_type = ?"
            params.append(call_type)
        if start_date:
            query += " AND mc.timestamp >= ?"
            params.append(start_date)
        if end_date:
            query += " AND mc.timestamp <= ?"
            params.append(end_date)
        
        with self._get_conn() as conn:
            rows = conn.execute(query, params).fetchall()
        
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_file, 'w') as f:
            for row in rows:
                record = {
                    "id": row["id"],
                    "timestamp": row["timestamp"],
                    "model_provider": row["model_provider"],
                    "model_name": row["model_name"],
                    "call_type": row["call_type"],
                    "prompt": row["prompt"],
                    "response": row["response"],
                    "tokens_in": row["tokens_in"],
                    "tokens_out": row["tokens_out"],
                    "metadata": json.loads(row["metadata"]) if row["metadata"] else None
                }
                f.write(json.dumps(record) + '\n')
        
        return len(rows)
    
    def get_performance_metrics(
        self,
        call_type: Optional[str] = None,
        hours: int = 24
    ) -> Dict[str, Any]:
        """Get performance metrics for the last N hours"""
        query = """
            SELECT 
                COUNT(*) as total_calls,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_calls,
                AVG(latency_ms) as avg_latency_ms,
                MAX(latency_ms) as max_latency_ms,
                AVG(tokens_in) as avg_tokens_in,
                AVG(tokens_out) as avg_tokens_out,
                SUM(tokens_in) as total_tokens_in,
                SUM(tokens_out) as total_tokens_out
            FROM model_calls
            WHERE timestamp >= datetime('now', '-' || ? || ' hours')
        """
        params = [hours]
        
        if call_type:
            query += " AND call_type = ?"
            params.append(call_type)
        
        with self._get_conn() as conn:
            row = conn.execute(query, params).fetchone()
        
        return {
            "total_calls": row["total_calls"],
            "successful_calls": row["successful_calls"],
            "success_rate": row["successful_calls"] / row["total_calls"] if row["total_calls"] > 0 else 0,
            "avg_latency_ms": row["avg_latency_ms"],
            "max_latency_ms": row["max_latency_ms"],
            "avg_tokens_in": row["avg_tokens_in"],
            "avg_tokens_out": row["avg_tokens_out"],
            "total_tokens_in": row["total_tokens_in"],
            "total_tokens_out": row["total_tokens_out"]
        }


# Global singleton
event_store = MLOpsEventStore()
