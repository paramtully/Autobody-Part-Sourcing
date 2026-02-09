-- Change real to integer for weightGrams
ALTER TABLE parts 
  ALTER COLUMN weight_grams TYPE INTEGER 
  USING ROUND(weight_grams)::INTEGER;

-- Change real to numeric for scores
ALTER TABLE vendors
  ALTER COLUMN reliability_score TYPE NUMERIC(3,2)
  USING reliability_score::NUMERIC(3,2);

ALTER TABLE vendors
  ALTER COLUMN cancellation_rate TYPE NUMERIC(3,2)
  USING cancellation_rate::NUMERIC(3,2);

ALTER TABLE vendors
  ALTER COLUMN average_processing_time_hours TYPE INTEGER
  USING ROUND(average_processing_time_hours)::INTEGER;

ALTER TABLE listings
  ALTER COLUMN confidence_score TYPE NUMERIC(3,2)
  USING confidence_score::NUMERIC(3,2);

ALTER TABLE interchange_memberships
  ALTER COLUMN confidence TYPE NUMERIC(3,2)
  USING confidence::NUMERIC(3,2);