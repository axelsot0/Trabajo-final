export type DomainErrorCode =
  | 'invalid_transition'
  | 'not_assigned'
  | 'already_assigned'
  | 'conversation_closed'
  | 'window_expired'
  | 'no_customer_message'
  | 'stale_version'
  | 'forbidden';

/** Error de regla de negocio. Su `code` es estable y apto para respuestas al agente. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
