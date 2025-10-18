"""Triad Pipeline Orchestrator - Three-stage ML validation system"""

import time
import json
import uuid
from typing import Dict, Any, Optional, Tuple
from datetime import datetime

from app.mlops.adapters import get_model_adapter
from app.mlops.event_store import event_store
from app.core.config import settings


class TriadOrchestrator:
    """
    Triad Pipeline: Claude Strategist → GPT-5 Planner → Gemini Validator
    
    Single-path pipeline (no fallbacks) with strict invariants:
    - No venue invention (must use catalog or GPS-based generation)
    - Schema strict (JSON must match expected structure)
    - Word caps (responses must meet minimum length requirements)
    """
    
    def __init__(self):
        # Initialize adapters for each stage
        self.strategist = get_model_adapter(
            provider=settings.TRIAD_STRATEGIST_PROVIDER,
            model_name=settings.TRIAD_STRATEGIST_MODEL,
            api_key=settings.ANTHROPIC_API_KEY,
            timeout=settings.TRIAD_STRATEGIST_TIMEOUT_MS / 1000
        )
        
        self.planner = get_model_adapter(
            provider=settings.TRIAD_PLANNER_PROVIDER,
            model_name=settings.TRIAD_PLANNER_MODEL,
            api_key=settings.OPENAI_API_KEY,
            timeout=settings.TRIAD_PLANNER_TIMEOUT_MS / 1000,
            base_url=settings.OPENAI_BASE_URL
        )
        
        self.validator = get_model_adapter(
            provider=settings.TRIAD_VALIDATOR_PROVIDER,
            model_name=settings.TRIAD_VALIDATOR_MODEL,
            api_key=settings.GOOGLEAQ_API_KEY,
            timeout=settings.TRIAD_VALIDATOR_TIMEOUT_MS / 1000
        )
    
    async def execute(self, user_context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute the full Triad pipeline
        
        Args:
            user_context: Driver context including GPS, weather, time, etc.
            
        Returns:
            Final validated output or raises exception on failure
        """
        job_id = str(uuid.uuid4())
        start_time = time.time()
        
        strategist_call_id = None
        planner_call_id = None
        validator_call_id = None
        error_stage = None
        
        try:
            # Stage 1: Strategic Analysis (Claude)
            print(f"[triad:{job_id}] Stage 1/3: Strategic Analysis")
            strategy_prompt = self._build_strategy_prompt(user_context)
            
            strategy_start = time.time()
            strategy_response = await self.strategist.generate(
                prompt=strategy_prompt,
                temperature=settings.TRIAD_STRATEGIST_TEMPERATURE,
                max_tokens=settings.TRIAD_STRATEGIST_MAX_OUTPUT_TOKENS
            )
            
            strategist_call_id = event_store.log_model_call(
                model_provider=self.strategist.provider_name,
                model_name=self.strategist.model_name,
                call_type="strategist",
                prompt=strategy_prompt,
                response=strategy_response.content,
                latency_ms=strategy_response.latency_ms,
                tokens_in=strategy_response.tokens_in,
                tokens_out=strategy_response.tokens_out,
                success=True,
                metadata={"job_id": job_id}
            )
            
            print(f"[triad:{job_id}] ✓ Strategy generated ({strategy_response.latency_ms}ms)")
            
            # Stage 2: Tactical Planning (GPT-5)
            print(f"[triad:{job_id}] Stage 2/3: Tactical Planning")
            planning_prompt = self._build_planning_prompt(user_context, strategy_response.content)
            
            planning_start = time.time()
            planning_response = await self.planner.generate_json(
                prompt=planning_prompt,
                temperature=settings.TRIAD_PLANNER_TEMPERATURE,
                max_tokens=settings.TRIAD_PLANNER_MAX_OUTPUT_TOKENS,
                reasoning_effort="extended"  # Deep reasoning for venue selection
            )
            
            planner_call_id = event_store.log_model_call(
                model_provider=self.planner.provider_name,
                model_name=self.planner.model_name,
                call_type="planner",
                prompt=planning_prompt,
                response=planning_response.content,
                latency_ms=planning_response.latency_ms,
                tokens_in=planning_response.tokens_in,
                tokens_out=planning_response.tokens_out,
                success=True,
                metadata={"job_id": job_id}
            )
            
            print(f"[triad:{job_id}] ✓ Plan generated ({planning_response.latency_ms}ms)")
            
            # Parse JSON
            try:
                plan_data = json.loads(planning_response.content)
            except json.JSONDecodeError as e:
                raise ValueError(f"Planner returned invalid JSON: {e}")
            
            # Stage 3: Validation & Enrichment (Gemini)
            print(f"[triad:{job_id}] Stage 3/3: Validation")
            validation_prompt = self._build_validation_prompt(user_context, plan_data)
            
            validation_start = time.time()
            validation_response = await self.validator.generate_json(
                prompt=validation_prompt,
                temperature=settings.TRIAD_VALIDATOR_TEMPERATURE,
                max_tokens=settings.TRIAD_VALIDATOR_MAX_OUTPUT_TOKENS,
                reasoning_effort="low"  # Fast validation
            )
            
            validator_call_id = event_store.log_model_call(
                model_provider=self.validator.provider_name,
                model_name=self.validator.model_name,
                call_type="validator",
                prompt=validation_prompt,
                response=validation_response.content,
                latency_ms=validation_response.latency_ms,
                tokens_in=validation_response.tokens_in,
                tokens_out=validation_response.tokens_out,
                success=True,
                metadata={"job_id": job_id}
            )
            
            print(f"[triad:{job_id}] ✓ Validation complete ({validation_response.latency_ms}ms)")
            
            # Parse final output
            try:
                final_output = json.loads(validation_response.content)
            except json.JSONDecodeError as e:
                raise ValueError(f"Validator returned invalid JSON: {e}")
            
            # Apply invariant checks
            self._check_invariants(final_output)
            
            total_latency = int((time.time() - start_time) * 1000)
            
            # Log complete Triad job
            event_store.log_triad_job(
                job_id=job_id,
                user_context=user_context,
                strategist_call_id=strategist_call_id,
                planner_call_id=planner_call_id,
                validator_call_id=validator_call_id,
                final_output=final_output,
                success=True,
                total_latency_ms=total_latency
            )
            
            # Log metrics
            event_store.log_metric("latency", "triad_total", total_latency)
            event_store.log_metric("latency", "strategist", strategy_response.latency_ms)
            event_store.log_metric("latency", "planner", planning_response.latency_ms)
            event_store.log_metric("latency", "validator", validation_response.latency_ms)
            
            print(f"[triad:{job_id}] ✅ Pipeline complete ({total_latency}ms total)")
            
            return final_output
            
        except Exception as e:
            error_stage = self._determine_error_stage(
                strategist_call_id,
                planner_call_id,
                validator_call_id
            )
            
            total_latency = int((time.time() - start_time) * 1000)
            
            # Log failed job
            event_store.log_triad_job(
                job_id=job_id,
                user_context=user_context,
                strategist_call_id=strategist_call_id,
                planner_call_id=planner_call_id,
                validator_call_id=validator_call_id,
                final_output=None,
                success=False,
                total_latency_ms=total_latency,
                error_stage=error_stage
            )
            
            event_store.log_metric("error_rate", f"triad_{error_stage}", 1.0)
            
            print(f"[triad:{job_id}] ❌ Pipeline failed at {error_stage}: {str(e)}")
            
            if settings.TRIAD_FAIL_ON_INVALID:
                raise
            else:
                return {"error": str(e), "stage": error_stage}
    
    def _build_strategy_prompt(self, context: Dict[str, Any]) -> str:
        """Build prompt for strategic analysis stage"""
        return f"""You are a rideshare strategy expert analyzing current market conditions.

DRIVER CONTEXT:
- Location: {context.get('location', {}).get('formatted_address', 'Unknown')}
- GPS: {context.get('gps', {}).get('latitude')}, {context.get('gps', {}).get('longitude')}
- Time: {context.get('time', {}).get('local_time', 'Unknown')} ({context.get('time', {}).get('day_of_week', 'Unknown')})
- Weather: {context.get('weather', {}).get('description', 'Unknown')}, {context.get('weather', {}).get('temperature', 'Unknown')}°F
- Airport Traffic: {context.get('airport', {}).get('description', 'None detected')}

TASK:
Analyze the current market conditions and provide strategic recommendations for maximizing driver earnings.

Include:
1. Market overview (demand patterns, surge likelihood)
2. Strategic insights (why certain areas are hot, timing considerations)
3. Pro tips (specific actionable advice)
4. Earnings estimate (hourly potential based on conditions)

Write 200-300 words of actionable strategic analysis."""

    def _build_planning_prompt(self, context: Dict[str, Any], strategy: str) -> str:
        """Build prompt for tactical planning stage"""
        
        # Extract catalog venues if available
        catalog_venues = context.get('catalog_venues', [])
        venue_list = "\n".join([
            f"- {v['name']} ({v['category']}) at {v['formatted_address']}"
            for v in catalog_venues[:50]  # Limit to top 50
        ]) if catalog_venues else "No catalog venues available - generate from GPS coordinates"
        
        return f"""You are a tactical planning expert creating specific venue recommendations.

STRATEGIC ANALYSIS:
{strategy}

DRIVER CONTEXT:
- GPS: {context.get('gps', {}).get('latitude')}, {context.get('gps', {}).get('longitude')}
- Location: {context.get('location', {}).get('formatted_address', 'Unknown')}
- Time: {context.get('time', {}).get('local_time', 'Unknown')}

AVAILABLE VENUES:
{venue_list}

TASK:
Create a tactical plan with 4-6 specific venue recommendations.

REQUIREMENTS:
1. If catalog venues available: Select from list above
2. If no catalog: Generate specific venues near GPS coordinates
3. Staging area: Must be centrally positioned (1-2 min drive to all venues)
4. Venue spacing: Spread venues 2-3 minutes apart
5. Include: venue name, address, distance, reasoning

Respond with JSON:
{{
  "staging_area": {{
    "name": "string",
    "address": "string",
    "reasoning": "string"
  }},
  "venues": [
    {{
      "name": "string",
      "address": "string",
      "category": "string",
      "distance_miles": number,
      "drive_time_minutes": number,
      "reasoning": "string"
    }}
  ]
}}"""

    def _build_validation_prompt(self, context: Dict[str, Any], plan: Dict[str, Any]) -> str:
        """Build prompt for validation stage"""
        return f"""You are a quality assurance validator for rideshare recommendations.

TACTICAL PLAN:
{json.dumps(plan, indent=2)}

VALIDATION TASKS:
1. Check JSON structure (all required fields present)
2. Verify venue count (minimum 4 venues)
3. Validate addresses (must be specific, not generic)
4. Check distance calculations (reasonable estimates)
5. Ensure reasoning is detailed (>20 words per venue)

CORRECTIONS NEEDED:
- If venue count < 4: Add more venues
- If addresses vague: Make specific
- If reasoning short: Expand details

Respond with the VALIDATED and CORRECTED JSON plan in the exact same format."""

    def _check_invariants(self, output: Dict[str, Any]):
        """Check Triad invariants"""
        
        # Invariant: Minimum venue count
        venues = output.get('venues', [])
        if len(venues) < 4:
            raise ValueError(f"Invariant violation: Must have at least 4 venues, got {len(venues)}")
        
        # Invariant: Schema strict - all venues must have required fields
        required_fields = ['name', 'address', 'category', 'distance_miles', 'drive_time_minutes', 'reasoning']
        for i, venue in enumerate(venues):
            missing = [f for f in required_fields if f not in venue]
            if missing:
                raise ValueError(f"Invariant violation: Venue {i} missing fields: {missing}")
        
        # Invariant: Word caps - reasoning must be substantive
        if settings.TRIAD_INVARIANT_WORD_CAPS:
            for i, venue in enumerate(venues):
                word_count = len(venue['reasoning'].split())
                if word_count < 15:
                    raise ValueError(f"Invariant violation: Venue {i} reasoning too short ({word_count} words, need 15+)")
        
        # Invariant: Staging area required
        if not output.get('staging_area'):
            raise ValueError("Invariant violation: Staging area required")
    
    def _determine_error_stage(
        self,
        strategist_id: Optional[int],
        planner_id: Optional[int],
        validator_id: Optional[int]
    ) -> str:
        """Determine which stage failed"""
        if validator_id:
            return "validator"
        elif planner_id:
            return "planner"
        elif strategist_id:
            return "strategist"
        else:
            return "initialization"


# Global singleton
triad = TriadOrchestrator()
