-- Create new normalized fitments table structure
CREATE TABLE IF NOT EXISTS fitments_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  year INTEGER NOT NULL,
  constraint fitment_constraint,
  trim VARCHAR(255),
  engine VARCHAR(255),
  CONSTRAINT fitments_unique UNIQUE (make, model, year, constraint, trim, engine)
);

-- Migrate existing fitment data to normalized structure
-- Expand year ranges, trims arrays, and constraints arrays into individual rows
INSERT INTO fitments_new (make, model, year, constraint, trim, engine)
SELECT DISTINCT
  f.make,
  f.model,
  year_series.year,
  constraint_val.constraint,
  trim_val.trim,
  NULL as engine -- Engine not in old structure
FROM fitments f
CROSS JOIN LATERAL generate_series(f.year_from, f.year_to) AS year_series(year)
CROSS JOIN LATERAL (
  SELECT unnest(COALESCE(f.trims, ARRAY[]::text[])) AS trim
) AS trim_val
CROSS JOIN LATERAL (
  SELECT unnest(COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(f.constraints)),
    ARRAY[]::text[]
  ))::fitment_constraint AS constraint
) AS constraint_val
ON CONFLICT (make, model, year, constraint, trim, engine) DO NOTHING;

-- Handle case where trims or constraints are NULL/empty
INSERT INTO fitments_new (make, model, year, constraint, trim, engine)
SELECT DISTINCT
  f.make,
  f.model,
  year_series.year,
  NULL as constraint,
  NULL as trim,
  NULL as engine
FROM fitments f
CROSS JOIN LATERAL generate_series(f.year_from, f.year_to) AS year_series(year)
WHERE (f.trims IS NULL OR array_length(f.trims, 1) IS NULL)
  AND (f.constraints IS NULL OR array_length(
    ARRAY(SELECT jsonb_array_elements_text(f.constraints)), 1
  ) IS NULL)
ON CONFLICT (make, model, year, constraint, trim, engine) DO NOTHING;

-- Update part_fitments to reference new fitment IDs
-- This is complex - we'll need to map old fitment IDs to new ones
-- For now, we'll create a mapping table
CREATE TEMP TABLE fitment_id_mapping AS
SELECT 
  f_old.id as old_id,
  f_new.id as new_id
FROM fitments f_old
JOIN fitments_new f_new ON (
  f_old.make = f_new.make
  AND f_old.model = f_new.model
  AND f_new.year BETWEEN f_old.year_from AND f_old.year_to
);

-- Update part_fitments with new fitment IDs
-- Note: This creates multiple part_fitment rows for each old fitment
-- if the old fitment had multiple years/trims/constraints
UPDATE part_fitments pf
SET fitment_id = mapping.new_id
FROM fitment_id_mapping mapping
WHERE pf.fitment_id = mapping.old_id;

-- Drop old fitments table and rename new one
DROP TABLE IF EXISTS fitments CASCADE;
ALTER TABLE fitments_new RENAME TO fitments;

-- Recreate foreign key constraint
ALTER TABLE part_fitments
  ADD CONSTRAINT part_fitments_fitment_id_fkey
  FOREIGN KEY (fitment_id)
  REFERENCES fitments(id)
  ON DELETE RESTRICT;
