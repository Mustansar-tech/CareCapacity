# Care Capacity Dashboard - Intelligent Workforce Management System

## Overview

The Care Capacity Dashboard is an intelligent, AI-powered scheduling platform designed to transform workforce management for care homes. It addresses critical operational challenges such as capacity blindness, scheduling complexity, fragmented data, and reactive management. By automating scheduling, optimizing routes using advanced algorithms (VRPTW), and providing predictive insights through machine learning, the system aims to improve care delivery, reduce operational costs, and identify new business opportunities. It turns fragmented Excel data into a unified source of truth, enabling proactive capacity planning and efficient resource allocation.

## User Preferences

The application is designed for care home scheduling teams and business development staff. It uses simple, everyday language focused on practical insights rather than technical implementation, with all technical complexity hidden behind intuitive interfaces and clear visualizations.

## System Architecture

### Technology Stack

**Frontend:**
- **React 18 + TypeScript:** For a modern, type-safe user interface.
- **Vite:** Fast development with hot module replacement.
- **ShadCN UI + Radix primitives:** Accessible and aesthetically pleasing components.
- **TailwindCSS:** Custom glass-morphism design system.
- **TanStack Query:** Intelligent server state management and caching.
- **Recharts:** Interactive data visualization.

**Backend:**
- **Express.js + TypeScript:** RESTful API with comprehensive middleware.
- **Drizzle ORM:** Type-safe PostgreSQL database operations.
- **Multer:** Secure file upload handling with validation.
- **XLSX:** Robust Excel file processing (read and write).
- **Advanced fuzzy name matching:** With confidence scoring for data reconciliation.
- **Sophisticated time window arithmetic:** For accurate capacity calculations.

**Database & Storage:**
- **PostgreSQL (Neon serverless):** Production-grade reliability.
- **Session management:** With PostgreSQL session store.
- **Zod schemas:** Comprehensive data validation.
- **Geocoding cache:** Multi-level fallback hierarchy for performance.

### Performance Optimizations

- **70-80% Faster File Processing:** Achieved through multi-level geocoding cache (exact postcode → district → area fallback), parallel batch processing, duplicate elimination, and smart fallback cache checks before API calls.
- **Advanced Scheduling Memoization:** Significantly reduced optimization time by caching and reusing travel time calculations between identical location pairs, preventing redundant API/geometric calculations.

### Feature Specifications

- **File Upload & Processing:** Handles four required Excel files (Availability Export, Care Pro Guaranteed Hours, Hours by Service Type, CG Data Export) with flexible column matching, status canonicalization, and robust error handling.
- **Overview Tab:** Executive dashboard with 9 KPI cards (Net Capacity, Client Required, Scheduled Hours, Unavailability, Holidays, Sickness, etc.).
- **Daily Capacity Tab:** Day-by-day analysis with a daily summary table, employee drill-down, gender-based color coding, and transport mode indicators.
- **Employee Summary Tab:** Comprehensive metrics per employee, including contracted vs. scheduled hours, availability patterns, and free windows calculation.
- **BD Matrix (Business Development):** A 7-day heatmap visually displaying employee availability for business development opportunities.
- **Schedules Tab:** Automated weekly planning using an enhanced VRPTW optimization engine. Features include:
    - **Flexible Gap-Filling:** Optimized to allocate visits in tight windows (e.g., 2-minute buffers).
    - **Travel Time Extra:** Intelligent "compression" logic that allows visits to be scheduled even if travel time exceeds available gaps by up to 15 minutes.
    - **Early Start Allowance:** Permits visits to start up to 15 minutes early to maximize workforce utilization.
    - **Constraint Enforcement:** Respects 9-hour daily care limits, weekly contracted hours, and gender preferences.
    - **Visual Indicators:** Real-time feedback on travel compression and shift overflows in the dashboard.
- **AI Insights Tab:** Provides predictive analytics, workload redistribution opportunities, staff optimization suggestions, and risk assessments with actionable insights.
- **Analytics Tab:** Interactive visualizations (bar, line, area, pie charts) for daily comparisons, trend analysis, and data distribution, along with a data quality panel.
- **Export Tab:** Comprehensive Excel reports including cleaned data, daily summary, and employee details.

### Core Data Parsing & Validation Logic

The system follows strict rules for data extraction and validation to ensure 100% accuracy in scheduled hours reporting:

#### 1. Employee Name Resolution (The Fallback Chain)
To prevent missing hours when data is incomplete:
- **Primary Source:** "Actual Employee Name"
- **Secondary Fallback:** "Planned Employee Name" (used if "Actual" is empty)
- **Third Fallback:** "Service Requirement" metadata (used for shadowing/office hours)
- This ensures employees like Palmer and Campbell (who often only have "Planned" entries) are always captured.

#### 2. Scheduled Hours Calculation (Care Pro Guaranteed Hours)
- **Validation:** Every row must have a name (either Actual or Planned) and valid timestamps.
- **Ad-Hoc Injection:** Any employee found in the schedule file who is *not* in the main employee database is automatically "injected" as an ad-hoc employee.
- **Zero-Hour Support:** Employees with 0 contracted weekly hours are fully supported and their scheduled visits are counted in all totals.
- **Night Visit Exclusion:** Rows marked with "Night", "Sleep In", "Waking", or "Overnight" are excluded from capacity and scheduled totals per business rules.
- **Cancellation Logic:** Only rows with a blank "Cancellation Description" are counted towards scheduled totals.

#### 3. Capacity Formulas (Net Capacity)
- **Gross Capacity:** Total available hours from Availability Export.
- **Deductions:** (Unavailability + Sickness + Holidays).
- **Net Capacity Formula:** strictly follows: `Gross Available Hours - Unavailability - Sickness - Holidays`.
- **Capping Logic:** Deductions (Sickness/Holidays) are capped at the employee's daily contracted hours to prevent negative capacity.

#### 4. Time Window Management
- **Day-Killers:** Statuses like "Holiday" or "Sick" wipe out the entire day's capacity.
- **Time-Killers:** Statuses like "Appointment" or "Personal" only subtract specific windows.
- **Minimum Bookable Window:** Windows shorter than 45 minutes are ignored for capacity but still shown as unavailable.

### Production Security (Feb 2026)

- **Structured Logging:** All server files use centralized `server/logger.ts` that suppresses debug/info output in production, formats as JSON for log aggregation, and strips stack traces from error logs.
- **Safe Error Responses:** API error responses use `safeErrorMessage()` helper to prevent internal error messages, stack traces, and file paths from reaching clients in production.
- **Security Headers:** Comprehensive CSP, HSTS, and XSS protection configured.
- **Rate Limiting:** Applied to all `/api` routes in production.

### Data Privacy & Retention

- **Configurable Retention:** Default 3-month data retention with user-controlled cleanup options.
- **Data Governance:** Secure session management and compliance-ready audit trails.

## External Dependencies

- **PostgreSQL (Neon serverless):** Primary database.
- **Google Maps API:** Used for geocoding and travel time calculations.
- **XLSX library:** For reading and writing Excel files.
