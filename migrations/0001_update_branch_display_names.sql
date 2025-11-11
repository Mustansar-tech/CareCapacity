-- Update branch display names to simplified, user-friendly format
-- Backend logic names (in 'name' column) remain unchanged

UPDATE branches SET display_name = 'Glasgow North' WHERE name = 'glasgow-north';
UPDATE branches SET display_name = 'Glasgow South' WHERE name = 'glasgow-south';
UPDATE branches SET display_name = 'North Lanarkshire' WHERE name = 'north-lanarkshire';
UPDATE branches SET display_name = 'Stirling' WHERE name = 'stirling-falkirk';
UPDATE branches SET display_name = 'Perth' WHERE name = 'perthshire';
UPDATE branches SET display_name = 'Ayr' WHERE name = 'south-ayrshire';
UPDATE branches SET display_name = 'Aberdeen' WHERE name = 'aberdeen';
UPDATE branches SET display_name = 'East Lothian' WHERE name = 'east-lothian-midlothian';
UPDATE branches SET display_name = 'Scottish Borders' WHERE name = 'scottish-borders';