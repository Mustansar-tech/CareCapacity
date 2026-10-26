# Care Capacity design system — proposed v1

Status: draft for review, not applied to the live app. Read alongside CARE_CAPACITY_DESIGN_AUDIT.md.

## Product identity and scope
An operational staffing workspace for Home Instead branch teams. Familiar, clear, information-rich and reliable. Preserve the current brand assets, navigation, terminology, reports, data and workflows. Improve consistency rather than introduce a new visual identity.

SUR Group BI, Day Rate Tracker, Data House and scoreboards are excluded. Do not change global tokens/components in a way that restyles those modules. Keep business logic and visual refactoring in separate changes.

## Principles
1. Explain information, not decoration: label units, status, branch, period and provenance.
2. Reuse before inventing: named tokens → primitives → domain patterns → screens.
3. Size for the task: a timetable is a workspace, not a narrow confirmation dialog.
4. Separate user intent from system advice: desired hours, availability, calculated recommendation and agreed contract remain distinct.
5. Accessible defaults: keyboard access, visible focus, readable labels, explicit actions and recovery.

## Foundations
Retain Inter/system fallback. Retain the existing blue primary family, light neutral surfaces and existing Home Instead assets; no new logo is proposed.

Proposed semantic palette for validation (not approved brand replacements):

| Token | Light value | Purpose |
|---|---|---|
| action.primary | #005FCC | Primary action / selected interaction |
| action.primary.text | #FFFFFF | Text on primary |
| surface.page | #F6F7F9 | Page background |
| surface.panel | #FFFFFF | Panels, fields, dialogs |
| text.primary | #172033 | Main content |
| text.secondary | #526176 | Supporting text |
| border.subtle | #D8DEE8 | Nonessential dividers |
| border.control | #7A8799 | Essential control boundaries; verify adjacent-colour contrast |
| status.success | #166534 | Positive status text/icon |
| status.warning | #92400E | Attention required text/icon |
| status.error | #B91C1C | Errors/destructive action |
| focus.ring | #005FCC | Keyboard focus outline |

Never use status colour alone; include text or an icon with an accessible name. Do not apply warning/success foreground colours as arbitrary background fills. Define and test paired backgrounds separately. Proposed light palette is not approval to break/remove existing dark mode; dark tokens and all interaction states need a separate contrast pass.

- Type: page title 24/32px semibold; section title 18/26px semibold; body and table data 14/20px; secondary 12/18px. Mobile text entry at least 16px.
- Spacing: 4, 8, 12, 16, 24, 32, 48px. Use named aliases; do not mix arbitrary pixel values across screens.
- Radius: controls 8px; panels/dialogs 12px; pills only for badges/toggles. Preserve brand familiarity.
- Elevation: borders for ordinary panels; restrained shadow for overlays. No glows or gradients for routine data containers.
- Icons: existing Lucide library, typically 16–20px; decorative icons hidden from assistive technology.
- Motion: short feedback transitions only; honour reduced motion. Never make animation essential to understanding job progress.

## Shared components and contracts

| Pattern | Required behaviour |
|---|---|
| Button | Primary/secondary/quiet/destructive; default/loading/disabled/focus states; one clear primary action per action group |
| FormField | Label, optional hint, input, inline error; required marker in same label; accessible association |
| HoursField | Explicit empty state, numeric value and separate Bank action; never infer an untouched blank field as Bank |
| StatusBadge | Label plus semantic colour; distinguish business status from action styling |
| PageHeader | Title, contextual description, branch/period context, consistent action placement |
| FilterBar | Labelled filters, clear/reset, result count; preserve appropriate state without leaking across branches |
| DataTable | Real headers, labelled row actions, sort state, long-name handling and number alignment |
| AsyncState | Distinct loading, empty, error, stale and success states; error includes retry/recovery |
| JobProgress | Real progress/cancellation where supported; never fabricate completion or estimates |
| Dialog | Confirmation / standard form / wide workspace variants; title and description; focus management |

Controls should generally be 40px high, with 44px touch targets where practical; compact controls must still meet WCAG target-size requirements or a documented exception. Input borders must remain visible when unfocused. Explicitly label icon-only buttons.

## Layout and responsive rules
- Standard forms: approximately 480–640px, based on content. Wide workspaces: use available width up to roughly 1440px.
- Candidate details and timetable alongside each other when enough room; single-column form and selected-day timetable on narrow screens.
- Keep save/cancel reachable; one vertical scrolling content area per dialog, header/footer outside it. Check focused controls are not obscured.
- No sideways scrolling on ordinary forms. Tables/maps may use contained scrolling only when their meaning requires a two-dimensional layout, with clear navigation and keyboard access.
- Use container size for embedded widgets, not viewport assumptions alone.
- Test 320, 390, 768, 1024, 1280 and 1440 CSS-pixel widths, short laptop heights, 200% zoom and 400% reflow. This is a test matrix, not a mandatory set of CSS breakpoints.

## Forms, tables and language
- Preserve existing saved records. New joiners start with blank desired hours and all availability unticked; Bank is explicit.
- Driver/walker and contract formulas are domain logic, not design tokens. Do not change them during a style migration.
- Error messages explain the correction. Focus the first invalid input. Do not clear values after a failed save.
- Confirm destructive operations; distinguish delete, archive and failed action.
- Replace double-click-only detail discovery with a visible button/link; retain shortcuts as optional enhancements.
- Use British English, explicit units and consistent dates. Store date-only values separately from display formatting.
- Keep exact business-required precision; do not round hours or money as a cosmetic simplification.
- UI samples must use invented people and branches; no live care notes, employee details or client information in public design guides.

## Implementation architecture
Keep the current React/Tailwind/shadcn/Radix stack. Do not introduce a second UI library.

Proposed layers:
1. Versioned portable token definitions (DTCG-compatible format where useful).
2. Generated or centrally maintained Care Capacity CSS variables and semantic Tailwind aliases.
3. Reusable accessible primitives and documented variants.
4. Domain patterns: hours entry, branch/period toolbar, status summaries, availability editor.
5. Screens composing those patterns rather than overriding them.

Care Capacity theme boundary must also cover dialog/popover portals. Do not assume nesting the page scopes elements portalled to document.body. BI gets no new theme by default. Shared primitives should use opt-in variants until isolation is demonstrated.

## Governance
- The code component examples and this document must agree. A Canva board may reference the system; it is not the runtime source of truth.
- New patterns require a real repeated use case, state inventory, responsive example and accessibility check.
- Avoid per-screen hex colours and duplicate control implementations; document exceptions with owner/reason.
- Keep a component catalogue outside production navigation unless explicitly approved. Show states, content extremes, keyboard use and dark mode—not just attractive happy paths.
- Changes to a shared component require consumer review and screenshot comparisons. Deprecate variants gradually rather than bulk replacing the app.

## Release gate
Type-check/build; focused unit tests; create/edit/cancel/error flows; branch and role boundaries; keyboard-only navigation; visible focus; 4.5:1 normal text contrast, 3:1 large text and required non-text contrast; target-size and reflow checks; no clipped inputs; no new runtime errors; BI baseline unchanged.

These are acceptance criteria, not a claim that the present app already meets all of them. Production security, privacy, backups, monitoring and performance need separate evidence.

## Blueprint adoption
Use the supplied blueprint as a maintenance checklist, not eight new duplicate documents. Start with this design-system spec and the audit. Link existing project/security/privacy documentation where accurate; reconcile stale documentation against current code before treating it as authoritative. Add a focused UI verification checklist and discoverable agent instructions during implementation.
