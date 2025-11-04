
-- Add branch column to capacity_analyses
ALTER TABLE capacity_analyses ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT 'East Lothian and Midlothian';

-- Add branch column to employee_locations  
ALTER TABLE employee_locations ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT 'East Lothian and Midlothian';

-- Add branch column to client_locations
ALTER TABLE client_locations ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT 'East Lothian and Midlothian';

-- Add branch column to weekly_schedules
ALTER TABLE weekly_schedules ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT 'East Lothian and Midlothian';

-- Drop old unique constraints
ALTER TABLE capacity_analyses DROP CONSTRAINT IF EXISTS unique_week;
ALTER TABLE employee_locations DROP CONSTRAINT IF EXISTS employee_locations_employee_name_unique;
ALTER TABLE client_locations DROP CONSTRAINT IF EXISTS client_locations_client_name_unique;
ALTER TABLE weekly_schedules DROP CONSTRAINT IF EXISTS unique_weekly_schedule;

-- Add new branch-aware unique constraints
ALTER TABLE capacity_analyses ADD CONSTRAINT unique_week UNIQUE (branch, week_start_date, week_end_date);
ALTER TABLE employee_locations ADD CONSTRAINT unique_employee_per_branch UNIQUE (branch, employee_name);
ALTER TABLE client_locations ADD CONSTRAINT unique_client_per_branch UNIQUE (branch, client_name);
ALTER TABLE weekly_schedules ADD CONSTRAINT unique_weekly_schedule UNIQUE (branch, week_start_date, week_end_date);

-- Create branch indexes
CREATE INDEX IF NOT EXISTS branch_idx ON capacity_analyses(branch);
CREATE INDEX IF NOT EXISTS emp_branch_idx ON employee_locations(branch);
CREATE INDEX IF NOT EXISTS client_branch_idx ON client_locations(branch);
CREATE INDEX IF NOT EXISTS schedule_branch_idx ON weekly_schedules(branch);
