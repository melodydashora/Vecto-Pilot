
// ==UserScript==
// @name         Replit Assistant → Gateway Override
// @match        https://replit.com/*
// @run-at       document-start
// ==/UserScript==
(() => {
  const GATEWAY = `https://${window.location.hostname}/assistant/`; // Auto-detect current domain
  const RX = /\/(api|__|ai)\/assistant\//i;

  const install = () => {
    const ORIG = window.fetch;
    window.fetch = async function(input, init) {
      try {
        const url = String(input);
        if (RX.test(url)) {
          const u = new URL(url, location.origin);
          const tail = u.pathname.split('/assistant/').pop() || '';
          const target = GATEWAY.replace(/\/$/,'/') + tail + u.search;
          console.log('[assistant-override] redirecting:', url, '→', target);
          return ORIG(target, init);
        }
      } catch (e) {
        console.warn('[assistant-override] error:', e);
      }
      return ORIG(input, init);
    };
    console.log('[assistant-override] routing /assistant/* →', GATEWAY);
  };

  // Run as early as possible
  if (document.readyState === 'loading') {
    addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
