// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

describe("audit branch scope", () => {
  const fetchMock = vi.fn();
  let sidebarBranch: string | null;
  beforeEach(() => {
    sidebarBranch = "sidebar-branch";
    vi.stubGlobal("localStorage", { getItem: () => sidebarBranch });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset().mockImplementation(async () => new Response('{"events":[],"total":0}', { status: 200 }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const requestedUrl = () => new URL(fetchMock.mock.calls.at(-1)![0], "https://example.test");
  const auditOptions = { includeSelectedBranch: false };

  it.each(["/api/admin/audit-events", "/api/admin/audit-events/export"])(
    "%s: all branches ignores the sidebar and preserves other filters",
    async endpoint => {
      for (const selected of ["sidebar-branch", "another-sidebar-branch"]) {
        sidebarBranch = selected;
        await apiRequest("GET", `${endpoint}?page=2&action=LOGIN&search=example&from=2026-10-01&to=2026-10-09`, undefined, auditOptions);
        expect(requestedUrl().searchParams.has("branchId")).toBe(false);
        expect(requestedUrl().searchParams.get("page")).toBe("2");
        expect(requestedUrl().searchParams.get("action")).toBe("LOGIN");
        expect(requestedUrl().searchParams.get("search")).toBe("example");
        expect(requestedUrl().searchParams.get("from")).toBe("2026-10-01");
        expect(requestedUrl().searchParams.get("to")).toBe("2026-10-09");
        expect(fetchMock.mock.calls.at(-1)![1].credentials).toBe("include");
      }
    },
  );

  it.each(["/api/admin/audit-events", "/api/admin/audit-events/export"])(
    "%s: a specific audit branch is sent exactly once",
    async endpoint => {
      await apiRequest("GET", `${endpoint}?branchId=audit-filter-branch`, undefined, auditOptions);
      expect(requestedUrl().searchParams.getAll("branchId")).toEqual(["audit-filter-branch"]);
    },
  );

  it("keeps normal GET requests scoped to the sidebar", async () => {
    await apiRequest("GET", "/api/weekly-schedule?weekStart=2026-10-05");
    expect(requestedUrl().searchParams.get("branchId")).toBe("sidebar-branch");
  });

  it("keeps normal POST requests scoped to the sidebar", async () => {
    await apiRequest("POST", "/api/weekly-schedule/save", { weekStartDate: "2026-10-05" });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual({
      weekStartDate: "2026-10-05", branchId: "sidebar-branch",
    });
  });

  it("keeps default query functions scoped to the sidebar", async () => {
    const query = getQueryFn({ on401: "throw" });
    await query({ queryKey: ["/api/weekly-schedule"], signal: new AbortController().signal } as Parameters<typeof query>[0]);
    expect(requestedUrl().searchParams.get("branchId")).toBe("sidebar-branch");
  });

  it("preserves authentication failures for audit requests", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Authentication required", { status: 401 }));
    await expect(apiRequest("GET", "/api/admin/audit-events", undefined, auditOptions)).rejects.toThrow("401");
  });
});
