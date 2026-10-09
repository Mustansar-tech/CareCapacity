---
name: Portable npm lockfiles
description: Prevent internal package-registry download URLs from breaking external GitHub installs.
---

Keep committed npm lockfiles portable to the project's external GitHub deployment workflow.

**Why:** A managed dependency installation added package download URLs on `package-firewall.replit.internal`. They worked inside the workspace but external GitHub runners failed DNS resolution during `npm ci`, before type checking or building.

**How to apply:** After managed package installations, inspect changed lockfile download hosts. For already-allowed public npm packages, use the corresponding public registry tarball URL and verify downloaded bytes against the unchanged integrity hash. Do not change versions or remove integrity checks to fix this host-access problem. Continue using the managed installer in the workspace; this portability rule is not permission to bypass any package security block.
