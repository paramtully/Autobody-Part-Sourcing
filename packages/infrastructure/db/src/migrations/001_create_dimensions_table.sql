-- Create part_dimensions table
CREATE TABLE IF NOT EXISTS part_dimensions (
    part_id UUID PRIMARY KEY,
    length_mm INTEGER NOT NULL,
    width_mm INTEGER NOT NULL,
    height_mm INTEGER NOT NULL,
    CONSTRAINT part_dimensions_part_id_fkey FOREIGN KEY (part_id) REFERENCES parts (id) ON DELETE CASCADE
);

-- Migrate existing dimensions from JSONB to separate table
INSERT INTO part_dimensions (part_id, length_mm, width_mm, height_mm)
SELECT 
  id as part_id,
  (dimensions->>'lengthMM')::INTEGER as length_mm,
  (dimensions->>'widthMM')::INTEGER as width_mm,
  (dimensions->>'heightMM')::INTEGER as height_mm
FROM parts
WHERE dimensions IS NOT NULL
  AND dimensions->>'lengthMM' IS NOT NULL
  AND dimensions->>'widthMM' IS NOT NULL
  AND dimensions->>'heightMM' IS NOT NULL
ON CONFLICT (part_id) DO NOTHING;

-- Drop dimensions column from parts table
ALTER TABLE parts DROP COLUMN IF EXISTS dimensions;