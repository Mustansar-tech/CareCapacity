# Overview

This is a comprehensive Care Hours vs Client Demand dashboard specifically designed for care home scheduling teams. The application provides detailed workforce management capabilities with a focus on daily scheduling decisions, capacity planning, and Excel-based reporting. The system addresses critical scheduling team needs by consolidating employee availability, contracted hours, client demand, and assignment data into intuitive, actionable views.

## Recent Major Updates (August 2025)

- **Enhanced Daily Scheduling Tab**: Complete redesign with detailed employee tables showing contracted hours, availability windows, current assignments, and remaining capacity
- **Excel Export Functionality**: Replaced JSON exports with comprehensive Excel reports containing multiple sheets (Daily Summary, Employee Details, Client Demand)
- **Daily-Focused Reporting**: Shifted from weekly to daily reporting approach for scheduling team workflow
- **Scheduling Team Tools**: Added comprehensive employee scheduling table with all required information in one view
- **User-Friendly Visualizations**: Improved charts with clear labels and explanations for non-technical users
- **Real-time Cost Calculations**: Added hourly rates and estimated costs for remaining capacity
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