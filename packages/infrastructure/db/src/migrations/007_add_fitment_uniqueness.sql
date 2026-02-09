-- Fitment uniqueness is already enforced by the unique constraint created in migration 002
-- This migration is a placeholder for any additional fitment-related constraints
-- The unique constraint on (make, model, year, constraint, trim, engine) ensures
-- no duplicate fitment combinations

-- Add index for efficient fitment lookups
CREATE INDEX IF NOT EXISTS fitments_make_model_year_idx ON fitments (make, model, year);