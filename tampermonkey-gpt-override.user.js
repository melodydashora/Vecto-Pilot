// ==UserScript==
// @name         Vecto Pilot - GPT Override
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Routes Eidolon assistant through GPT-5 instead of Claude
// @author       You
// @match        https://*.melodydashora.repl.co/*
// @match        https://vectopilot.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    console.log('🔧 GPT Override: Tampermonkey script loaded');

    // Intercept fetch requests to reroute assistant calls
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const [url, options] = args;
        
        // If this is an assistant chat request, add override header
        if (typeof url === 'string' && url.includes('/api/assistant/chat')) {
            console.log('🔀 GPT Override: Intercepting assistant chat request');
            
            const newOptions = options || {};
            newOptions.headers = newOptions.headers || {};
            
            // Add override header to route through GPT
            newOptions.headers['X-Assistant-Override'] = 'gpt-5';
            
            console.log('✅ GPT Override: Request modified to use GPT-5');
            return originalFetch(url, newOptions);
        }
        
        // Pass through all other requests
        return originalFetch(...args);
    };

    // Add visual indicator that override is active
    window.addEventListener('load', function() {
        const indicator = document.createElement('div');
        indicator.id = 'gpt-override-indicator';
        indicator.innerHTML = '🤖 GPT-5 Override Active';
        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 12px;
            font-weight: 600;
            z-index: 999999;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
            cursor: pointer;
            transition: all 0.3s ease;
        `;
        
        indicator.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.05)';
            this.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.6)';
        });
        
        indicator.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
        });
        
        indicator.addEventListener('click', function() {
            if (confirm('Disable GPT Override? (Reload page to re-enable)')) {
                window.fetch = originalFetch;
                this.remove();
                console.log('🔴 GPT Override: Disabled');
            }
        });
        
        document.body.appendChild(indicator);
        console.log('✅ GPT Override: Visual indicator added');
    });

    console.log('✅ GPT Override: Script initialized successfully');
})();
