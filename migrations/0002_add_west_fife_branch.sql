
-- Add West Fife and Kinross branch
INSERT INTO branches (id, name, display_name, created_at)
VALUES (
  gen_random_uuid(),
  'west-fife-kinross',
  'West Fife',
  NOW()
)
ON CONFLICT (name) DO NOTHING;
