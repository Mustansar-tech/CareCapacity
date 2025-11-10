CREATE TABLE "branches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "branches_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "capacity_analyses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" varchar NOT NULL,
	"week_start_date" text NOT NULL,
	"week_end_date" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"kpis" jsonb NOT NULL,
	"daily_summary" jsonb NOT NULL,
	"employees_by_date" jsonb NOT NULL,
	"employee_summary_by_date" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb,
	CONSTRAINT "unique_week" UNIQUE("branch_id","week_start_date","week_end_date")
);
--> statement-breakpoint
CREATE TABLE "client_locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" varchar NOT NULL,
	"client_name" text NOT NULL,
	"address_line" text NOT NULL,
	"postcode" text NOT NULL,
	"lat" text,
	"lng" text,
	"geocoded_at" timestamp,
	CONSTRAINT "unique_client_per_branch" UNIQUE("branch_id","client_name")
);
--> statement-breakpoint
CREATE TABLE "employee_locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" varchar NOT NULL,
	"employee_name" text NOT NULL,
	"home_postcode" text NOT NULL,
	"home_lat" text,
	"home_lng" text,
	"transport_mode" text DEFAULT 'car',
	"gender" text,
	"geocoded_at" timestamp,
	CONSTRAINT "unique_employee_per_branch" UNIQUE("branch_id","employee_name")
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" varchar NOT NULL,
	"key" text NOT NULL,
	"lat" text NOT NULL,
	"lng" text NOT NULL,
	"source" text NOT NULL,
	"cached_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_cache_per_branch" UNIQUE("branch_id","key")
);
--> statement-breakpoint
CREATE TABLE "route_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" varchar NOT NULL,
	"date" text NOT NULL,
	"employee_id" varchar NOT NULL,
	"total_distance_km" text,
	"total_travel_minutes" integer,
	"status" text DEFAULT 'optimized',
	"warnings" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_plan_id" varchar NOT NULL,
	"visit_id" varchar NOT NULL,
	"sequence" integer NOT NULL,
	"scheduled_start" text,
	"scheduled_end" text,
	"travel_minutes_from_prev" integer,
	"distance_km_from_prev" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" varchar NOT NULL,
	"client_id" varchar NOT NULL,
	"date" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"preferred_start_time" text,
	"preferred_end_time" text,
	"priority" integer DEFAULT 1,
	"service_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" varchar NOT NULL,
	"week_start_date" text NOT NULL,
	"week_end_date" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"schedule_data" jsonb NOT NULL,
	"unallocated_visits" jsonb DEFAULT '[]'::jsonb,
	"metrics" jsonb NOT NULL,
	CONSTRAINT "unique_weekly_schedule" UNIQUE("branch_id","week_start_date","week_end_date")
);
--> statement-breakpoint
ALTER TABLE "capacity_analyses" ADD CONSTRAINT "capacity_analyses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_locations" ADD CONSTRAINT "client_locations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_locations" ADD CONSTRAINT "employee_locations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geocode_cache" ADD CONSTRAINT "geocode_cache_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_employee_id_employee_locations_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_plan_id_route_plans_id_fk" FOREIGN KEY ("route_plan_id") REFERENCES "public"."route_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_client_id_client_locations_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_schedules" ADD CONSTRAINT "weekly_schedules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_idx" ON "capacity_analyses" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "week_start_idx" ON "capacity_analyses" USING btree ("week_start_date");--> statement-breakpoint
CREATE INDEX "uploaded_at_idx" ON "capacity_analyses" USING btree ("uploaded_at");--> statement-breakpoint
CREATE INDEX "client_branch_idx" ON "client_locations" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "client_name_idx" ON "client_locations" USING btree ("client_name");--> statement-breakpoint
CREATE INDEX "client_postcode_idx" ON "client_locations" USING btree ("postcode");--> statement-breakpoint
CREATE INDEX "employee_branch_idx" ON "employee_locations" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "employee_name_idx" ON "employee_locations" USING btree ("employee_name");--> statement-breakpoint
CREATE INDEX "postcode_idx" ON "employee_locations" USING btree ("home_postcode");--> statement-breakpoint
CREATE INDEX "geocode_branch_idx" ON "geocode_cache" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "geocode_key_idx" ON "geocode_cache" USING btree ("key");--> statement-breakpoint
CREATE INDEX "route_branch_idx" ON "route_plans" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "route_employee_date_idx" ON "route_plans" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "route_date_idx" ON "route_plans" USING btree ("date");--> statement-breakpoint
CREATE INDEX "route_stop_plan_seq_idx" ON "route_stops" USING btree ("route_plan_id","sequence");--> statement-breakpoint
CREATE INDEX "visit_branch_idx" ON "visits" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "visit_date_idx" ON "visits" USING btree ("date");--> statement-breakpoint
CREATE INDEX "visit_client_date_idx" ON "visits" USING btree ("client_id","date");--> statement-breakpoint
CREATE INDEX "weekly_schedule_branch_idx" ON "weekly_schedules" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "weekly_schedule_start_idx" ON "weekly_schedules" USING btree ("week_start_date");--> statement-breakpoint
CREATE INDEX "weekly_schedule_generated_idx" ON "weekly_schedules" USING btree ("generated_at");