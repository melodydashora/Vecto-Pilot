#!/usr/bin/env node

import dotenv from 'dotenv';

dotenv.config();

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

async function query(question) {
  const response = await fetch(PERPLEXITY_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: question }],
      temperature: 0.1,
      max_tokens: 4000,
      return_citations: true,
      search_recency_filter: 'month'
    })
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

async function main() {
  console.log('🔍 Querying Perplexity about Replit Agent Override...\n');
  
  const q1 = await query(`How can I override or intercept the Replit IDE's AI agent API calls in 2025? I want to redirect agent requests to my own custom backend without using browser extensions like Tampermonkey. What are the available methods: Service Workers, browser DevTools Protocol, userscript managers, or Replit configuration files?`);
  
  console.log('📡 QUERY 1: Agent Override Methods\n');
  console.log(q1);
  console.log('\n' + '='.repeat(80) + '\n');
  
  const q2 = await query(`What is the Replit Agent API endpoint structure in 2025? What are the specific URLs, headers, and authentication tokens used when the Replit IDE makes requests to the AI agent? Include information about WebSocket connections, HTTP endpoints, and any agent configuration files.`);
  
  console.log('📡 QUERY 2: Replit Agent API Endpoints\n');
  console.log(q2);
  console.log('\n' + '='.repeat(80) + '\n');
  
  const q3 = await query(`How can I use Service Workers or browser native APIs to intercept fetch() and WebSocket requests without browser extensions? Provide code examples for intercepting and modifying requests to specific API endpoints in vanilla JavaScript that can be injected into a web page.`);
  
  console.log('📡 QUERY 3: Service Worker & Fetch Interception\n');
  console.log(q3);
}

main().catch(console.error);
