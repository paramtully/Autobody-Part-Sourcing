/**
 * Circuit breaker interface for preventing retry storms when vendors are down.
 * 
 * Circuit breakers prevent repeated attempts to failing services by "opening"
 * the circuit after a threshold of failures, stopping all requests until the
 * service recovers.
 * 
 * States:
 * - CLOSED: Normal operation, requests allowed
 * - OPEN: Too many failures, requests blocked
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker interface for integration with retry utility.
 * 
 * Implementations should track failure rates and automatically transition
 * between states based on configured thresholds.
 */
export interface CircuitBreaker {
  /**
   * Check if circuit is open (should not attempt operation).
   * Returns true if circuit is in 'open' state.
   * 
   * @returns true if circuit is open and requests should be blocked
   */
  isOpen(): boolean;

  /**
   * Record a successful operation.
   * Should transition circuit to CLOSED state if currently HALF_OPEN.
   */
  recordSuccess(): void;

  /**
   * Record a failed operation.
   * Should transition circuit to OPEN state if failure threshold exceeded.
   */
  recordFailure(): void;

  /**
   * Get current circuit breaker state.
   * 
   * @returns Current state: 'closed' | 'open' | 'half-open'
   */
  getState(): CircuitBreakerState;
}
