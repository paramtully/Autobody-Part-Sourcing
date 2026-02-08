-- Add processing_started_at column to raw_payloads table
ALTER TABLE raw_payloads
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP WITH TIME ZONE;

-- Add index for efficient querying of stuck processing
CREATE INDEX IF NOT EXISTS raw_payloads_processing_started_at_idx 
  ON raw_payloads (processing_started_at)
  WHERE status = 'PROCESSING';
