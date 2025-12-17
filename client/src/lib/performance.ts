
export class PerformanceMonitor {
  private static marks: Map<string, number> = new Map();

  static mark(label: string) {
    this.marks.set(label, performance.now());
  }

  static measure(label: string, startMark: string) {
    const start = this.marks.get(startMark);
    if (!start) {
      console.warn(`Performance mark "${startMark}" not found`);
      return;
    }

    const duration = performance.now() - start;
    
    if (import.meta.env.PROD) {
      // Send to analytics service
      this.sendMetric(label, duration);
    } else {
      console.log(`⏱️ ${label}: ${duration.toFixed(2)}ms`);
    }

    this.marks.delete(startMark);
    return duration;
  }

  private static sendMetric(label: string, duration: number) {
    // TODO: Send to monitoring service (Google Analytics, Mixpanel, etc.)
    if (duration > 1000) {
      console.warn(`Slow operation detected: ${label} took ${duration.toFixed(2)}ms`);
    }
  }

  static trackPageLoad() {
    if (typeof window !== 'undefined' && window.performance) {
      window.addEventListener('load', () => {
        setTimeout(() => {
          const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
          
          const metrics = {
            dns: perfData.domainLookupEnd - perfData.domainLookupStart,
            tcp: perfData.connectEnd - perfData.connectStart,
            request: perfData.responseStart - perfData.requestStart,
            response: perfData.responseEnd - perfData.responseStart,
            domParsing: perfData.domContentLoadedEventEnd - perfData.responseEnd,
            domReady: perfData.domContentLoadedEventEnd - perfData.fetchStart,
            pageLoad: perfData.loadEventEnd - perfData.fetchStart
          };

          console.log('📊 Page Load Metrics:', metrics);

          if (import.meta.env.PROD) {
            // Send to analytics
          }
        }, 0);
      });
    }
  }
}

// Auto-track page load
PerformanceMonitor.trackPageLoad();
