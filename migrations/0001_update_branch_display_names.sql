
-- Update existing branches with user-friendly display names (simplified)
UPDATE branches SET display_name = 'Glasgow North' WHERE name = 'glasgow-north';
UPDATE branches SET display_name = 'Glasgow South' WHERE name = 'glasgow-south';
UPDATE branches SET display_name = 'North Lanarkshire' WHERE name = 'north-lanarkshire-glasgow-east';
UPDATE branches SET display_name = 'Stirling' WHERE name = 'stirling-falkirk';
UPDATE branches SET display_name = 'Perth' WHERE name = 'perthshire';
UPDATE branches SET display_name = 'Ayr' WHERE name = 'south-ayrshire-kilmarnock';
UPDATE branches SET display_name = 'Aberdeen' WHERE name = 'aberdeen';
UPDATE branches SET display_name = 'East Lothian' WHERE name = 'east-lothian-midlothian';
UPDATE branches SET display_name = 'Scottish Borders' WHERE name = 'scottish-borders';

-- Also fix any branches that might have full names in the 'name' column
UPDATE branches SET display_name = 'East Lothian' WHERE name LIKE '%east-lothian%';
UPDATE branches SET display_name = 'North Lanarkshire' WHERE name LIKE '%north-lanarkshire%';
UPDATE branches SET display_name = 'Ayr' WHERE name LIKE '%ayrshire%';
