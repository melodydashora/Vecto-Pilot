
#!/bin/bash

# Test Perplexity API for comprehensive briefing fields
# Make sure PERPLEXITY_API_KEY is set in your environment

if [ -z "$PERPLEXITY_API_KEY" ]; then
  echo "❌ PERPLEXITY_API_KEY not set"
  echo "Run: export PERPLEXITY_API_KEY=your_key_here"
  exit 1
fi

# Sample snapshot data
CITY="Frisco"
STATE="TX"
LAT="33.1285"
LNG="-96.8756"
DATE=$(date +%Y-%m-%d)

echo "🔍 Testing Perplexity Comprehensive Research"
echo "📍 Location: $CITY, $STATE"
echo "📅 Date: $DATE"
echo ""

# Function to call Perplexity
call_perplexity() {
  local field_name=$1
  local prompt=$2
  
  echo ""
  echo "🔄 Fetching: $field_name..."
  
  curl -s https://api.perplexity.ai/chat/completions \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"sonar-pro\",
      \"messages\": [
        {\"role\": \"system\", \"content\": \"You are a rideshare driver intelligence assistant. Provide factual, concise information with sources.\"},
        {\"role\": \"user\", \"content\": \"$prompt\"}
      ],
      \"max_tokens\": 500,
      \"temperature\": 0.2,
      \"search_recency_filter\": \"day\",
      \"return_images\": false,
      \"return_related_questions\": false,
      \"stream\": false
    }" | jq -r '.choices[0].message.content' > /tmp/perplexity_${field_name}.txt
  
  echo "✅ $field_name:"
  head -c 100 /tmp/perplexity_${field_name}.txt
  echo "..."
  echo ""
  
  sleep 1  # Rate limiting
}

# Test each field
call_perplexity "global_travel" \
  "What are the current global travel conditions affecting the $CITY, $STATE region today ($DATE)? Include flight delays, international travel alerts, or global events impacting this area. Be concise (2-3 sentences)."

call_perplexity "domestic_travel" \
  "What are the current domestic (US) travel conditions affecting $CITY, $STATE today ($DATE)? Include airline delays, TSA issues, or national events affecting travel. Be concise (2-3 sentences)."

call_perplexity "local_traffic" \
  "What are the current local traffic conditions, road construction, and incidents in $CITY, $STATE today ($DATE)? Focus on major roads and highways affecting rideshare drivers. Be specific and concise (2-3 sentences)."

call_perplexity "weather_impacts" \
  "How is current weather impacting travel and rideshare operations in $CITY, $STATE today ($DATE)? Include any weather alerts or conditions affecting driving. Be concise (2-3 sentences)."

call_perplexity "events_nearby" \
  "What major events (concerts, games, festivals) are happening TODAY within 50 miles of $CITY, $STATE ($LAT, $LNG) on $DATE? List specific venues, times, and expected attendance if available. Be concise."

call_perplexity "holidays" \
  "Is today ($DATE) a holiday in $CITY, $STATE? If yes, state the holiday name and how it affects rideshare demand. If no, just say 'No holiday today'. Be brief (1 sentence)."

call_perplexity "rideshare_intel" \
  "What rideshare-specific intelligence is relevant for drivers in $CITY, $STATE today ($DATE)? Include surge zones, driver incentives, or platform updates. Be concise (2-3 sentences)."

echo ""
echo "📊 All results saved to /tmp/perplexity_*.txt"
echo ""
echo "View results:"
echo "  cat /tmp/perplexity_global_travel.txt"
echo "  cat /tmp/perplexity_domestic_travel.txt"
echo "  cat /tmp/perplexity_local_traffic.txt"
echo "  cat /tmp/perplexity_weather_impacts.txt"
echo "  cat /tmp/perplexity_events_nearby.txt"
echo "  cat /tmp/perplexity_holidays.txt"
echo "  cat /tmp/perplexity_rideshare_intel.txt"
