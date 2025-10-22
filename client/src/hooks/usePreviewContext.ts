import { useEffect } from "react";

export function usePreviewContext() {
  useEffect(() => {
    const handleInteraction = (event: Event) => {
      const payload = {
        type: event.type,
        timestamp: Date.now(),
        target: (event.target as HTMLElement)?.tagName || 'unknown',
        url: window.location.pathname,
      };
      
      // Send interaction metadata to backend
      fetch("/api/preview/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(err => {
        // Silently handle errors to avoid disrupting user experience
        console.debug('Preview context event failed:', err);
      });
    };

    // Track click interactions for live preview responsiveness
    document.addEventListener("click", handleInteraction);
    
    // Track mouse movement for dwell time analysis
    let mouseMoveTimeout: NodeJS.Timeout;
    const handleMouseMove = (event: MouseEvent) => {
      clearTimeout(mouseMoveTimeout);
      mouseMoveTimeout = setTimeout(() => {
        const payload = {
          type: 'mousedwell',
          timestamp: Date.now(),
          target: (event.target as HTMLElement)?.tagName || 'unknown',
          url: window.location.pathname,
          x: event.clientX,
          y: event.clientY
        };
        
        fetch("/api/preview/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(err => {
          console.debug('Preview context event failed:', err);
        });
      }, 500); // 500ms dwell time threshold
    };

    document.addEventListener("mousemove", handleMouseMove);

    return () => {
      document.removeEventListener("click", handleInteraction);
      document.removeEventListener("mousemove", handleMouseMove);
      clearTimeout(mouseMoveTimeout);
    };
  }, []);
}