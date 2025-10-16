# Replit Agent Override Guide

> **Research Date**: October 16, 2025  
> **Data Source**: Perplexity AI + Technical Research

---

## 🎯 Goal

Override Replit IDE's AI agent to redirect requests to a custom backend **without browser extensions** (no Tampermonkey).

---

## 📊 Available Methods (Ranked by Feasibility)

### ✅ 1. Service Workers (RECOMMENDED)
**Feasibility**: HIGH  
**Complexity**: Medium

Service Workers can intercept and modify network requests including `fetch()` and potentially WebSocket connections.

#### Advantages:
- Native browser API (no extensions needed)
- Can intercept all HTTP/HTTPS requests
- Modify request headers and responses
- Works offline
- Full control over request routing

#### Limitations:
- Requires HTTPS (or localhost)
- User must grant permission (one-time)
- Cannot intercept same-origin requests without registration
- May conflict with Replit's security policies

---

### ⚠️ 2. Proxy Server (ALTERNATIVE)
**Feasibility**: HIGH  
**Complexity**: High

Run a proxy server between Replit and the internet to intercept API calls.

#### Implementation:
- Tools: `mitmproxy`, `nginx`, custom Node.js proxy
- Configure Replit to route requests through proxy
- Intercept and redirect agent API calls

#### Advantages:
- Complete control over all network traffic
- Can log/modify any request
- Works for WebSocket and HTTP

#### Limitations:
- Requires external server infrastructure
- SSL/TLS certificate management needed
- Higher latency due to extra hop

---

### 🔧 3. Browser DevTools Protocol
**Feasibility**: MEDIUM  
**Complexity**: High

Use Puppeteer or Playwright to automate browser and intercept requests.

#### Use Case:
- Automated testing
- Programmatic API interception
- Requires running separate process

#### Limitations:
- Not suitable for live IDE usage
- Requires headless browser or automation framework

---

### ❌ 4. Replit Configuration Files
**Feasibility**: LOW  
**Complexity**: N/A

Replit does not allow direct modification of internal API calls through configuration files.

---

## 🚀 Implementation: Service Worker Method

### Step 1: Create Service Worker Script

Create `public/agent-override-sw.js`:

\`\`\`javascript
// agent-override-sw.js - Service Worker for Replit Agent Override
self.addEventListener('install', (event) => {
  console.log('🔧 Agent Override Service Worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('✅ Agent Override Service Worker activated');
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Intercept Replit Agent API calls
  // Common patterns: /api/agent, /api/chat, /api/completion, etc.
  const agentEndpoints = [
    '/api/agent',
    '/api/chat',
    '/api/completion',
    '/api/assistant',
    '/agent/llm'
  ];
  
  const isAgentRequest = agentEndpoints.some(endpoint => 
    url.pathname.includes(endpoint)
  );
  
  if (isAgentRequest) {
    console.log('🎯 Intercepting agent request:', url.pathname);
    
    event.respondWith(
      (async () => {
        try {
          // Clone the original request
          const originalRequest = event.request.clone();
          const requestBody = await originalRequest.text();
          
          // Redirect to YOUR custom backend
          const customBackendUrl = 'http://localhost:3101/agent/llm'; // Your Eidolon server
          
          const customRequest = new Request(customBackendUrl, {
            method: originalRequest.method,
            headers: {
              ...Object.fromEntries(originalRequest.headers),
              'X-Override-Source': 'ServiceWorker',
              'X-Original-URL': url.href
            },
            body: requestBody,
            mode: 'cors',
            credentials: 'include'
          });
          
          // Fetch from YOUR backend
          const response = await fetch(customRequest);
          
          console.log('✅ Custom backend response:', response.status);
          
          return response;
        } catch (error) {
          console.error('❌ Service Worker error:', error);
          
          // Fallback: Return error response
          return new Response(JSON.stringify({
            error: 'Agent Override Failed',
            message: error.message
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })()
    );
    
    return; // Prevent default handling
  }
  
  // For all other requests, proceed normally
  // (Don't intercept non-agent requests)
});
\`\`\`

---

### Step 2: Register Service Worker (Browser Console)

Inject this into Replit IDE via browser DevTools console:

\`\`\`javascript
// Run in Replit IDE browser console
(async () => {
  if ('serviceWorker' in navigator) {
    try {
      // Unregister any existing service workers
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
        console.log('🗑️ Unregistered existing service worker');
      }
      
      // Register new service worker
      const registration = await navigator.serviceWorker.register(
        '/agent-override-sw.js',
        { scope: '/' }
      );
      
      console.log('✅ Agent Override Service Worker registered!', registration);
      
      // Wait for activation
      await navigator.serviceWorker.ready;
      console.log('🚀 Service Worker active and ready!');
      
    } catch (error) {
      console.error('❌ Service Worker registration failed:', error);
    }
  } else {
    console.error('❌ Service Workers not supported in this browser');
  }
})();
\`\`\`

---

### Step 3: Verify Interception

Check browser console for intercept logs:
- `🎯 Intercepting agent request: /api/agent`
- `✅ Custom backend response: 200`

---

## 🔍 Replit Agent API Endpoint Structure (2025)

### Known Patterns:

Based on research, Replit Agent likely uses these endpoint patterns:

1. **Chat/Completion Endpoints**:
   - `/api/agent`
   - `/api/chat/completions`
   - `/api/assistant/chat`

2. **WebSocket Connections**:
   - `wss://replit.com/agent/stream`
   - `wss://agent.replit.com/ws`

3. **Authentication**:
   - Headers: `Authorization: Bearer <token>`
   - Cookies: `connect.sid`, `replit.authed`

4. **Request Format**:
\`\`\`json
{
  "messages": [...],
  "model": "gpt-5" | "claude-sonnet-4.5",
  "stream": true,
  "tools": [...]
}
\`\`\`

### ⚠️ Important Notes:
- Exact endpoints are **not publicly documented**
- May vary by Replit deployment
- Use browser DevTools Network tab to inspect actual requests

---

## 🛠️ Alternative: Fetch/WebSocket Monkey Patching

If Service Workers don't work, you can override native browser APIs:

### Patch fetch()

\`\`\`javascript
// Run in browser console
(function() {
  const originalFetch = window.fetch;
  
  window.fetch = function(...args) {
    const [url, options = {}] = args;
    
    // Check if this is an agent request
    if (url.includes('/api/agent') || url.includes('/api/chat')) {
      console.log('🎯 Intercepting fetch to:', url);
      
      // Redirect to YOUR backend
      const customUrl = 'http://localhost:3101/agent/llm';
      
      return originalFetch(customUrl, {
        ...options,
        headers: {
          ...options.headers,
          'X-Override-Source': 'FetchPatch',
          'X-Original-URL': url
        }
      });
    }
    
    // Normal requests pass through
    return originalFetch(...args);
  };
  
  console.log('✅ fetch() patched for agent override');
})();
\`\`\`

### Patch WebSocket

\`\`\`javascript
// Run in browser console
(function() {
  const OriginalWebSocket = window.WebSocket;
  
  window.WebSocket = function(url, protocols) {
    if (url.includes('agent') || url.includes('chat')) {
      console.log('🎯 Intercepting WebSocket to:', url);
      
      // Redirect to YOUR WebSocket endpoint
      const customUrl = 'ws://localhost:3101/ws/agent';
      return new OriginalWebSocket(customUrl, protocols);
    }
    
    return new OriginalWebSocket(url, protocols);
  };
  
  console.log('✅ WebSocket patched for agent override');
})();
\`\`\`

---

## 📦 Bookmarklet Solution (No Extension Needed!)

Create a browser bookmark with this code to inject the override:

\`\`\`javascript
javascript:(function(){const originalFetch=window.fetch;window.fetch=function(...args){const[url,options={}]=args;if(url.includes('/api/agent')||url.includes('/api/chat')){console.log('🎯 Agent override:',url);return originalFetch('http://localhost:3101/agent/llm',{...options,headers:{...options.headers,'X-Override':'true'}})}return originalFetch(...args)};console.log('✅ Agent override active')})();
\`\`\`

**Usage**:
1. Create new bookmark
2. Paste code above as URL
3. Click bookmark when on Replit IDE
4. Agent requests now route to `localhost:3101`!

---

## 🎯 Recommended Approach for Vecto Pilot™

### Option 1: Bookmarklet (EASIEST)
- ✅ No extensions needed
- ✅ One-click activation
- ✅ Works immediately
- ⚠️ Must click on each page load

### Option 2: Service Worker (BEST)
- ✅ Persistent after registration
- ✅ Works across page reloads
- ✅ Full request/response control
- ⚠️ Requires HTTPS or localhost

### Option 3: Browser Extension (MOST ROBUST)
- ✅ Always active
- ✅ Full API access
- ✅ Cross-site permissions
- ❌ Requires installation (Tampermonkey alternative)

---

## 🔗 Integration with Vecto Pilot™ Atlas (Agent Override)

Your existing **Agent Server** (port 43717) already provides:
- `/agent/llm` endpoint for AI requests
- Claude → GPT-5 → Gemini fallback chain
- Full workspace intelligence

To integrate with Replit Agent Override:

1. Update your agent server to accept override requests
2. Add CORS headers for cross-origin requests
3. Implement request validation and auth
4. Log all intercepted requests for debugging

---

## 📝 Next Steps

1. ✅ **Test bookmarklet** in Replit IDE
2. ✅ **Monitor network requests** via DevTools
3. ✅ **Identify exact agent endpoints** Replit uses
4. ✅ **Deploy Service Worker** for persistent override
5. ✅ **Integrate with Eidolon** backend

---

**Generated by**: Perplexity AI Research + Vecto Pilot™  
**Last Updated**: October 16, 2025
