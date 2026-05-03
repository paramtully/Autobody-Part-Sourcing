-- ─────────────────────────────────────────────────────────────────
-- 0001_ordering_mvp_trim
-- Applies the MVP schema minimization described in the plan.
-- Safe to run on an empty DB (IF EXISTS / IF NOT EXISTS guards).
-- ─────────────────────────────────────────────────────────────────

-- Sequence used by OrderRepo to generate human-readable order numbers.
CREATE SEQUENCE IF NOT EXISTS order_number_seq;

-- Add REFUNDED to payment_status enum (postgres only allows additive changes).
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'REFUNDED';

-- ── Drop tables no longer needed for MVP ─────────────────────────
-- vendor_email_logs references orders, drop first.
DROP TABLE IF EXISTS vendor_email_logs;
-- order_status_history references orders.
DROP TABLE IF EXISTS order_status_history;
-- payments references orders.
DROP TABLE IF EXISTS payments;
-- fee_configurations has no FK dependencies.
DROP TABLE IF EXISTS fee_configurations;

-- ── Slim orders ──────────────────────────────────────────────────
-- Drop denormalized / derivable columns.
ALTER TABLE orders
    DROP COLUMN IF EXISTS user_id,
    DROP COLUMN IF EXISTS quote_id,
    DROP COLUMN IF EXISTS snapshot_part_name,
    DROP COLUMN IF EXISTS snapshot_part_number,
    DROP COLUMN IF EXISTS snapshot_condition,
    DROP COLUMN IF EXISTS snapshot_vendor_name,
    DROP COLUMN IF EXISTS snapshot_listing_price_minor,
    DROP COLUMN IF EXISTS snapshot_currency,
    DROP COLUMN IF EXISTS vendor_ordering_mode,
    DROP COLUMN IF EXISTS vendor_order_placed_at,
    DROP COLUMN IF EXISTS vendor_order_confirmed_at,
    DROP COLUMN IF EXISTS fee_percent_applied;

-- Add Stripe payment columns (replaces entire payments table).
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS payment_provider_payment_id varchar(255),
    ADD COLUMN IF NOT EXISTS payment_status payment_status;

-- Drop the now-redundant non-unique listing index (replaced by partial unique index below).
DROP INDEX IF EXISTS orders_listing_id_idx;
-- Drop user_id index (column gone).
DROP INDEX IF EXISTS orders_user_id_idx;

-- Partial unique index: prevents double-ordering a single-quantity listing.
-- Only one active order per listing at a time. Terminal statuses free the slot.
CREATE UNIQUE INDEX IF NOT EXISTS orders_active_listing_uniq
    ON orders (listing_id)
    WHERE status IN (
        'DRAFT',
        'PENDING_PAYMENT',
        'PAYMENT_AUTHORIZED',
        'VENDOR_ORDER_PENDING',
        'VENDOR_CONFIRMED'
    );

-- ── Slim checkout_quotes ─────────────────────────────────────────
-- vendor_id has a FK constraint; CASCADE also drops the constraint.
ALTER TABLE checkout_quotes
    DROP COLUMN IF EXISTS vendor_id CASCADE,
    DROP COLUMN IF EXISTS used_at,
    DROP COLUMN IF EXISTS fee_percent_applied;

-- ── Slim outbox_events ───────────────────────────────────────────
-- aggregate_type is always 'order' for MVP; topic already encodes this.
-- failed_at replaced by retryCount >= MAX_RETRIES semantics in the publisher.
ALTER TABLE outbox_events
    DROP COLUMN IF EXISTS aggregate_type,
    DROP COLUMN IF EXISTS failed_at;
