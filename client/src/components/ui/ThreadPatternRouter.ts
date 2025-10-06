export interface SignalThread {
  id: string;
  signals: string[];
  messages: string[];
  timestamp: number;
}

export function groupSignalThreads(signals: string[] = []): SignalThread[] {
  if (!signals || signals.length === 0) {
    return [];
  }

  const threads: SignalThread[] = [];
  let currentThread: SignalThread | null = null;

  signals.forEach((signal, index) => {
    if (!currentThread || shouldStartNewThread(signal, currentThread)) {
      if (currentThread) {
        threads.push(currentThread);
      }

      currentThread = {
        id: `thread-${index}`,
        signals: [signal],
        messages: [signal],
        timestamp: Date.now()
      };
    } else {
      currentThread.signals.push(signal);
      currentThread.messages.push(signal);
    }
  });

  if (currentThread) {
    threads.push(currentThread);
  }

  return threads;
}

function shouldStartNewThread(signal: string, currentThread: SignalThread): boolean {
  // Start new thread if gap is large or signal type changes
  return currentThread.signals.length > 5 || 
         signal.includes('ERROR') ||
         signal.includes('NEW_SESSION');
}