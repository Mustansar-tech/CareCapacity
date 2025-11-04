# Care Capacity Dashboard - Design Guidelines

## Design Approach

**Selected Framework:** Fluent Design System foundation with custom glass-morphism aesthetic layer
**Rationale:** Fluent's data-dense interface patterns combined with acrylic material effects align perfectly with the glass-morphism requirement while maintaining enterprise dashboard usability.

**Key Design Principles:**
- Depth through layering and translucency
- Data clarity despite aesthetic treatment
- Persistent spatial awareness for branch context
- Light/dark theme equivalency

---

## Core Design Elements

### A. Typography

**Font Family:** Inter (via Google Fonts CDN)

**Type Scale:**
- Dashboard Title: text-3xl font-bold (30px)
- Section Headers: text-xl font-semibold (20px)
- Card Titles: text-lg font-medium (18px)
- Data Labels: text-sm font-medium (14px)
- Body Text: text-base (16px)
- Metadata/Captions: text-xs (12px)
- Large Metrics: text-4xl font-bold (36px) for KPIs

### B. Layout System

**Spacing Primitives:** Use Tailwind units of 3, 4, 6, and 8 (p-3, gap-4, m-6, h-8)

**Grid Structure:**
- Main container: max-w-screen-2xl mx-auto
- Dashboard sections: grid grid-cols-12 gap-6
- Card padding: p-6
- Section spacing: space-y-8

**Responsive Breakpoints:**
- Mobile: Single column stacks
- Tablet (md:): 2-column grids for metrics
- Desktop (lg:): 3-4 column layouts for data cards

### C. Component Library

**1. Glass-Morphism Cards:**
- Backdrop blur with semi-transparent backgrounds
- Subtle border with 1px stroke
- Border radius: rounded-xl (12px)
- Shadow: Soft elevation with blur
- Padding: p-6 standard, p-4 for compact variants

**2. Branch Selector (Persistent Header Element):**
- Fixed position in top navigation bar
- Dropdown with glass treatment
- Display currently selected branch name prominently
- 9 options in scrollable list with search capability
- Icon indicator (map pin or building) before branch name
- Width: min-w-64 on desktop, full-width drawer on mobile

**3. Navigation:**
- Sidebar navigation (left-aligned, fixed)
- Width: w-64 on desktop, collapsible hamburger on mobile
- Glass-morphism treatment matching card aesthetic
- Navigation items: p-3 with icon + label horizontal layout
- Active state: subtle background fill with accent border-left indicator
- Sections: Dashboard, Upload Data, Capacity Analysis, Scheduling, Branch Management

**4. Data Visualization Cards:**
- KPI Cards: Display large metric with label, trend indicator (arrow), and percentage change
- Chart Containers: Glass cards with h-80 minimum height
- Table Containers: Sticky header rows, alternating row treatments for readability
- Progress Bars: Rounded-full with glass fill, height h-3

**5. Upload Interface:**
- Drag-and-drop zone: min-h-48, dashed border treatment
- File list display with glass cards for each uploaded item
- Progress indicators during upload
- Success/error states with icon badges

**6. Forms & Inputs:**
- Input fields: Glass treatment with border, p-3 height
- Select dropdowns: Match branch selector aesthetic
- Buttons: Three variants:
  - Primary: Solid fill with blur backdrop
  - Secondary: Ghost with border
  - Tertiary: Text only
- Button sizes: h-10 standard, h-12 for prominent CTAs

**7. Data Tables:**
- Glass header row with sticky positioning
- Row height: h-14
- Zebra striping: subtle opacity differences
- Sortable columns with icon indicators
- Pagination controls at bottom

**8. Modals & Overlays:**
- Full-screen overlay with strong backdrop blur
- Modal max-w-2xl centered
- Close button top-right with icon
- Footer actions right-aligned

**9. Status Indicators:**
- Badge components: Small rounded-full pills
- Color coding: Success, warning, error, info states
- Dot indicators: w-2 h-2 rounded-full for status

**10. Branch Management Grid:**
- 3-column grid (lg:grid-cols-3 md:grid-cols-2)
- Each branch card displays: name, capacity metrics, staff count, occupancy rate
- Quick action buttons within cards

### D. Animations

**Minimal, Purposeful Motion:**
- Card hover: Subtle scale(1.01) and brightness lift (100ms duration)
- Dropdown/modal entry: Fade + scale from 0.95 (150ms)
- Data refresh: Subtle pulse on update (300ms)
- No continuous animations or distracting effects

---

## Page-Specific Layouts

### Dashboard Home (Default View)
**Structure:**
- Top bar: Logo left, Branch Selector center-right, theme toggle + user menu right
- Left sidebar: Navigation (fixed)
- Main content area: 
  - 4-column KPI row (grid-cols-4): Total Capacity, Current Occupancy, Staff On Duty, Open Shifts
  - 2-column row (grid-cols-2): Capacity chart (line/area), Occupancy heatmap
  - 3-column row (grid-cols-3): Upcoming shifts table, Staff availability list, Recent alerts
  
### Upload Data Page
- Centered upload zone with instructions
- Recent uploads list below (grid of glass cards)
- Processing status for active uploads

### Capacity Analysis Page
- Filter bar at top (date range, branch, department)
- Large chart area (h-96)
- Supporting metrics grid below
- Export button top-right

### Scheduling Optimization Page
- Calendar view with glass treatment
- Shift blocks as draggable cards
- Side panel for staff assignment
- Conflict indicators with warning badges

### Branch Management Page
- Grid of 9 branch cards (3x3 on desktop)
- Each card: Branch name header, 4 key metrics, "View Details" button
- Add/edit branch modal

---

## Images

**No large hero image** - This is a dashboard application focused on data and utility. All visual interest comes from the glass-morphism aesthetic, data visualizations, and interface depth.

**Icon Usage:** Heroicons (via CDN) for all interface icons - navigation, status indicators, actions, and data decorations.

---

## Theme Implementation Notes

Maintain glass-morphism effect in both themes through:
- Light theme: Light backgrounds with blur, subtle shadows
- Dark theme: Dark backgrounds with blur, stronger glow effects
- Ensure all text maintains WCAG AA contrast ratios
- Border treatments adjust opacity per theme
- Data visualization colors maintain accessibility across themes