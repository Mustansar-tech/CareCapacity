# Overview

This is a comprehensive Care Hours vs Client Demand dashboard specifically designed for care home scheduling teams. The application provides detailed workforce management capabilities with a focus on daily scheduling decisions, capacity planning, and Excel-based reporting. The system addresses critical scheduling team needs by consolidating employee availability, contracted hours, client demand, and assignment data into intuitive, actionable views.

## Recent Major Updates (September 2025)

### Latest Improvements (September 9, 2025)
- **Fixed CG Data Processing**: Resolved critical issue where 0 employees were being loaded from CG Data files
- **Robust Sheet Detection**: Added intelligent sheet selection that finds the correct data sheet instead of always using the first one
- **Improved Column Matching**: Enhanced case/space-insensitive column detection with flexible name variations (e.g., "Weekly Hours", "Hours Per Week", "Contracted Hours")
- **Daily Capacity Table Fixes**: Corrected header alignment issues and updated "Required" header to "Client Required" for data accuracy
- **Enhanced Fuzzy Matching**: Improved employee name matching with better threshold (0.65) for more accurate availability filtering
- **Code Quality Improvements**: Added helper formatting functions (fmtH, fmtSignedH, statusBadge) for consistent data presentation
- **Table Structure Optimization**: Fixed column alignment issues with proper header-to-data mapping
- **Better Date Formatting**: Switched to UK date format (en-GB) for improved readability

### Previous Improvements (August 2025)
- **Modern Glass-Morphism UI**: Complete visual redesign with gradient backgrounds, backdrop blur effects, and smooth animations
- **Real-Time Alert System**: Capacity shortage alerts and smart scheduling recommendations prominently displayed
- **Enhanced Filtering & Search**: Advanced employee search by name, skill level, and availability status
- **Performance Analytics Dashboard**: Weekly utilization rates, staff efficiency metrics, and peak demand analysis
- **Time-Based Availability**: Switched from shift categories to specific time durations (e.g., 07:30-15:30, 10:30-14:30)
- **Smart Recommendations Engine**: Automated insights for critical staffing shortages and optimization opportunities
- **Enhanced Employee Profiles**: Skill level indicators, role badges, and visual status representations
- **Quick Actions Panel**: One-click access to common scheduling tasks and data refresh

### Previous Updates
- **Enhanced Daily Scheduling Tab**: Complete redesign with detailed employee tables showing contracted hours, availability windows, current assignments, and remaining capacity
- **Excel Export Functionality**: Replaced JSON exports with comprehensive Excel reports containing multiple sheets (Daily Summary, Employee Details, Client Demand)
- **Daily-Focused Reporting**: Shifted from weekly to daily reporting approach for scheduling team workflow
- **Scheduling Team Tools**: Added comprehensive employee scheduling table with all required information in one view
- **User-Friendly Visualizations**: Improved charts with clear labels and explanations for non-technical users
- **Status-based Employee Management**: Visual status indicators and filtering for scheduling decisions

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **React with TypeScript**: Modern component-based UI using functional components and hooks
- **Vite Build System**: Fast development server and optimized production builds
- **ShadCN UI Components**: Comprehensive component library built on Radix UI primitives
- **TailwindCSS Styling**: Utility-first CSS framework with custom design tokens
- **Wouter Routing**: Lightweight client-side routing solution
- **TanStack Query**: Server state management for API calls and caching
- **Recharts**: Data visualization library for dashboard analytics
- **File Processing**: Papa Parse for CSV parsing and XLSX for Excel file handling

## Backend Architecture
- **Express.js Server**: RESTful API server with TypeScript support
- **In-Memory Storage**: Simple storage interface with plans for database integration
- **Modular Route System**: Clean separation of API endpoints in dedicated route files
- **Development Middleware**: Hot reloading and error handling for development workflow

## Data Storage Solutions
- **Drizzle ORM**: Type-safe database toolkit configured for PostgreSQL
- **Schema Definition**: Centralized schema definitions in shared directory for type consistency
- **Migration System**: Database migration management with Drizzle Kit
- **Neon Database**: Serverless PostgreSQL database integration ready

## Authentication and Authorization
- **Session Management**: Express session handling with PostgreSQL session store
- **User Schema**: Basic user table with username/password authentication
- **Cookie-based Sessions**: Secure session management for user state persistence

## External Dependencies
- **Neon Database**: Serverless PostgreSQL hosting for production data storage
- **Replit Integration**: Development environment optimizations and deployment features
- **Chart Libraries**: Recharts for data visualization and analytics dashboards
- **File Processing**: Support for Excel (.xlsx) and CSV file formats for data import
- **UI Framework**: Radix UI primitives providing accessible component foundations
- **Development Tools**: ESBuild for fast bundling and TSX for TypeScript execution