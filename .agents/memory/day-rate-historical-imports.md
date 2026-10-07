---
name: Historical Day Rate imports
description: Preserve current franchise metadata and account for database precision when verifying historical spreadsheets.
---

Historical workbook imports should reuse existing franchises even when Live-In Care capitalisation differs, and preserve current franchise grouping and display order.

**Why:** Older sheets describe historical groupings; importing them must not replace the current operational structure or create duplicate franchises.

**How to apply:** Select requested data sheets explicitly, match normalized workbook names against normalized database names, and update entries rather than current franchise metadata.

Glasgow North Kirkintilloch is no longer part of the group. Keep its historical figures only in reporting months with records; do not expect it in current missing-franchise checks or schedule future automated exports.

**Why:** The user explicitly confirmed the franchise is no longer with the group and requested historical retention without ongoing missing-franchise errors.

**How to apply:** Treat historical reference membership separately from active operational membership. Do not delete its historical records or reactivate it when importing older spreadsheets.

For source-to-database verification, account for PostgreSQL REAL storage and session float-output settings. Excel formula objects can lack cached results even when their calculated value is zero; derive day rate from revenue and days in month in that case.

**Why:** The existing database connection returned monetary values with reduced significant digits; exact comparisons also failed on uncached zero-valued formulas.

**How to apply:** Set extra_float_digits=3 in the verification session and compare at float32 precision. This verifies existing storage, not exact decimal-pence preservation; investigate precision separately before promising exact monetary fidelity.
