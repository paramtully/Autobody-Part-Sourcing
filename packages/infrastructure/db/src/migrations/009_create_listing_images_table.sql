-- Create listing_images table for storing multiple images per listing
CREATE TABLE listing_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    image_type TEXT,
    source TEXT,
    sort_order INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index on listing_id for efficient queries when fetching images for a listing
CREATE INDEX listing_images_listing_id_idx ON listing_images(listing_id);
