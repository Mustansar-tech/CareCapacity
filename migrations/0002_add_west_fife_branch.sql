
-- Add West Fife branch
INSERT INTO branches (id, name, display_name, region)
VALUES (
  'd3859b52-cfbb-4c23-b94a-4ca4f5351d65',
  'west-fife',
  'West Fife',
  'Fife'
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  region = EXCLUDED.region;
