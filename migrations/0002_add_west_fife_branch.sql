-- Add West Fife branch (matching the naming pattern from the image: "Home Instead West Fife and Kinross")
INSERT INTO branches (id, name, display_name, region)
VALUES (
  '7e8f9a0b-1c2d-3e4f-5a6b-7c8d9e0f1a2b',
  'west_fife_and_kinross',
  'West Fife',
  'Fife'
) ON CONFLICT (id) DO NOTHING;