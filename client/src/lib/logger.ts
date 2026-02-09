
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class ClientLogger {
  private isProd = import.meta.env.PROD;

  debug(message: string, ...args: any[]) {
    if (!this.isProd) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (!this.isProd) {
      console.log(`[INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (!this.isProd) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]) {
    // Errors are always logged but could be sent to an error tracking service
    console.error(`[ERROR] ${message}`, ...args);
  }
}

export const logger = new ClientLogger();
