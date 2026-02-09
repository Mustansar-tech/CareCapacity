const isProduction = import.meta.env.PROD;

class ClientLogger {
  debug(...args: any[]) {
    if (!isProduction) {
      console.debug(...args);
    }
  }

  info(...args: any[]) {
    if (!isProduction) {
      console.log(...args);
    }
  }

  log(...args: any[]) {
    if (!isProduction) {
      console.log(...args);
    }
  }

  warn(...args: any[]) {
    if (!isProduction) {
      console.warn(...args);
    }
  }

  error(...args: any[]) {
    if (!isProduction) {
      console.error(...args);
    }
  }
}

export const clientLogger = new ClientLogger();
