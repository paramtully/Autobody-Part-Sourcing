-- VENDOR_ORDER_PLACING: transient worker claim before vendor API call.
-- claimed_at: lease timestamp for automatic recovery after worker crash.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'VENDOR_ORDER_PLACING';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
