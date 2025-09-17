# Care Capacity Dashboard

A comprehensive workforce management application designed specifically for care home scheduling teams. This modern web application provides real-time capacity analysis, employee scheduling optimization, and data-driven insights to support daily operational decisions in care facilities.

## Application Overview

The Care Capacity Dashboard is a full-stack TypeScript application that processes Excel-based workforce data to deliver actionable insights for care home operations. It transforms raw scheduling data into visual dashboards, AI-powered recommendations, and detailed analytics to optimize staff allocation and meet client demands.

### Core Functionality

**Advanced Data Processing Engine**
- Processes four Excel files: Availability Export, Care Pro Guaranteed Hours, Hours by Service Type, and CG Data Export
- Intelligent sheet detection with flexible column matching for various Excel formats
- Status canonicalization ensuring "Avail" becomes "Available" and handles typos automatically
- Robust data validation and error handling with user-friendly feedback
- Real-time processing with progress indicators and status updates
- Advanced time window rules with day-killers vs time-killers logic
- Partial availability detection for identifying business development opportunities

**Multi-Tab Dashboard Interface**
- **Overview Tab**: File upload interface, key performance indicators, data period summaries, and essential metrics
- **Daily Capacity Tab**: Day-by-day capacity breakdown with employee drill-down details and interactive date selection
- **Employee Summary Tab**: Individual employee performance and capacity metrics filtered by date with transport mode indicators
- **Weekly Overview Tab**: Visual heatmap showing employee availability across the week for business development teams
- **AI Insights Tab**: Machine learning-powered recommendations for scheduling optimization with confidence scoring
- **Analytics Tab**: Interactive charts (Bar, Line, Area, Pie) showing capacity trends and demand patterns
- **Export Tab**: Excel export functionality with multiple formatted sheets

**Advanced Workforce Features**
- **Partial Availability Detection**: Distinguishes between full-day unavailability and partial availability for better capacity planning
- **Gender-Based Visual Coding**: Automatic color coding using title information (Mr=blue, Miss/Ms/Mrs=pink) throughout the dashboard
- **Time Window Management**: Minimum 60-minute bookable windows with touch/overlap only merging
- **Cancelled Visits Tracking**: Comprehensive tracking from multiple data sources for accurate capacity planning
- **Free Windows Calculation**: Identifies unscheduled positive hours available for assignment to new clients
- **Transport Mode Integration**: Visual indicators for employee transport preferences (car/walking icons)

## User Experience

**Modern Glass-Morphism UI Design**
- Glass-morphism interface with gradient backgrounds and backdrop blur effects
- Dark/light theme support with system preference detection and manual toggle
- Responsive design optimized for desktop and tablet use
- Smooth animations and transitions for enhanced user interaction
- Loading skeletons and progress indicators for better perceived performance
- Status pulse indicators showing system connectivity

**User-Friendly Features**
- Automatic loading of latest processed data on application start
- One-click data refresh with toast notifications for status updates
- Visual status badges for capacity shortages and sufficient coverage
- Interactive date-based filtering with calendar integration
- Comprehensive error messaging with actionable guidance
- Real-time tooltips and hover information throughout the interface

## Technical Architecture

### Frontend Stack
- **React 18 + TypeScript**: Modern component architecture with full type safety
- **Vite**: Lightning-fast development server with hot module replacement
- **ShadCN UI**: Comprehensive component library built on Radix UI primitives
- **TailwindCSS**: Utility-first styling with custom design tokens and glass-morphism effects
- **TanStack Query**: Advanced server state management with caching and synchronization
- **Wouter**: Lightweight client-side routing for multi-page navigation
- **Recharts**: Interactive data visualization with responsive chart components
- **Lucide React**: Modern icon system for consistent visual language

### Backend Infrastructure
- **Express.js + TypeScript**: RESTful API server with comprehensive middleware stack
- **Multer**: File upload handling with validation and size limits
- **Drizzle ORM**: Type-safe database operations with PostgreSQL integration
- **XLSX**: Excel file processing with robust parsing and generation capabilities
- **Advanced Name Matching**: Fuzzy matching algorithms with confidence scoring and canonicalization
- **Time Window Processing**: Sophisticated interval arithmetic for capacity calculations

### Data Management
- **PostgreSQL Database**: Serverless Neon database for production-grade data storage
- **Session Management**: Secure user sessions with PostgreSQL session store
- **Data Validation**: Comprehensive input validation using Zod schemas
- **Historical Data Retention**: Configurable 3-month data retention with preview functionality
- **Automatic Cleanup**: Scheduled cleanup operations with user-friendly preview

## Application Structure

### Main Navigation
1. **Dashboard** (`/`) - Primary data processing and analysis interface with multi-tab functionality
2. **Monthly Analysis** (`/monthly-analysis`) - Historical trend analysis and reporting capabilities
3. **Data Privacy** (`/data-management`) - Data governance, cleanup operations, and retention management

### API Endpoints
- `POST /api/process` - Upload and process Excel files with real-time progress tracking
- `GET /api/export` - Download processed data as comprehensive Excel workbook
- `GET /api/history` - Retrieve historical analysis records with pagination
- `GET /api/history/latest` - Get most recent analysis for automatic loading
- `GET /api/history/monthly/{year}/{month}` - Monthly aggregated data for trend analysis
- `GET /api/cleanup/preview/{months}` - Preview data cleanup operations before execution
- `POST /api/cleanup` - Execute data cleanup with retention policies

## Key Capabilities

**Advanced Capacity Management**
- Real-time calculation of net capacity vs. client demand with gap analysis
- Employee availability tracking with sophisticated time window flexibility
- Automatic capacity gap analysis with shortage/surplus identification
- Daily and weekly capacity trend visualization with interactive charts
- Partial availability detection preserving capacity for business development opportunities

**Intelligent Employee Analytics**
- Individual employee performance metrics with transport mode indicators
- Contracted vs. scheduled hours comparison with variance analysis
- Availability pattern analysis across multiple time periods
- Gender-based visual coding for enhanced user experience
- Free windows calculation for identifying scheduling opportunities
- Cancelled visits tracking for comprehensive capacity assessment

**Business Intelligence Features**
- **Day-Killers vs Time-Killers Logic**: Holiday/Sick (eliminate full day) vs Other Unavailable/Pre-Agreed Appointment (block specific times)
- **Partial Availability Status**: New status type for employees with some availability despite time blockers
- **Minimum Window Requirements**: 60-minute minimum for bookable time slots
- **Smart Status Canonicalization**: Handles variations like "Avail" → "Available" automatically
- **Touch/Overlap Merging**: Precise time window consolidation without artificial gaps

**Operational Intelligence**
- AI-powered scheduling optimization recommendations with impact analysis
- Business opportunity identification for client acquisition
- Risk assessment and mitigation strategies
- Data quality monitoring with comprehensive metrics
- Historical pattern analysis for strategic planning

**Advanced Reporting & Export**
- Multi-sheet Excel exports with formatted data tables and charts
- Historical trend analysis with monthly aggregations
- Customizable date range reporting with filtering options
- Visual dashboard insights and data summaries
- Weekly heatmap visualizations for business development presentations

## Data Processing Innovation

**Smart Time Window Management**
- **Day-Killer Detection**: Automatically identifies statuses that eliminate entire day availability (Holiday, Sick, Maternity/Paternity, Compassionate Leave)
- **Time-Killer Processing**: Handles partial blocks (Other Unavailable, Pre-Agreed Appointment) that only affect specific time slots
- **All-Day Heuristic**: Uses contracted daily minutes with 90% threshold to determine if time-killers effectively block entire days
- **Minimum Duration Filtering**: Ensures only 60+ minute windows are considered bookable
- **Precise Merging**: Touch/overlap only merging without artificial 30-minute tolerances

**Enhanced Status Intelligence**
- **Canonical Status Mapping**: Automatically normalizes status variations ("Avail" → "Available", "other unavail" → "Other Unavailable")
- **Partial Availability Status**: New virtual status for employees with some availability despite time blockers
- **Priority-Based Selection**: Sophisticated status prioritization preserving capacity for business development
- **Virtual Status Support**: Allows derived statuses not present in raw data aggregation

## Development Environment

**Prerequisites**
- Node.js 20+ with TypeScript support
- PostgreSQL database (Neon serverless recommended)
- Modern web browser with ES2020+ support

**Development Workflow**
- Hot module replacement for instant code updates
- Automatic database migrations with Drizzle Kit (`npm run db:push`)
- Type-safe API development with shared schemas
- Comprehensive error handling and logging
- Real-time debugging with development server

**Deployment**
- Containerized deployment ready
- Environment-based configuration
- Database connection pooling
- Static asset optimization with Vite build system
- Automatic workflow restart on file changes

## User Preferences

**Communication Style**: Simple, everyday language suitable for non-technical care home staff and management teams. Focus on practical insights rather than technical implementation details.

**Data Security**: All data processing occurs within secure, encrypted environments with automatic cleanup policies to ensure compliance with healthcare data regulations. 3-month historical retention with user-controlled cleanup operations.

**Business Focus**: Designed specifically for care home scheduling teams and business development departments who need to identify capacity opportunities and optimize staff allocation for client acquisition.