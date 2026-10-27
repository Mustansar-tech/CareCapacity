import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  browser: { isConnected: vi.fn(() => true), on: vi.fn(), newContext: vi.fn() },
}));
vi.mock("playwright", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("../../server/infrastructure/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const suffix of ["", "_1", "_2", "_3", "_4", "_5"]) {
    vi.stubEnv(`ACCESS_EMAIL${suffix}`, "");
    vi.stubEnv(`ACCESS_PASSWORD${suffix}`, "");
  }
  vi.stubEnv("ACCESS_BACKUP_EMAIL", "");
  vi.stubEnv("ACCESS_BACKUP_PASSWORD", "");
  vi.stubEnv("ACCESS_EMAIL", "synthetic-account@example.invalid");
  vi.stubEnv("ACCESS_PASSWORD", "synthetic-test-value");
});
afterEach(() => vi.unstubAllEnvs());

describe("People Planner browser/session isolation", () => {
  it("can launch again after Chromium initially fails", async () => {
    mocks.launch.mockRejectedValueOnce(new Error("Synthetic browser launch failure"))
      .mockResolvedValueOnce(mocks.browser);
    const engine = await import("../../server/features/people-planner/automation-engine");
    await expect(engine.prewarmAllSlots()).rejects.toThrow("Synthetic browser launch failure");
    await expect(engine.prewarmAllSlots()).resolves.toBeUndefined();
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });

  it("warms only one shared browser and never signs in during startup", async () => {
    mocks.launch.mockResolvedValue(mocks.browser);
    const engine = await import("../../server/features/people-planner/automation-engine");
    await Promise.all([engine.prewarmAllSlots(), engine.prewarmAllSlots()]);
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.browser.newContext).not.toHaveBeenCalled();
  });

  it("treats duplicate credential aliases as one account, not two fallbacks", async () => {
    vi.stubEnv("ACCESS_BACKUP_EMAIL", " SYNTHETIC-ACCOUNT@example.invalid ");
    vi.stubEnv("ACCESS_BACKUP_PASSWORD", "synthetic-test-value");
    const engine = await import("../../server/features/people-planner/automation-engine");
    expect(engine.getSlotCount()).toBe(1);
    expect(engine.getAccountLockKey(0)).toMatch(/^[a-f0-9]{64}$/);
    expect(engine.getAccountSlotIndex("ACCESS_BACKUP_EMAIL")).toBe(-1);
  });
});
