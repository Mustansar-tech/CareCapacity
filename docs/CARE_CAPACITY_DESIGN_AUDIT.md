# Care Capacity — design audit

Date: 26 October 2026. Status: initial source-based audit and proposed direction, not a production certification.

## Scope and evidence

Preserve existing routes, workflows, business rules, data and roles. SUR Group BI, Data House, scoreboards and Day Rate Tracker are excluded, including legacy routes into those modules. No live application styles or functionality were changed during this audit.

Reviewed the uploaded *Vibe Coding Blueprint*, especially pages 9–11 (design system), 20–21 (conventions) and 23–27 (verification and agent instructions). Its recommendation is shared context plus validation, not a mandate to replace an existing stack. Its first page explicitly says this edition contains eight core templates, not the full advertised advanced template set.

Inspected the route map, root CSS, Tailwind theme, input/button/dialog primitives, and representative source in Dashboard, Capacity Outlook, Workforce and BD Matrix. Earlier user screenshots and browser-fixture checks establish real joiner-form layout problems and the subsequent fixes. The current audit does not constitute authenticated visual verification of every screen, role, data state, device or production deployment. Scheduling and People Planner need dedicated interaction passes; source searches alone cannot certify them.

## Executive finding

Do not rebuild the product. Standardise its foundations and reusable patterns. The app already uses React, Tailwind, shadcn/Radix primitives, semantic colour variables, a shared font stack and reusable controls. The main gap is consistent adoption and verification, not the absence of a UI library.

## Prioritised findings

### High — inconsistent token syntax produces invalid CSS
- `client/src/index.css:20` and `:57`: tokens hold complete CSS colours, such as `hsl(...)`.
- `tailwind.config.ts`: colours correctly reference `var(--...)` directly.
- `client/src/components/joiner-availability.css:18–19`: border colours instead use `hsl(var(--border))`.
- `client/src/pages/capacity-outlook.tsx:1435`: inline background gradient also wraps a complete background colour in `hsl()`.
- Impact: declarations can be rejected, so intended separators/backgrounds disappear or fall back to unrelated styling.
- Recommendation: keep the current full-colour token convention; consume via `var(...)`. Add a static rule for invalid nested colour use. Fix Care Capacity usages only, not a global search-and-replace.

### High — input boundaries are nearly indistinguishable
- `client/src/components/ui/input.tsx:11`: `border-input` with `bg-background`.
- `client/src/index.css:20,59`: background is `hsl(220 20% 97%)`; input-border token is `hsl(220 20% 98%)`.
- These values are almost the same. Recent user screenshots support the visibility concern. This is not a measured whole-app contrast certification.
- Recommendation: separate input surface and control-border tokens; verify 3:1 contrast for boundaries needed to identify controls. Preserve a clearly visible focus state.

### High — form sizing has been solved locally rather than as a reusable policy
- `client/src/components/ui/dialog.tsx:41`: base dialog defaults to `max-w-lg`.
- Joiner now has a separate wide-dialog CSS implementation; leaver and availability-change forms still use their own sizing conventions.
- Recent resolved defects: clipped timetable, narrow desired-hours input, implicit Bank default. Keep those fixes and turn the successful patterns into reusable variants.
- Recommendation: small confirmation, standard form and wide workspace dialog variants; one vertical scroll owner; persistent accessible actions. No horizontal scrolling for ordinary forms.

### High — discoverability and keyboard parity for availability details
- `client/src/pages/capacity-outlook.tsx:1784,1899,1979`: availability popup is exposed through double-click on candidate table cells.
- Recommendation: an explicit “View availability” button/link, usable by keyboard and touch, available to appropriate read-only users. Double-click can remain a shortcut, never the only route.
- `client/src/pages/capacity-outlook.tsx:1852–1856` vicinity: compact icon edit/delete actions require an accessible-name check; visible icons alone do not name an action.

### Medium — multiple competing colour and control systems
- `client/src/components/ui/button.tsx`: existing semantic button variants.
- `client/src/pages/capacity-outlook.tsx:595–650` vicinity: inline Bank control colours and dimensions bypass variants.
- Joiner/leaver actions also use explicit emerald/red classes rather than shared semantic action variants.
- Recommendation: agreed variants for primary, secondary, quiet and destructive actions. Distinguish a red business status from an irreversible destructive action. No new per-screen hex colours.

### Medium — density is inconsistent
- `client/src/pages/dashboard.tsx:278,305,332,334`: upload labels use 11px text and an indicator uses 9px.
- `client/src/pages/capacity-outlook.tsx:1831` vicinity: milestones use 10px text.
- `client/src/pages/workforce.tsx:270,290`: indicators use 9px text; availability cells need a dense-grid readability and keyboard review.
- Recommendation: 14px body/data, 12px secondary labels, 16px mobile entry fields; smaller text only for genuinely supplementary content after readability testing. Density should be an explicit standard/compact variant, not arbitrary shrinking.

### Medium — cross-screen identity diverges without a documented meaning
- `client/src/pages/bd-matrix.tsx:162–163`: heading/icon colour is the literal purple `#5d51d5`, outside the common primary action token.
- Recommendation: preserve any genuinely meaningful module identity, but document it as a semantic module accent rather than introducing unrelated per-page colours.

### Medium — nested scrolling needs a screen-by-screen policy
- `client/src/pages/dashboard.tsx:210,410`: outer content and a tab body both declare vertical scrolling.
- Recommendation: verify at short laptop heights and 200%/400% zoom. Prefer a single content scroll owner. Maps and genuine two-dimensional data grids may need contained scrolling; ordinary inputs must not.
- Nested scroll declarations indicate a review risk, not proof of failure in every rendered state.

### High rollout risk — shared styling can affect SUR BI
- `client/src/App.tsx:445–447,492–505`: legacy Day Rate route and dedicated BI routes coexist in the same application.
- Root tokens and shared primitives are not automatically isolated by route.
- Recommendation: scope new tokens/patterns to a Care Capacity theme boundary; account for Radix portals outside that boundary. Leave root/global primitives unchanged until consumer coverage and BI baseline comparisons prove no change.

## Coverage and remaining verification

| Area | This pass | Required before rollout |
|---|---|---|
| Tokens and primitives | Source evidence | Computed styles, contrast and component states |
| Dashboard | Representative source | Real populated/empty/error layouts and uploads |
| Capacity Outlook | Source + earlier user screenshots/fixture checks | Real save/edit/archive flows, keyboard-only and role coverage |
| Workforce / BD Matrix | Source sampling | Maps, long names, dense rows, matching progress and failures |
| Scheduling / People Planner | Route inventory and source search | End-to-end interaction and long-running job states |
| Login / admin / documentation | Shared dependency inventory | Keyboard, permissions and consistent patterns |
| SUR BI | Excluded from redesign | Baseline regression checks only |

No security scan, production database audit, load test, screen-reader conformance audit or exhaustive live-session review was performed. Those are separate production-readiness gates. A design system alone cannot establish production readiness.

## Safe adoption sequence

1. Capture real baseline screenshots and journeys, including BI regression-only baselines. Use synthetic or redacted data in design artefacts.
2. Approve the draft design system. Establish Care Capacity-only theme scoping, including portals.
3. Build reusable fields, buttons, status badges, toolbars, dialog variants and states. Pilot joiner/leaver forms without changing calculations.
4. Adopt on Dashboard and Capacity Outlook; then Workforce/BD Matrix; then Scheduling/People Planner. One module at a time.
5. Release only after role, keyboard, responsive, loading/error/empty, data-persistence and BI non-regression checks pass.

## External references consulted

- NHS design system: https://service-manual.nhs.uk/design-system — researched, reusable styles/components/patterns. Borrow interaction principles, not NHS branding.
- WCAG 2.2 reflow: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html — 320 CSS-pixel reflow; genuine two-dimensional content has exceptions.
- WCAG 2.2 target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html — 24×24 CSS-pixel minimum with specified exceptions. Prefer larger touch controls.
- DTCG token format 2025.10: https://www.designtokens.org/tr/2025.10/format/ — portable named tokens and aliases; a Community Group specification, not a W3C Recommendation.
- Vercel Web Interface Guidelines: https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md — practical source-review checklist, subordinate to WCAG and product requirements.
