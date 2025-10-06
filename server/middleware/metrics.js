class SimpleMetrics {
  constructor() {
    this.counters = new Map();
  }

  counter(name, labels) {
    return {
      inc: (value = 1) => {
        const key = this.makeKey(name, labels);
        this.counters.set(key, (this.counters.get(key) || 0) + value);
      }
    };
  }

  makeKey(name, labels) {
    if (!labels) return name;
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  getAll() {
    return Object.fromEntries(this.counters);
  }

  reset() {
    this.counters.clear();
  }
}

export const metrics = new SimpleMetrics();
