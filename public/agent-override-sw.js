// Replit Agent Override Service Worker
// Intercepts Replit IDE agent requests and redirects to custom backend

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
  const agentEndpoints = [
    '/api/agent',
    '/api/chat',
    '/api/completion',
    '/api/assistant',
    '/agent/llm',
    '/api/ai',
    '/rpc/chat',
    '/rpc/agent'
  ];
  
  const isAgentRequest = agentEndpoints.some(endpoint => 
    url.pathname.includes(endpoint)
  );
  
  if (isAgentRequest) {
    console.log('🎯 Intercepting agent request:', url.pathname, url.search);
    
    event.respondWith(
      (async () => {
        try {
          const originalRequest = event.request.clone();
          let requestBody = null;
          
          if (originalRequest.method !== 'GET') {
            requestBody = await originalRequest.text();
          }
          
          // Get custom backend URL from environment or use default
          const customBackendUrl = self.location.origin + '/agent/llm';
          
          console.log('↪️  Redirecting to:', customBackendUrl);
          
          const customRequest = new Request(customBackendUrl, {
            method: originalRequest.method,
            headers: {
              'Content-Type': 'application/json',
              'X-Override-Source': 'ServiceWorker',
              'X-Original-URL': url.href,
              'X-Original-Path': url.pathname,
              'Authorization': originalRequest.headers.get('Authorization') || ''
            },
            body: requestBody,
            mode: 'cors',
            credentials: 'include'
          });
          
          const response = await fetch(customRequest);
          
          console.log('✅ Custom backend response:', response.status);
          
          return response;
        } catch (error) {
          console.error('❌ Service Worker error:', error);
          
          return new Response(JSON.stringify({
            error: 'Agent Override Failed',
            message: error.message,
            stack: error.stack
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })()
    );
    
    return;
  }
  
  // For all other requests, proceed normally
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
