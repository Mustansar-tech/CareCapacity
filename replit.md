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

### UI/UX Decisions

- **Modern Glass-Morphism UI:** Featuring glass-morphism effects, gradient backgrounds, backdrop blur, dark/light theme support, smooth animations, and responsive design.
- **Intuitive Interactions:** One-click data refresh, visual status badges, interactive date-based filtering, comprehensive error messaging, and real-time tooltips.
- **Performance Optimizations:** Loading skeletons, progress indicators, automatic data caching, and optimistic UI updates.

### Feature Specifications

- **File Upload & Processing:** Handles four required Excel files (Availability Export, Care Pro Guaranteed Hours, Hours by Service Type, CG Data Export) with flexible column matching, status canonicalization, and robust error handling.
- **Overview Tab:** Executive dashboard with KPIs like Net Capacity, Client Required, Capacity Gap, Unavailability, and Holidays.
- **Daily Capacity Tab:** Day-by-day analysis with a daily summary table, employee drill-down, gender-based color coding, and transport mode indicators.
- **Employee Summary Tab:** Comprehensive metrics per employee, including contracted vs. scheduled hours, availability patterns, and free windows calculation.
- **BD Matrix (Business Development):** A 7-day heatmap visually displaying employee availability for business development opportunities.
- **Schedules Tab:** Automated weekly planning using a VRPTW optimization engine, generating optimal employee runs while respecting constraints (e.g., 9-hour daily care limit, 20-minute max travel time, weekly contracted hours, time window compliance).
- **AI Insights Tab:** Provides predictive analytics, workload redistribution opportunities, staff optimization suggestions, and risk assessments with actionable insights.
- **Analytics Tab:** Interactive visualizations (bar, line, area, pie charts) for daily comparisons, trend analysis, and data distribution, along with a data quality panel.
- **Export Tab:** Comprehensive Excel reports including cleaned data, daily summary, and employee details.

### Advanced Data Processing

- **Smart Time Window Management:** Distinguishes "Day-Killers" (e.g., Holiday, Sick) from "Time-Killers" (e.g., Appointment) and enforces minimum bookable windows. Includes "Partial Availability" detection for business development.
- **Enhanced Status Intelligence:** Canonical status mapping, typo handling, and "Ad-Hoc Status Highlighting" for scheduled visits without availability records.
- **Geocoding & Travel Time Calculation:** Multi-level geocoding cache and real-time travel time calculations considering transport mode (car/walking) with a 20-minute hard constraint.
- **Weekly Contracted Hours (Net Capacity):** Integrates guaranteed hours from the master employee file to calculate and display net capacity, used for weekly constraint enforcement.

### Data Privacy & Retention

- **Configurable Retention:** Default 3-month data retention with user-controlled cleanup options and historical data browsing.
- **Data Governance:** Secure session management, environment-based configuration, automatic cleanup scheduling, and compliance-ready audit trails.

## External Dependencies

- **PostgreSQL (Neon serverless):** Primary database for storing application data.
- **Google Maps API (or similar geocoding service):** Implicitly used for geocoding functionality, though not explicitly named as a direct dependency in the provided text, the geocoding cache implies its usage.
- **XLSX library:** For reading and writing Excel files.