# Overview

This is a people planning dashboard application built with React/TypeScript frontend and Express.js backend. The system provides workforce management capabilities including employee scheduling, availability tracking, and analytics visualization. It features Excel/CSV file upload functionality for bulk data import and comprehensive dashboard views with charts and metrics for operational insights.

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