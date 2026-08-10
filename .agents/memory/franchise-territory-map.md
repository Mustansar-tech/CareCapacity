---
name: Franchise territory map approach
description: How cross-franchise map territory borders were approximated and how multi-branch access control works, for anyone extending the Workforce & Client Map.
---

- No exact postcode-level franchise boundary data exists for Home Instead SUR Group's Scottish franchises. Territory polygons were approximated from free ONS Open Geography Portal council-area (Local Authority District) boundaries, unioning/clipping council polygons per franchise where a franchise spans multiple or partial councils (e.g. Glasgow North/South split via a latitude cut; West Fife/Kinross via a longitude clip of the Fife polygon). Treat these as best-guess visuals, not authoritative boundaries.
- Real franchise/territory display names differ from the shorter internal branch `displayName` used elsewhere in the app (e.g. "Ayr" vs "South Ayrshire and Kilmarnock"). Keep this real-name mapping scoped to map/territory UI only — don't overwrite `branches.displayName`, which other views depend on.
- For any new cross-branch (multi-franchise) endpoint, mirror the single-branch `resolveBranch` access-control pattern: admins bypass, non-admins are restricted to `getUserBranches(userId)`, and requested branch IDs outside that set should be silently filtered rather than erroring (since "all franchises" is a valid request for a partial-access user).
