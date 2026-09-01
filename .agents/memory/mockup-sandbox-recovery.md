---
name: Mockup sandbox recovery
description: Workspace-specific recovery guidance when the default mockup sandbox is only partially provisioned.
---

A pre-existing mockup sandbox directory can be present without a registered artifact or runnable workflow. In that state, reusing the default slug may fail because the directory already exists, and the generated workflow may initially lack installed dependencies.

**Why:** Preserving the partial directory avoids destructive cleanup and keeps unrelated mockup work safe, while a fresh artifact gives the visual task an isolated, independently restartable preview.

**How to apply:** Check whether the sandbox has its package files and workflow before using it. If it is only partially provisioned, create a fresh mockup artifact with a distinct slug, install that artifact's declared dependencies, then restart its generated preview workflow before adding components.