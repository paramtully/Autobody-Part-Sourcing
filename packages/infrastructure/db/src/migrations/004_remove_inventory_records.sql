-- Drop inventory_records table (now computed at repository layer)
DROP TABLE IF EXISTS inventory_records;

-- Add aggregation indexes for efficient inventory queries
CREATE INDEX IF NOT EXISTS listings_vendor_part_active_idx 
  ON listings (vendor_id, part_id, is_active);

CREATE INDEX IF NOT EXISTS listings_vendor_part_condition_idx 
  ON listings (vendor_id, part_id, condition);
