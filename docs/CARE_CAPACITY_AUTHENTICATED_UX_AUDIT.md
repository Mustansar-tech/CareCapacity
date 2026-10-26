# Care Capacity — authenticated UX and design-system audit

**Date:** 26 October 2026  
**Assessment:** Against the supplied Principal Product Designer / Enterprise UX Architect brief  
**Verdict:** Useful operational product with reusable foundations; not yet meeting the brief's accessibility, responsive-layout or fully documented design-system requirements.

## 1. Executive assessment

Do not rebuild the app. Preserve its workflows and business calculations, and improve the existing shared components and application shell.

The most important problems are functional usability issues, not visual taste:

1. Mobile page content is clipped because the desktop sidebar stays 220px wide.
2. Dashboard detail cards do not activate with Enter or Space.
3. Navigation search cannot open a result by keyboard and allows focus to leave its overlay.
4. Sidebar links suppress the visible keyboard focus indicator.
5. Real controls have missing accessible names, weak contrast and almost invisible boundaries.
6. A cross-month reporting period is displayed incorrectly.

The strongest existing patterns should be retained: branch context, familiar operational modules, shared Radix/shadcn primitives, help/documentation, audit-history presentation and the responsive joiner workspace.

**This was an audit, not a redesign or implementation.** No application source, business records, schedules, settings or automation configuration was changed. Signing in and out produces the application's normal authentication audit events.

## 2. Method and boundaries

### Evidence collected

- Signed in successfully through the real login form using the account authorised by the user; the returned role was admin.
- Inspected the running development preview with real Aberdeen branch data.
- Visited nine signed-in views: Overview, Daily View, Capacity Outlook, Workforce, Enquiry Dashboard, AI Schedule, People Planner, Administration and Documentation.
- Opened the joiner and leaver forms, Client Enquiry Matcher, workforce/client map, Add User dialog, navigation search and Administration's Audit Log tab.
- Performed keyboard activation and focus checks, computed-style measurements, responsive viewport checks and automated accessibility checks using axe-core 4.10.3.
- Inspected desktop at 1440×1000, tablet dashboard at 768×1024, mobile dashboard/joiner at 390×844, dashboard reflow at 320×800 and login at 1280×600.
- Cross-checked browser findings against the actual source.
- Blocked non-read API requests in the audit browser, except the authorised login/logout requests. Did not submit forms, generate schedules, run matching, upload files or trigger automation.
- Signed out and closed the browser session after inspection. Credentials/session cookies were not saved to project files. Identifiable screenshots are excluded from this report.

### Limitations

This is a representative authenticated UX audit, not a WCAG certification, security audit or full regression test.

- Admin and one branch were tested; scheduler, viewer, operations-director and cross-branch journeys were not exercised.
- Save/edit/delete persistence, failed submissions, unsaved-change warnings, job progress/cancellation and all empty/error states remain untested.
- No screen-reader session, physical touch-device test, dark-mode pass or production-deployment test was performed.
- The 320px viewport tests reflow; it is not a completed 400% browser-zoom test.
- Map rendering was inspected, not every marker/filter/territory interaction or routing accuracy.
- SUR Group BI, Data House, Day Rate Tracker and scoreboards remain outside the redesign scope and were not certified by this review.
- Early loading captures were not treated as final page results. Pages still loading were revisited before their settled findings were recorded.

The attachment is a design-system specification template, not a populated PRD. Product purpose and workflows below are inferred from the app, not newly approved business requirements. The named `design-system-creation` workflow was not available in this environment. No new production design system or mockup is claimed; this audit evaluates the current app and existing draft against the supplied standard.

## 3. Requirements-to-interface map

| User job / requirement | Existing interface | Assessment |
|---|---|---|
| Understand branch capacity and demand | Overview KPIs, trend and capacity charts | Present; keyboard drill-down, chart semantics and date-range presentation need correction |
| Inspect day-level staffing | Daily View with employee detail and filters | Present; dense table accessibility needs work |
| Forecast staffing changes | Capacity Outlook, joiners, leavers, availability changes | Present; preserve domain logic, improve actions and contrast |
| Inspect workforce availability | Monthly workforce grid | Present; small low-contrast labels and unnamed date navigation |
| Assess a new care enquiry | Availability matrix and enquiry form | Present; named time fields and icon controls are incomplete |
| Understand geographic coverage | Workforce & Client Map | Rendered with territory boundary, markers and filters; detailed interaction not certified |
| Build schedules | AI Schedule and timeline | Present; keyboard access to scroll regions and text contrast need work |
| Import operational data | Uploads and People Planner | Present; processing was deliberately not run |
| Control access and accountability | Users, roles, branches and Audit Log | Present; admin-only review does not verify permission enforcement |
| Learn and recover | Help, Documentation, password recovery, status messages | Present; naming and error/recovery consistency need a broader state pass |

Observed/inferred roles in the Care Capacity client are admin, scheduler, viewer and operations director. The client assigns editing/generation capability separately from read access. This describes the implementation; it is not verification of server-side authorisation.

## 4. Brief compliance

| Brief objective | Status | Evidence / remaining gap |
|---|---|---|
| Product and workflow analysis | Partial | Routes and domain flows exist; no populated PRD or approved requirements traceability supplied |
| Information architecture | Partial | Grouped navigation, branch switcher, app switcher and help exist; search is navigation-only and keyboard-incomplete |
| Semantic design foundations | Partial | Existing colour/type/spacing/radius tokens; inconsistent consumption and invalid nested colour syntax |
| Mature, calm visual language | Partial | Clear operational structure, but green shell, blue/teal gradients and purple module treatments compete |
| Responsive desktop/tablet/mobile | Not met in tested shell | 220px sidebar leaves 170px main content at 390px; joiner dialog is substantially better |
| WCAG 2.2 AA expectations | Not met in tested states | Confirmed keyboard, focus, naming and contrast defects |
| Reusable component library | Partial | 31 shared UI files; component contracts and state coverage are not complete |
| Full component documentation | Not demonstrated | Existing draft does not document every requested component's anatomy, API, states, keyboard, responsive behaviour and usage |
| Preserve business logic | Required rollout constraint | No logic changed during audit; calculations were not independently validated |
| Light/dark consistency | Not verified | Dark tokens exist; no authenticated dark-mode visual/contrast pass completed |

## 5. Confirmed high-priority findings

### H1 — Mobile shell clips essential content

**Evidence:** At 390px viewport width the sidebar remains 220px and the main area is only 170px. The dashboard heading extends to x=564px, outside the viewport. Controls and cards are cut off. At 320px the main area is just 100px wide.

**Source:** `client/src/components/layout/Sidebar.tsx:405–409`; `client/src/App.tsx:405–409`.

**Impact:** Ordinary page headings/actions cannot reflow, independently of any legitimate two-dimensional table/map exception. A manually collapsible desktop rail is not an adequate default mobile layout.

**Fix:** Use a mobile navigation drawer or equivalent responsive shell; allow page headers and action groups to wrap. Keep two-dimensional scrolling confined to genuine grids/maps.

**Acceptance:** At 320px and 390px, titles, branch context and primary actions are readable/reachable without document-level horizontal scrolling. Test focus return, zoom and short heights.

### H2 — Dashboard drill-downs require a mouse double-click

**Evidence:** Focused the Desired Hours KPI and pressed Enter, then Space. Neither opened its detail dialog. The source binds the native button to `onDoubleClick` without normal activation.

**Source:** `client/src/components/dashboard/OverviewTab.tsx:339–343`; the pattern repeats across the KPI strip.

**Related source finding:** Candidate availability in Outlook uses double-click table cells (`client/src/pages/capacity-outlook.tsx:1784,1899,1979`). Those candidate-cell journeys were not separately keyboard-tested.

**Fix:** Support normal button activation and an explicit “View details” affordance. Double-click may remain an optional shortcut.

**Acceptance:** Click/tap/Enter/Space all open the same authorised detail view; closing restores focus to the trigger.

### H3 — Navigation search is not an accessible command dialog

**Evidence:** Ctrl+K opens the overlay. After filtering to Workforce, ArrowDown then Enter does not navigate. Result rows are non-focusable divs without a role. Tabbing reaches the close and pin buttons, then moves to the underlying “Upload New Data” action while search remains open. The overlay has no dialog semantics.

**Source:** `client/src/components/layout/Sidebar.tsx:113–210`, especially `149–158` and `168–179`.

**Fix:** Reuse the existing command and dialog primitives rather than maintaining a custom partial implementation. Label the search field and close action; provide result navigation and focus management.

**Acceptance:** Keyboard users can filter, navigate and activate results; Tab cannot move into obscured page controls; Escape closes and restores focus. Rename to “Find a page” if it remains navigation-only.

### H4 — Sidebar links have invisible keyboard focus

**Evidence:** A focused Workforce navigation link matched `:focus-visible`, but its computed outline colour was fully transparent and it had no box shadow.

**Source:** `client/src/components/layout/Sidebar.tsx:245`; compare the intended global focus rule at `client/src/index.css:200`.

**Fix:** Remove the overriding `outline-none` or provide an explicit visible focus treatment that contrasts with the green sidebar. Add a skip-to-main-content link.

**Acceptance:** Every sidebar action has a visible keyboard focus indicator, including collapsed mode, with no clipping or obstruction.

### H5 — Form boundaries and several text treatments lack contrast

**Evidence:** In the real joiner form, input borders computed to RGB(249,250,251) against RGB(246,247,249) fields: approximately **1.03:1**. Against white, the border is approximately **1.05:1**. Unfocused input areas are difficult to distinguish.

Automated checks also measured:

- Joiner action: white on `#059669`, **3.76:1** at 14px.
- Workforce weekday labels: **3.14:1** at 9px.
- Outlook amber supporting text: **2.75:1** at 12px.
- Login privacy/terms/cookie links: **2.53:1** at 12px.

**Source:** `client/src/index.css:20,59`; `client/src/components/ui/input.tsx:11`; page-level colour classes in Outlook and Workforce.

**Fix:** Define separate surface/control-border tokens and tested foreground/background pairs. Avoid low-opacity text for information users need. Use 4.5:1 for normal text and 3:1 for essential non-text identification where applicable.

**Acceptance:** Check actual rendered states, including unfocused, focus, selected, error and disabled. WCAG does not require every decorative divider to meet the control-boundary threshold.

### H6 — Important controls are unnamed or improperly labelled

**Browser evidence from sampled states:**

| Surface | Confirmed issue |
|---|---|
| Outlook | 18 unnamed edit/delete buttons in the settled sampled view |
| Administration / Users | 27 unnamed action buttons |
| Workforce | Two unnamed previous/next month controls |
| Enquiry form | Three unnamed buttons and two unlabelled time fields |
| People Planner | “Week starting” text is not associated with the date input |
| Login | Password-reveal button has no accessible name and is excluded from Tab navigation |

These are snapshot counts, not unique defects across the entire app; they must not be added into a whole-app score.

**Source:** `client/src/pages/admin.tsx:281`; `client/src/pages/workforce.tsx:159–164`; `client/src/components/bd-matrix/VisitForm.tsx:42,53,111,124`; `client/src/components/PeoplePlannerPanel.tsx:421–431`; `client/src/pages/login.tsx:390–397`.

**Fix:** Name actions by intent, with row context where needed. Associate labels through `htmlFor`/`id` or a valid accessible-name mechanism. Make password visibility a named keyboard-operable toggle.

**Acceptance:** Each interactive control has a meaningful name and correct role/state in the accessibility tree. A nearby visual label or an icon alone is insufficient.

## 6. Further findings

### M1 — Cross-month week range is misleading

**Confirmed:** The dashboard displays “Week · 26–1 Oct 2026” for 26 October–1 November. Only the start month/year is used.

**Source:** `client/src/components/dashboard/SmartHero.tsx:89–101`.

**Fix/acceptance:** Show “26 Oct–1 Nov 2026”; include both years where required. Test same-month, cross-month and cross-year periods. Keep date-only semantics/timezones intact.

### M2 — Dense reporting needs accessible alternatives and scroll access

**Confirmed:** Axe reported three unnamed image-role paths in the dashboard capacity-breakdown chart and a schedule scroll region that was not keyboard-focusable. Daily View also exposed two invalid `aria-expanded` attributes on generic div triggers.

**Fix:** Give charts useful accessible summaries and an equivalent data view; use valid interactive trigger semantics and labelled keyboard-accessible scroll regions. The presence of another table elsewhere does not automatically make a chart equivalent.

**Acceptance:** Keyboard and screen-reader users can identify the metric, branch, period and values and reach every needed timeline area. Validate with an actual screen reader.

### M3 — Login loses footer content on short screens

**Confirmed:** At 1280×600, the login body measured 710px tall while body overflow was hidden. Legal links extended to y=678px, below the viewport.

**Source:** `client/src/index.css:9–12`; login page's full-height layout.

**Fix:** Limit internal-scroll locking to the application shell; let public/auth pages scroll naturally when required.

**Acceptance:** Sign-in, recovery and legal controls remain reachable at short laptop heights and when text is enlarged.

### M4 — Existing tokens are consumed inconsistently

**Source-confirmed and browser syntax-checked:** Tokens contain complete colours such as `hsl(...)`, but some declarations wrap them in another `hsl(...)`. The browser rejects `hsl(hsl(220 15% 85%))`.

**Source:** `client/src/components/joiner-availability.css:18–19`; `client/src/index.css:273–292`.

**Fix:** Standardise the current complete-colour convention and use `var(--token)` directly. Add a static check. Do not blindly replace every occurrence across BI/shared consumers.

### M5 — Component governance is still a draft

The app has 31 shared UI files and `docs/DESIGN_SYSTEM.md`, explicitly marked draft and not applied. That is a good starting point, not the full production library requested by the brief.

No design-system `docs/AGENTS.md` consumption contract, complete component-state catalogue or token source package was found in the inspected documentation/artifact paths.

**Fix:** Finish the consumption guide and documented contracts before claiming system completion. For every supported component, define purpose, anatomy, properties, variants, sizes, states, interaction, keyboard rules, accessibility, responsive behaviour, content and examples. Mark unused patterns “not currently required” rather than inventing functionality.

### M6 — Visual language and terminology vary across modules

**Observed:** Green sidebar identity, blue/teal gradient headings, purple Workforce/Enquiry styling, compact dashboard cards and different overlay treatments coexist. Navigation says “Enquiry Dashboard”; the page says “BD Availability Matrix”; documentation says “Capacity / BD Matrix”.

This is a consistency concern, not proof that every accent or dense table is wrong.

**Fix:** Agree semantic action/status/module tokens, page-header patterns, density variants and one primary name per module. Preserve meaningful domain distinctions and familiar workflows.

### M7 — Motion and transient-state coverage remain incomplete

**Source observation:** CSS and Framer Motion animations exist, but no `prefers-reduced-motion`, `useReducedMotion` or `MotionConfig` handling was found in the searched client source.

**Verification gap:** Not every animation, loading/error/empty/stale state or toast was manually exercised. Automated checks also flagged transient toast-list semantics; investigate separately rather than treating every toast instance as a new root defect.

**Fix:** Add a deliberate reduced-motion policy and shared state patterns; verify progress, retry and retained form values without changing business logic.

## 7. What is working and should be preserved

- Real signed-in pages and core operational modules load; no uncaught page exception was recorded in the inspected authenticated session.
- Branch context is prominent, and the sidebar separates insights, scheduling and recruitment.
- Existing shared primitives avoid the need for a replacement UI framework.
- The joiner dialog fits at 390px: 366px wide with 12px side margins. Inputs render at 16px, actions remain reachable, and its inner scrolling exposes the mobile availability controls.
- The joiner form initially shows blank desired/agreed hours and zero selected availability hours. Bank is an explicit action rather than an implied blank-input value.
- The sampled Add User dialog produced no axe violations in that state. This does not contradict the unnamed action buttons on the underlying Users list.
- The map rendered real markers and a territory outline; existing geography should not be redrawn as a styling exercise.
- The Audit Log distinguishes successful events from failed requests and offers labelled detail actions and filters.

## 8. Component-library gap map

| Requested family | Existing base / evidence | Required completion |
|---|---|---|
| Buttons, icon buttons, links | Shared button plus page-specific controls | Named icon API, focus, touch sizing, loading and destructive variants |
| Inputs, textarea, selects, comboboxes | Shared input/textarea/select/form/popover | Consistent borders, associated labels, hints/errors and keyboard combobox contracts |
| Checkbox, radio, switch, toggles | Checkbox and toggle primitives; local patterns | Inventory actual usage; standardise supported states rather than adding unused controls |
| Date/time/search/upload | Calendar, local date/time fields, custom navigation search, upload workflows | Accessible naming, date semantics, keyboard operation and processing/error guidance |
| Form sections and validation summaries | Form primitives and domain dialogs | Reusable layout, error summary/focus, unsaved changes and retained-input contracts |
| Badges/status/avatar/tooltip/popover/menu | Shared primitives plus local styling | Semantic status pairs, text alternatives, focus and portal theming |
| Tabs/breadcrumbs/pagination/accordion | Tabs, pagination and collapsible primitives | Keyboard/state contracts; breadcrumbs only where hierarchy warrants them |
| Cards/drawers/dialogs/toasts/banners/alerts | Shared card/sheet/dialog/toast/alert | Approved sizes, scroll ownership, focus restoration and transient-state semantics |
| Empty/skeleton/progress/stepper | Skeleton/progress and local loading states | Shared empty/error/stale/retry patterns; stepper only if workflow requires one |
| Tables/filters/bulk actions | Shared table, local filters and operational grids | Sorting semantics, URL state, accessible row actions and documented bulk-action safety |
| KPI cards/charts | Rich existing dashboard | Single-activation drill-downs, accessible summaries, numeric/date conventions |
| Activity/audit/comments/notifications | Audit UI, notes, help and toast patterns | Scope each pattern to a real requirement; document privacy and retention expectations |
| Permission/restricted states | Route guards and access-denied view | Test each actual role/branch, including direct navigation and API enforcement separately |

Do not create comments, notification centres, approval processes or other modules solely because the generic brief lists them. Confirm the product requirement first.

## 9. Recommended order and release gates

### First: remove access barriers

Fix H1–H6 in the shell and shared components; correct the cross-month label and short-height login issue. These changes offer more benefit than a broad visual restyle.

### Second: complete the system contract

Finish semantic token consumption, action/status variants, typography/density rules, component states and the agent-facing consumption guide. Preserve Care Capacity identity. Scope themes and Radix portals so SUR BI is not restyled accidentally.

### Third: adopt module by module

Pilot the shared patterns in the joiner/leaver forms, then Overview/Outlook, Workforce/Enquiries and Scheduling/People Planner. Keep calculation/ingestion changes separate.

### Required before calling the result production-ready

- Keyboard-only and screen-reader passes on primary journeys.
- Real 200%/400% zoom, 320px reflow, tablet, short-height and touch-device checks.
- Contrast verification for light/dark, focus, hover, selected and error states.
- Create/edit/cancel/delete or archive, failed-save and unsaved-change tests using authorised test data.
- Admin/scheduler/viewer/operations-director and branch-boundary coverage.
- Upload, matching and scheduling success/failure/progress checks without unintended side effects.
- Type/build checks and focused regression tests after implementation.
- Baseline comparisons proving SUR BI remains unchanged.

## 10. References

- Supplied enterprise design-system brief, phases 1–4.
- Existing `docs/DESIGN_SYSTEM.md` and earlier `docs/CARE_CAPACITY_DESIGN_AUDIT.md`.
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- WCAG reflow: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- WCAG target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Vercel Web Interface Guidelines, fetched for this review: https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

WCAG 2.2 AA target-size minimum is generally 24×24 CSS pixels with defined exceptions; the brief's 44×44 preference is a stronger usability target where appropriate. Small controls should be evaluated with their spacing and exceptions, not automatically labelled failures.
