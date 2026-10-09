export class RoutingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 503,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}
