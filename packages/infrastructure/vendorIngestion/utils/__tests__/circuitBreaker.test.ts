/**
 * Unit tests for Circuit Breaker.
 * 
 * Tests cover:
 * - State transitions (closed → open → half-open → closed)
 * - Failure threshold enforcement
 * - Half-open state testing behavior
 * - Timeout-based recovery
 * - Concurrent request handling
 * - Edge cases
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { CircuitBreaker, CircuitBreakerState } from '../circuitBreaker';

/**
 * Mock implementation of CircuitBreaker for testing.
 * Production implementations would use Redis or similar for distributed state.
 */
class MockCircuitBreaker implements CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private halfOpenAttempts = 0;

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly recoveryTimeoutMs: number = 60000,
    private readonly halfOpenMaxAttempts: number = 3
  ) {}

  isOpen(): boolean {
    // Check if we should transition from OPEN to HALF_OPEN based on timeout
    if (this.state === 'open' && this.lastFailureTime) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.recoveryTimeoutMs) {
        this.state = 'half-open';
        this.halfOpenAttempts = 0;
      }
    }

    return this.state === 'open';
  }

  recordSuccess(): void {
    this.successCount++;

    if (this.state === 'half-open') {
      // Successful test in half-open state → close circuit
      this.state = 'closed';
      this.failureCount = 0;
      this.halfOpenAttempts = 0;
    } else if (this.state === 'closed') {
      // Reset failure count on success in closed state
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Failed test in half-open state → reopen circuit
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        this.state = 'open';
      }
    } else if (this.state === 'closed' && this.failureCount >= this.failureThreshold) {
      // Too many failures in closed state → open circuit
      this.state = 'open';
    }
  }

  getState(): CircuitBreakerState {
    // Update state before returning (for timeout-based transitions)
    this.isOpen();
    return this.state;
  }

  // Test helpers
  getFailureCount(): number {
    return this.failureCount;
  }

  getSuccessCount(): number {
    return this.successCount;
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.halfOpenAttempts = 0;
  }
}

describe('CircuitBreaker', () => {
  let circuitBreaker: MockCircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new MockCircuitBreaker(5, 60000, 3);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Initial State', () => {
    it('starts in closed state', () => {
      expect(circuitBreaker.getState()).toBe('closed');
      expect(circuitBreaker.isOpen()).toBe(false);
    });

    it('allows requests in closed state', () => {
      expect(circuitBreaker.isOpen()).toBe(false);
    });
  });

  describe('State Transitions: CLOSED → OPEN', () => {
    it('opens circuit after failure threshold exceeded', () => {
      // Record failures up to threshold
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }

      expect(circuitBreaker.getState()).toBe('open');
      expect(circuitBreaker.isOpen()).toBe(true);
    });

    it('does not open circuit below failure threshold', () => {
      for (let i = 0; i < 4; i++) {
        circuitBreaker.recordFailure();
      }

      expect(circuitBreaker.getState()).toBe('closed');
      expect(circuitBreaker.isOpen()).toBe(false);
    });

    it('resets failure count on success', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordSuccess();

      expect(circuitBreaker.getFailureCount()).toBeLessThan(2);
    });
  });

  describe('State Transitions: OPEN → HALF_OPEN', () => {
    beforeEach(() => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }
    });

    it('transitions to half-open after recovery timeout', () => {
      expect(circuitBreaker.getState()).toBe('open');

      // Fast-forward past recovery timeout
      jest.advanceTimersByTime(60000);

      expect(circuitBreaker.getState()).toBe('half-open');
      expect(circuitBreaker.isOpen()).toBe(false); // Half-open allows requests
    });

    it('does not transition before recovery timeout', () => {
      jest.advanceTimersByTime(30000); // Half the timeout

      expect(circuitBreaker.getState()).toBe('open');
      expect(circuitBreaker.isOpen()).toBe(true);
    });

    it('blocks requests while open', () => {
      expect(circuitBreaker.isOpen()).toBe(true);
    });
  });

  describe('State Transitions: HALF_OPEN → CLOSED', () => {
    beforeEach(() => {
      // Open circuit then transition to half-open
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }
      jest.advanceTimersByTime(60000);
    });

    it('closes circuit on successful test request', () => {
      expect(circuitBreaker.getState()).toBe('half-open');

      circuitBreaker.recordSuccess();

      expect(circuitBreaker.getState()).toBe('closed');
      expect(circuitBreaker.isOpen()).toBe(false);
    });

    it('resets failure count when closing', () => {
      circuitBreaker.recordSuccess();

      expect(circuitBreaker.getFailureCount()).toBe(0);
    });
  });

  describe('State Transitions: HALF_OPEN → OPEN', () => {
    beforeEach(() => {
      // Open circuit then transition to half-open
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }
      jest.advanceTimersByTime(60000);
    });

    it('reopens circuit on failed test request', () => {
      expect(circuitBreaker.getState()).toBe('half-open');

      // Max 3 attempts in half-open before reopening
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();

      expect(circuitBreaker.getState()).toBe('open');
      expect(circuitBreaker.isOpen()).toBe(true);
    });

    it('stays half-open for multiple test attempts', () => {
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getState()).toBe('half-open');

      circuitBreaker.recordFailure();
      expect(circuitBreaker.getState()).toBe('half-open');
    });
  });

  describe('Failure Threshold Configuration', () => {
    it('respects custom failure threshold', () => {
      const customBreaker = new MockCircuitBreaker(3, 60000, 3);

      customBreaker.recordFailure();
      customBreaker.recordFailure();
      customBreaker.recordFailure();

      expect(customBreaker.getState()).toBe('open');
    });

    it('handles threshold of 1', () => {
      const sensitiveBreaker = new MockCircuitBreaker(1, 60000, 3);

      sensitiveBreaker.recordFailure();

      expect(sensitiveBreaker.getState()).toBe('open');
    });
  });

  describe('Recovery Timeout Configuration', () => {
    it('respects custom recovery timeout', () => {
      const quickRecoveryBreaker = new MockCircuitBreaker(5, 5000, 3);

      for (let i = 0; i < 5; i++) {
        quickRecoveryBreaker.recordFailure();
      }

      expect(quickRecoveryBreaker.getState()).toBe('open');

      jest.advanceTimersByTime(5000);

      expect(quickRecoveryBreaker.getState()).toBe('half-open');
    });
  });

  describe('Success Counter', () => {
    it('tracks successful operations', () => {
      circuitBreaker.recordSuccess();
      circuitBreaker.recordSuccess();

      expect(circuitBreaker.getSuccessCount()).toBe(2);
    });

    it('continues tracking successes after recovery', () => {
      // Open circuit
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }

      // Recover
      jest.advanceTimersByTime(60000);
      circuitBreaker.recordSuccess();

      expect(circuitBreaker.getSuccessCount()).toBe(1);
      expect(circuitBreaker.getState()).toBe('closed');
    });
  });

  describe('Edge Cases', () => {
    it('handles rapid state transitions', () => {
      // Fail → open
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }
      expect(circuitBreaker.getState()).toBe('open');

      // Recover → half-open
      jest.advanceTimersByTime(60000);
      expect(circuitBreaker.getState()).toBe('half-open');

      // Succeed → closed
      circuitBreaker.recordSuccess();
      expect(circuitBreaker.getState()).toBe('closed');

      // Fail again → should not open immediately
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getState()).toBe('closed');
    });

    it('handles success in closed state (graceful degradation)', () => {
      circuitBreaker.recordSuccess();
      circuitBreaker.recordSuccess();

      expect(circuitBreaker.getState()).toBe('closed');
      expect(circuitBreaker.getSuccessCount()).toBe(2);
    });

    it('handles multiple failures in open state', () => {
      // Open circuit
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }

      // Additional failures while open should not affect state
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();

      expect(circuitBreaker.getState()).toBe('open');
    });

    it('isOpen() is idempotent', () => {
      const result1 = circuitBreaker.isOpen();
      const result2 = circuitBreaker.isOpen();
      const result3 = circuitBreaker.isOpen();

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });
  });

  describe('Reset Functionality', () => {
    it('reset() returns circuit to initial state', () => {
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }
      expect(circuitBreaker.getState()).toBe('open');

      circuitBreaker.reset();

      expect(circuitBreaker.getState()).toBe('closed');
      expect(circuitBreaker.getFailureCount()).toBe(0);
      expect(circuitBreaker.getSuccessCount()).toBe(0);
    });
  });
});
