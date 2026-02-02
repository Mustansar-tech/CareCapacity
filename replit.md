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
- **Overview Tab:** Executive dashboard with KPIs like Net Capacity, Client Required, Capacity Gap, Unavailability, and Holidays.
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

### Advanced Data Processing

- **Smart Time Window Management:** Distinguishes "Day-Killers" (e.g., Holiday, Sick) from "Time-Killers" (e.g., Appointment) and enforces minimum bookable windows. Includes "Partial Availability" detection for business development.
- **Enhanced Status Intelligence:** Canonical status mapping, typo handling, and "Ad-Hoc Status Highlighting" for scheduled visits without availability records.
- **Geocoding & Travel Time Calculation:** Multi-level geocoding cache and real-time travel time calculations considering transport mode (car/walking). Features a "soft limit" for travel time with exponential scoring penalties rather than rigid rejections.
- **Travel Compression Logic:** Allows a "travel time extra" allowance where travel exceeding gaps by up to 15 minutes is accepted through smart start-time shifting.
- **Branch-Specific Preferences:** Support for per-branch scheduling preferences, including excluded service types, custom travel limits, and employee exclusions.
- **Weekly Contracted Hours (Net Capacity):** Integrates guaranteed hours from the master employee file to calculate and display net capacity, used for weekly constraint enforcement.

### Technical Limitations & Discoveries

- **People Planner Automation:** It was discovered that People Planner actively blocks automated and headless browsers (Chromium and Firefox) in cloud environments like Replit. The login process requires a real browser environment that supports legacy Internet Explorer compatibility checks. As a result, direct browser automation for syncing data is currently unsupported in the cloud-hosted version of the dashboard.
- **Recommended Workflow:** Users should manually export the required files from People Planner and upload them to the dashboard for processing. Future automation would require a dedicated local agent running on a Windows machine with a real browser (Edge in IE-mode).

## External Dependencies

- **PostgreSQL (Neon serverless):** Primary database for storing application data.
- **Google Maps API (or similar geocoding service):** Implicitly used for geocoding functionality, though not explicitly named as a direct dependency in the provided text, the geocoding cache implies its usage.
- **XLSX library:** For reading and writing Excel files.