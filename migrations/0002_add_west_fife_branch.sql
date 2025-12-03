-- Add West Fife branch (matching the naming pattern from the image: "Home Instead West Fife and Kinross")
INSERT INTO branches (id, name, display_name, region, created_at)
VALUES (
  '7e8f9a0b-1c2d-3e4f-5a6b-7c8d9e0f1a2b',
  'west-fife-and-kinross',
  'West Fife',
  'Fife',
  NOW()
) ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name, region = EXCLUDED.region;