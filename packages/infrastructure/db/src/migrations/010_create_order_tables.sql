-- 010_create_order_tables.sql
-- Creates all tables for the Order + Checkout system.

-- ────────────────────────────────────────────────────────────────
-- Enums
-- ────────────────────────────────────────────────────────────────

CREATE TYPE vendor_ordering_mode AS ENUM (
    'API_SYNC', 'API_ASYNC', 'EDI', 'EMAIL_MANUAL', 'NOT_SUPPORTED'
);

CREATE TYPE order_status AS ENUM (
    'DRAFT', 'PENDING_PAYMENT', 'PAYMENT_AUTHORIZED',
    'VENDOR_ORDER_PENDING', 'VENDOR_CONFIRMED', 'COMPLETED',
    'CANCELLED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'
);

CREATE TYPE payment_status AS ENUM (
    'PENDING', 'AUTHORIZED', 'CAPTURED', 'CANCELLED', 'FAILED'
);

CREATE TYPE payment_provider AS ENUM ('STRIPE');

CREATE TYPE refund_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- ────────────────────────────────────────────────────────────────
-- Vendor ordering columns
-- ────────────────────────────────────────────────────────────────

ALTER TABLE vendors
    ADD COLUMN ordering_mode vendor_ordering_mode NOT NULL DEFAULT 'NOT_SUPPORTED',
    ADD COLUMN supports_cancellation boolean NOT NULL DEFAULT false,
    ADD COLUMN supports_status_lookup boolean NOT NULL DEFAULT false,
    ADD COLUMN order_contact_email varchar(255);

-- ────────────────────────────────────────────────────────────────
-- Sequence for order numbers
-- ────────────────────────────────────────────────────────────────

CREATE SEQUENCE order_number_seq START 1;

-- ────────────────────────────────────────────────────────────────
-- fee_configurations
-- ────────────────────────────────────────────────────────────────

CREATE TABLE fee_configurations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fee_percent numeric(5,4) NOT NULL,
    description text,
    effective_from timestamptz NOT NULL DEFAULT NOW(),
    effective_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Only one active fee config at a time (effective_until IS NULL)
CREATE UNIQUE INDEX fee_configurations_active_unique
    ON fee_configurations (fee_percent)
    WHERE effective_until IS NULL;

-- Seed the initial 3% fee
INSERT INTO fee_configurations (fee_percent, description, effective_from)
VALUES (0.0300, 'Standard platform service fee', NOW());

-- ────────────────────────────────────────────────────────────────
-- checkout_quotes
-- ────────────────────────────────────────────────────────────────

CREATE TABLE checkout_quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
    vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    shipping_address jsonb NOT NULL,
    part_price_minor integer NOT NULL,
    service_fee_minor integer NOT NULL,
    fee_percent_applied numeric(5,4) NOT NULL,
    shipping_minor integer NOT NULL,
    tax_minor integer NOT NULL,
    total_minor integer NOT NULL,
    currency currency NOT NULL,
    vendor_quote_reference varchar(255),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────
-- orders
-- ────────────────────────────────────────────────────────────────

CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number varchar(32) UNIQUE NOT NULL,
    status order_status NOT NULL,

    user_id uuid,
    contact_email varchar(255) NOT NULL,
    contact_phone varchar(50),
    order_lookup_token varchar(64) UNIQUE NOT NULL,
    idempotency_key varchar(128) UNIQUE NOT NULL,

    quote_id uuid REFERENCES checkout_quotes(id) ON DELETE RESTRICT,
    listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
    vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,

    shipping_address jsonb NOT NULL,

    snapshot_part_name varchar(255),
    snapshot_part_number varchar(255),
    snapshot_condition part_condition,
    snapshot_vendor_name varchar(255),
    snapshot_listing_price_minor integer,
    snapshot_currency currency,

    part_price_minor integer NOT NULL,
    service_fee_minor integer NOT NULL,
    fee_percent_applied numeric(5,4) NOT NULL,
    shipping_minor integer NOT NULL,
    tax_minor integer NOT NULL,
    total_minor integer NOT NULL,
    currency currency NOT NULL,

    total_refunded_minor integer NOT NULL DEFAULT 0,

    vendor_order_id varchar(255),
    vendor_ordering_mode vendor_ordering_mode NOT NULL,
    vendor_order_placed_at timestamptz,
    vendor_order_confirmed_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),

    CONSTRAINT total_minor_min_check CHECK (total_minor >= 100),
    CONSTRAINT total_refunded_non_negative_check CHECK (total_refunded_minor >= 0),
    CONSTRAINT total_refunded_max_check CHECK (total_refunded_minor <= total_minor)
);

CREATE INDEX orders_status_idx ON orders(status);
CREATE INDEX orders_user_id_idx ON orders(user_id);
CREATE INDEX orders_listing_id_idx ON orders(listing_id);
CREATE INDEX orders_vendor_id_idx ON orders(vendor_id);

-- ────────────────────────────────────────────────────────────────
-- listing_holds
-- ────────────────────────────────────────────────────────────────

CREATE TABLE listing_holds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    released_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Only one active (unreleased) hold per listing
CREATE UNIQUE INDEX listing_holds_active_unique
    ON listing_holds(listing_id)
    WHERE released_at IS NULL;

-- ────────────────────────────────────────────────────────────────
-- order_status_history
-- ────────────────────────────────────────────────────────────────

CREATE TABLE order_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    from_status order_status,
    to_status order_status NOT NULL,
    reason text,
    actor varchar(100) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX order_status_history_order_id_idx ON order_status_history(order_id);

-- ────────────────────────────────────────────────────────────────
-- payments
-- ────────────────────────────────────────────────────────────────

CREATE TABLE payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid UNIQUE NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    provider payment_provider NOT NULL,
    provider_payment_id varchar(255) UNIQUE NOT NULL,
    provider_idempotency_key varchar(128) UNIQUE NOT NULL,
    status payment_status NOT NULL,
    amount_minor integer NOT NULL,
    currency currency NOT NULL,
    authorized_at timestamptz,
    auth_expires_at timestamptz,
    captured_at timestamptz,
    cancelled_at timestamptz,
    failure_reason text,
    provider_metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────
-- refunds
-- ────────────────────────────────────────────────────────────────

CREATE TABLE refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    provider payment_provider NOT NULL,
    provider_refund_id varchar(255) UNIQUE NOT NULL,
    amount_minor integer NOT NULL,
    service_fee_refund_minor integer NOT NULL,
    reason text,
    status refund_status NOT NULL,
    initiated_by varchar(100) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX refunds_order_id_idx ON refunds(order_id);

-- ────────────────────────────────────────────────────────────────
-- outbox_events
-- ────────────────────────────────────────────────────────────────

CREATE TABLE outbox_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    topic varchar(255) NOT NULL,
    aggregate_type varchar(100) NOT NULL,
    aggregate_id uuid NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    published_at timestamptz,
    failed_at timestamptz,
    retry_count integer NOT NULL DEFAULT 0
);

CREATE INDEX outbox_events_unpublished_idx
    ON outbox_events(published_at, created_at)
    WHERE published_at IS NULL;

-- ────────────────────────────────────────────────────────────────
-- vendor_email_logs
-- ────────────────────────────────────────────────────────────────

CREATE TABLE vendor_email_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
    from_address varchar(255) NOT NULL,
    to_address varchar(255) NOT NULL,
    subject text,
    raw_body text,
    parsed_status varchar(50),
    parsed_tracking varchar(255),
    processing_status varchar(50) NOT NULL DEFAULT 'PENDING',
    received_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX vendor_email_logs_order_id_idx ON vendor_email_logs(order_id);
CREATE INDEX vendor_email_logs_processing_status_idx ON vendor_email_logs(processing_status);

-- ────────────────────────────────────────────────────────────────
-- updated_at triggers for new tables
-- ────────────────────────────────────────────────────────────────

CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
