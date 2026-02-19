/**
 * Validation result types for the DataCleaner (System 5A).
 *
 * Each DTO validation produces either a success or failure result.
 * Failures include structured error information for dead-letter routing
 * and operational monitoring.
 */

/**
 * A single validation error with field-level detail.
 */
export interface ValidationError {
  /** The field that failed validation (dot-notation for nested fields). */
  readonly field: string;

  /** Machine-readable error code. */
  readonly code: ValidationErrorCode;

  /** Human-readable error message. */
  readonly message: string;

  /** The invalid value (for debugging, not for production logging of sensitive data). */
  readonly receivedValue?: unknown;
}

/**
 * Validation error codes.
 */
export type ValidationErrorCode =
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_FORMAT'
  | 'OUT_OF_RANGE'
  | 'NEGATIVE_PRICE'
  | 'ZERO_PRICE'
  | 'UNKNOWN_CONDITION'
  | 'UNKNOWN_AVAILABILITY'
  | 'MISSING_IDENTITY'
  | 'MISSING_PART_NUMBER'
  | 'INVALID_YEAR_RANGE'
  | 'INVALID_CURRENCY'
  | 'INVALID_URL'
  | 'BUSINESS_RULE_VIOLATION';

/**
 * Validation severity levels.
 *
 * - ERROR: Record cannot be processed. Goes to dead-letter queue.
 * - WARNING: Record can be processed but has data quality issues.
 *   Processed normally but flagged for review.
 */
export type ValidationSeverity = 'ERROR' | 'WARNING';

/**
 * Result of validating a single DTO.
 * Discriminated union: check `valid` to determine which branch.
 */
export type ValidationResult<T> =
  | ValidationSuccess<T>
  | ValidationFailure;

/**
 * Successful validation result.
 * Contains the cleaned DTO and any warnings.
 */
export interface ValidationSuccess<T> {
  readonly valid: true;
  readonly data: T;
  /** Non-fatal issues that were auto-corrected or should be monitored. */
  readonly warnings: ValidationError[];
}

/**
 * Failed validation result.
 * Contains error details for dead-letter routing.
 */
export interface ValidationFailure {
  readonly valid: false;
  /** Fatal errors that prevent processing. */
  readonly errors: ValidationError[];
  /** Non-fatal issues discovered alongside errors. */
  readonly warnings: ValidationError[];
  /** The vendor ID of the record that failed. */
  readonly vendorId: string;
  /** The external listing ID (if available) for correlation. */
  readonly vendorListingExternalId?: string;
}
