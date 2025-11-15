// Test SSE connection to blocks endpoint
import eventsource from 'eventsource';
const EventSource = eventsource;

console.log('Testing SSE connection to /events/blocks...');

const es = new EventSource('http://localhost:5000/events/blocks');

es.onopen = () => {
  console.log('✅ SSE connection opened');
};

es.onerror = (err) => {
  console.error('❌ SSE error:', err);
};

es.addEventListener('blocks_ready', (event) => {
  console.log('📢 blocks_ready event received:', event.data);
});

// Keep alive for 10 seconds
setTimeout(() => {
  es.close();
  console.log('Test completed');
  process.exit(0);
}, 10000);
