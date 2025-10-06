import { useEffect, useRef } from "react";

interface GestureData {
  type: string;
  timestamp: number;
  context?: any;
}

export function useGestureTracker(blockId: string, sessionId?: string) {
  const gestureDataRef = useRef<GestureData[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const viewStartRef = useRef<number>(Date.now());
  const hoverStartRef = useRef<number | null>(null);

  // Send gesture batch to backend
  const sendGestureBatch = () => {
    if (gestureDataRef.current.length === 0) return;

    const payload = {
      blockId,
      sessionId: sessionId || `session-${Date.now()}`,
      gestures: gestureDataRef.current,
    };

    // Use sendBeacon for reliability
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    navigator.sendBeacon("/api/gesture/store", blob);
    
    // Clear the batch
    gestureDataRef.current = [];
  };

  useEffect(() => {
    // Track initial view
    gestureDataRef.current.push({
      type: "view",
      timestamp: Date.now(),
      context: { viewDuration: 0 }
    });

    const handleClick = (e: MouseEvent) => {
      // Check if click is within our tracked element
      const element = document.querySelector(`[data-block-id="${blockId}"]`);
      if (element && element.contains(e.target as Node)) {
        gestureDataRef.current.push({
          type: "click",
          timestamp: Date.now(),
          context: { x: e.clientX, y: e.clientY }
        });
        
        // Send immediately on click for high-value interactions
        sendGestureBatch();
      }
    };

    const handleScroll = () => {
      // Throttle scroll events
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        const element = document.querySelector(`[data-block-id="${blockId}"]`);
        if (element) {
          const rect = element.getBoundingClientRect();
          const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
          
          if (isVisible) {
            gestureDataRef.current.push({
              type: "scroll",
              timestamp: Date.now(),
              context: { 
                scrollDepth: window.scrollY,
                elementVisible: true,
                viewportPosition: rect.top / window.innerHeight
              }
            });
          }
        }
      }, 200);
    };

    const handleMouseEnter = (e: MouseEvent) => {
      const element = document.querySelector(`[data-block-id="${blockId}"]`);
      if (element && element.contains(e.target as Node)) {
        hoverStartRef.current = Date.now();
        gestureDataRef.current.push({
          type: "hover_start",
          timestamp: Date.now()
        });
      }
    };

    const handleMouseLeave = (e: MouseEvent) => {
      const element = document.querySelector(`[data-block-id="${blockId}"]`);
      if (element && element.contains(e.target as Node) && hoverStartRef.current) {
        const hoverDuration = Date.now() - hoverStartRef.current;
        gestureDataRef.current.push({
          type: "hover_end",
          timestamp: Date.now(),
          context: { duration: hoverDuration }
        });
        hoverStartRef.current = null;
        
        // High hover duration indicates interest
        if (hoverDuration > 3000) {
          sendGestureBatch();
        }
      }
    };

    // Add event listeners
    window.addEventListener("click", handleClick);
    window.addEventListener("scroll", handleScroll);
    document.addEventListener("mouseenter", handleMouseEnter, true);
    document.addEventListener("mouseleave", handleMouseLeave, true);

    // Cleanup and send remaining data on unmount
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("mouseenter", handleMouseEnter, true);
      document.removeEventListener("mouseleave", handleMouseLeave, true);

      // Track view duration
      const viewDuration = Date.now() - viewStartRef.current;
      gestureDataRef.current.push({
        type: "view_end",
        timestamp: Date.now(),
        context: { totalViewDuration: viewDuration }
      });

      // Send remaining gestures
      sendGestureBatch();
      
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [blockId, sessionId]);
}

// Hook for analyzing gesture patterns
export function useGestureInsights() {
  const getOptimizedBlockOrder = async (): Promise<string[]> => {
    try {
      const response = await fetch("/api/gesture/insights");
      if (!response.ok) return [];
      const data = await response.json();
      return data.blockOrder || [];
    } catch (error) {
      console.error("Failed to fetch gesture insights:", error);
      return [];
    }
  };

  return { getOptimizedBlockOrder };
}