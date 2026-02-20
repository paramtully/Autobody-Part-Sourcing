-- Add source vehicle provenance columns to listings table.
-- These columns capture donor vehicle information for recycled/salvage parts.
-- Populated by any vendor that provides vehicleVin, mileage, or damageType.

ALTER TABLE listings
  ADD COLUMN source_vehicle_vin VARCHAR(17),
  ADD COLUMN source_mileage INTEGER,
  ADD COLUMN source_damage_type VARCHAR(50);
