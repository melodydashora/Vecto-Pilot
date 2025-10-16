// Replit Agent Override Injection Script
// Patches fetch() and WebSocket to redirect agent requests to custom backend

(function() {
  console.log('🚀 Initializing Replit Agent Override...');
  
  // Configuration
  const CUSTOM_BACKEND_URL = window.location.origin + '/agent/llm';
  const CUSTOM_WS_URL = window.location.origin.replace('http', 'ws') + '/ws/agent';
  
  // Agent endpoint patterns to intercept
  const AGENT_PATTERNS = [
    '/api/agent',
    '/api/chat',
    '/api/completion',
    '/api/assistant',
    '/agent/llm',
    '/api/ai',
    '/rpc/chat',
    '/rpc/agent'
  ];
  
  // Check if URL matches agent patterns
  function isAgentRequest(url) {
    return AGENT_PATTERNS.some(pattern => url.includes(pattern));
  }
  
  // ========================================
  // PATCH: fetch()
  // ========================================
  
  const originalFetch = window.fetch;
  
  window.fetch = function(...args) {
    const [url, options = {}] = args;
    const urlString = typeof url === 'string' ? url : url.href || '';
    
    if (isAgentRequest(urlString)) {
      console.log('🎯 [OVERRIDE] Intercepting fetch:', urlString);
      
      // Redirect to custom backend
      return originalFetch(CUSTOM_BACKEND_URL, {
        ...options,
        headers: {
          ...options.headers,
          'Content-Type': 'application/json',
          'X-Override-Source': 'FetchPatch',
          'X-Original-URL': urlString
        },
        mode: 'cors',
        credentials: 'include'
      }).then(response => {
        console.log('✅ [OVERRIDE] Custom backend response:', response.status);
        return response;
      }).catch(error => {
        console.error('❌ [OVERRIDE] Fetch error:', error);
        throw error;
      });
    }
    
    // Normal requests pass through
    return originalFetch(...args);
  };
  
  console.log('✅ fetch() patched successfully');
  
  // ========================================
  // PATCH: WebSocket
  // ========================================
  
  const OriginalWebSocket = window.WebSocket;
  
  window.WebSocket = function(url, protocols) {
    const urlString = typeof url === 'string' ? url : url.href || '';
    
    if (isAgentRequest(urlString)) {
      console.log('🎯 [OVERRIDE] Intercepting WebSocket:', urlString);
      console.log('↪️  Redirecting to:', CUSTOM_WS_URL);
      
      // Redirect to custom WebSocket endpoint
      return new OriginalWebSocket(CUSTOM_WS_URL, protocols);
    }
    
    // Normal WebSocket connections pass through
    return new OriginalWebSocket(url, protocols);
  };
  
  console.log('✅ WebSocket patched successfully');
  
  // ========================================
  // PATCH: XMLHttpRequest
  // ========================================
  
  const OriginalXHR = window.XMLHttpRequest;
  
  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open;
    
    xhr.open = function(method, url, ...rest) {
      const urlString = typeof url === 'string' ? url : url.href || '';
      
      if (isAgentRequest(urlString)) {
        console.log('🎯 [OVERRIDE] Intercepting XHR:', urlString);
        
        // Redirect to custom backend
        return originalOpen.call(this, method, CUSTOM_BACKEND_URL, ...rest);
      }
      
      return originalOpen.call(this, method, url, ...rest);
    };
    
    return xhr;
  };
  
  console.log('✅ XMLHttpRequest patched successfully');
  
  // ========================================
  // GLOBAL STATUS
  // ========================================
  
  window.__AGENT_OVERRIDE_ACTIVE__ = true;
  window.__AGENT_OVERRIDE_BACKEND__ = CUSTOM_BACKEND_URL;
  
  console.log('🎉 Replit Agent Override ACTIVE!');
  console.log('   Backend URL:', CUSTOM_BACKEND_URL);
  console.log('   WebSocket URL:', CUSTOM_WS_URL);
  console.log('   Intercepting patterns:', AGENT_PATTERNS);
  
  // Add visual indicator
  const indicator = document.createElement('div');
  indicator.id = 'agent-override-indicator';
  indicator.innerHTML = '🤖 Agent Override Active';
  indicator.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 8px 16px;
    border-radius: 20px;
    font-family: monospace;
    font-size: 12px;
    font-weight: bold;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    cursor: pointer;
    transition: all 0.3s ease;
  `;
  
  indicator.addEventListener('click', () => {
    console.log('🔍 Agent Override Status:');
    console.log('   Active:', window.__AGENT_OVERRIDE_ACTIVE__);
    console.log('   Backend:', window.__AGENT_OVERRIDE_BACKEND__);
    console.log('   Patterns:', AGENT_PATTERNS);
  });
  
  indicator.addEventListener('mouseenter', () => {
    indicator.style.transform = 'scale(1.05)';
  });
  
  indicator.addEventListener('mouseleave', () => {
    indicator.style.transform = 'scale(1)';
  });
  
  document.body.appendChild(indicator);
  
})();
