// Browser-only fixtures: never authenticates against or writes to the real API.
// Run with the development workflow running: node tests/client/joiner-layout.browser.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";

const baseURL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const branch = { id: "layout-test", name: "Layout Test", displayName: "Layout Test", region: "Scotland" };
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let data = null;
      if (path === "/api/auth/me") data = {
        id: "layout-test", email: "layout@example.invalid", displayName: "Layout Test",
        role: "admin", branches: [branch], legalConsentVersion: "1.0",
      };
      else if (path === "/api/branches") data = [branch];
      else if (["/api/capacity-outlook/joiners", "/api/capacity-outlook/leavers", "/api/capacity-outlook/availability-changes", "/api/history"].includes(path)) data = [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto(`${baseURL}/app/capacity-outlook`);
    const cookie = page.getByRole("button", { name: "Necessary only" });
    if (await cookie.isVisible()) await cookie.click();
    await page.getByRole("button", { name: "Joiner", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add Joiner", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.waitForTimeout(400);
    const desiredHours = dialog.getByRole("spinbutton", { name: "Desired hours per week" });
    assert.equal(await desiredHours.inputValue(), "", "New joiners must start with an empty hours input, not Bank");
    const inputBox = await desiredHours.boundingBox();
    assert(inputBox && inputBox.width >= 180, "Desired hours input must be wide enough to read");
    await desiredHours.fill("25");
    assert.equal(await desiredHours.inputValue(), "25");
    await dialog.getByRole("button", { name: "Bank", exact: true }).click();
    assert.equal(await desiredHours.count(), 0, "Bank is an explicit choice");
    await dialog.getByRole("button", { name: "Bank click to enter hours" }).click();
    assert.equal(await desiredHours.inputValue(), "", "Returning from Bank restores the empty input");
    await desiredHours.fill("25");
    const dimensions = await dialog.evaluate(el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    assert(dimensions.left >= -1 && dimensions.right <= viewport.width + 1, JSON.stringify(dimensions));
    assert(dimensions.scrollWidth <= dimensions.clientWidth + 1, `Dialog overflows: ${JSON.stringify(dimensions)}`);
    if (viewport.width >= 1280) assert(dimensions.width >= 1000, "Desktop dialog still wastes available width");
    const save = dialog.getByRole("button", { name: "Add Joiner", exact: true });
    const saveBox = await save.boundingBox();
    assert(saveBox && saveBox.y >= 0 && saveBox.y + saveBox.height <= viewport.height, "Save action must stay visible");
    const timetable = dialog.locator(".availability-desktop");
    if (viewport.width >= 1280) {
      assert(await timetable.isVisible(), "Desktop must show the entire week");
      const lastSlot = await timetable.getByRole("button", { name: "Sunday 20:30–21:30", exact: true }).boundingBox();
      assert(lastSlot && lastSlot.y + lastSlot.height < saveBox.y, "All desktop time slots must be visible above the footer");
    } else {
      const availability = dialog.locator(".joiner-availability");
      await availability.evaluate(el => el.scrollIntoView({ block: "start" }));
      assert(await dialog.locator(".availability-mobile").isVisible(), "Phone must use the compact day selector");
    }
    assert.deepEqual(errors, [], "No runtime errors");
    await page.screenshot({ path: `/tmp/joiner-layout-${viewport.width}.jpg`, fullPage: true });
    console.log(`PASS ${viewport.width}x${viewport.height}: dialog width ${dimensions.width}, no horizontal overflow, save visible`);
    await page.close();
  }
} finally {
  await browser.close();
}
