-- Create partial unique indexes for listings table
-- These enforce uniqueness on (vendorId, vendorListingExternalId) OR (vendorId, sourceUrl)
CREATE UNIQUE INDEX IF NOT EXISTS listings_vendor_external_id_unique 
  ON listings (vendor_id, vendor_listing_external_id) 
  WHERE vendor_listing_external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS listings_vendor_source_url_unique 
  ON listings (vendor_id, source_url) 
  WHERE source_url IS NOT NULL;
