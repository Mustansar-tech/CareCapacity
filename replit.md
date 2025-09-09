# Care Capacity Dashboard

A comprehensive workforce management application designed specifically for care home scheduling teams. This modern web application provides real-time capacity analysis, employee scheduling optimization, and data-driven insights to support daily operational decisions in care facilities.

## Application Overview

The Care Capacity Dashboard is a full-stack TypeScript application that processes Excel-based workforce data to deliver actionable insights for care home operations. It transforms raw scheduling data into visual dashboards, AI-powered recommendations, and detailed analytics to optimize staff allocation and meet client demands.

### Core Functionality

**Data Processing Engine**
- Processes four Excel files: Availability Export, Care Pro Guaranteed Hours, Hours by Service Type, and CG Data Export
- Intelligent sheet detection with flexible column matching for various Excel formats
- Robust data validation and error handling with user-friendly feedback
- Real-time processing with progress indicators and status updates

**Multi-Tab Dashboard Interface**
- **Overview Tab**: File upload interface, key performance indicators, data period summaries
- **Daily View Tab**: Day-by-day capacity breakdown with employee drill-down details
- **Employee Summary Tab**: Individual employee performance and capacity metrics by date
- **AI Insights Tab**: Machine learning-powered recommendations for scheduling optimization
- **Analytics Tab**: Interactive charts showing capacity trends and demand patterns
- **Quality Tab**: Data integrity assessment with completeness and accuracy metrics
- **Export Tab**: Excel export functionality with multiple formatted sheets

**Advanced Features**
- AI-powered scheduling recommendations with impact analysis and confidence scoring
- Interactive data visualization with hover tooltips and clickable elements
- Automatic data quality assessment across multiple dimensions
- Flexible time window management for complex shift patterns
- Real-time capacity gap analysis with visual status indicators

## User Experience

**Modern UI Design**
- Glass-morphism interface with gradient backgrounds and backdrop blur effects
- Dark/light theme support with system preference detection
- Responsive design optimized for desktop and tablet use
- Smooth animations and transitions for enhanced user interaction
- Loading skeletons and progress indicators for better perceived performance

**User-Friendly Features**
- Automatic loading of latest processed data on application start
- One-click data refresh with toast notifications for status updates
- Visual status badges for capacity shortages and sufficient coverage
- Date-based filtering with calendar integration
- Comprehensive error messaging with actionable guidance

## Technical Architecture

### Frontend Stack
- **React 18 + TypeScript**: Modern component architecture with full type safety
- **Vite**: Lightning-fast development server with hot module replacement
- **ShadCN UI**: Comprehensive component library built on Radix UI primitives
- **TailwindCSS**: Utility-first styling with custom design tokens and animations
- **TanStack Query**: Advanced server state management with caching and synchronization
- **Wouter**: Lightweight client-side routing for multi-page navigation
- **Recharts**: Interactive data visualization with responsive chart components

### Backend Infrastructure
- **Express.js + TypeScript**: RESTful API server with comprehensive middleware stack
- **Multer**: File upload handling with validation and size limits
- **Drizzle ORM**: Type-safe database operations with PostgreSQL integration
- **XLSX**: Excel file processing with robust parsing and generation capabilities
- **Fuzzy Matching**: Advanced name matching algorithms with confidence scoring

### Data Management
- **PostgreSQL Database**: Serverless Neon database for production-grade data storage
- **Session Management**: Secure user sessions with PostgreSQL session store
- **Data Validation**: Comprehensive input validation using Zod schemas
- **Automatic Cleanup**: Configurable data retention policies with preview functionality

## Application Structure

### Main Navigation
1. **Dashboard** (`/`) - Primary data processing and analysis interface
2. **Monthly Analysis** (`/monthly-analysis`) - Historical trend analysis and reporting
3. **Data Management** (`/data-management`) - Data governance and cleanup operations

### API Endpoints
- `POST /api/process` - Upload and process Excel files
- `GET /api/export` - Download processed data as Excel
- `GET /api/history` - Retrieve historical analysis records
- `GET /api/history/latest` - Get most recent analysis
- `GET /api/history/monthly/{year}/{month}` - Monthly aggregated data
- `GET /api/cleanup/preview/{months}` - Preview data cleanup operations
- `POST /api/cleanup` - Execute data cleanup with retention policies

## Key Capabilities

**Capacity Management**
- Real-time calculation of net capacity vs. client demand
- Employee availability tracking with time window flexibility
- Automatic gap analysis with shortage/surplus identification
- Daily and weekly capacity trend visualization

**Employee Analytics**
- Individual employee performance metrics
- Contracted vs. scheduled hours comparison
- Availability pattern analysis
- Skill-based capacity assessment

**Operational Intelligence**
- AI-powered scheduling optimization recommendations
- Business opportunity identification
- Risk assessment and mitigation strategies
- Data quality monitoring and alerts

**Reporting & Export**
- Multi-sheet Excel exports with formatted data tables
- Historical trend analysis with monthly aggregations
- Customizable date range reporting
- Visual dashboard screenshots and data summaries

## Development Environment

**Prerequisites**
- Node.js 20+ with TypeScript support
- PostgreSQL database (Neon serverless recommended)
- Modern web browser with ES2020+ support

**Development Workflow**
- Hot module replacement for instant code updates
- Automatic database migrations with Drizzle Kit
- Type-safe API development with shared schemas
- Comprehensive error handling and logging

**Deployment**
- Containerized deployment ready
- Environment-based configuration
- Database connection pooling
- Static asset optimization with Vite build system

## User Preferences

Communication Style: Simple, everyday language suitable for non-technical care home staff and management teams.

Data Security: All data processing occurs within secure, encrypted environments with automatic cleanup policies to ensure compliance with healthcare data regulations.