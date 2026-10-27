export interface AutomationFailure {
  category: "coordination" | "authentication" | "access" | "download" | "configuration" | "browser" | "unknown";
  summary: string;
  action: string;
}

/**
 * Safe, allowlisted descriptions for email. Never forward raw Playwright errors:
 * they may contain OAuth URLs, form contents or credentials in call logs.
 */
export function describeAutomationFailure(error: string): AutomationFailure {
  if (/automation account lock|already running on account slot/i.test(error)) {
    return { category: "coordination", summary: "The account could not be used exclusively or database coordination was lost.", action: "Check worker/database health. This is not evidence of an incorrect password." };
  }
  if (/login|sign.?in|identity\.accessacloud|re-auth|credentials|password|cloudflare|verifying|captcha/i.test(error)) {
    return { category: "authentication", summary: "Access Workspace sign-in or tenant authentication did not complete.", action: "Check the account's access, sign-in challenge and password. A timeout does not by itself prove the password is wrong." };
  }
  if (/forbidden|access denied|permission|unauthori[sz]ed|403/i.test(error)) {
    return { category: "access", summary: "Access to the requested workspace or report was refused.", action: "Check this account's franchise and report permissions." };
  }
  if (/download|export.*timed out/i.test(error)) {
    return { category: "download", summary: "People Planner did not finish delivering the requested export.", action: "Check People Planner report availability and export service health; credentials may still be valid." };
  }
  if (/select|dropdown|franchise.*not found|template|configuration/i.test(error)) {
    return { category: "configuration", summary: "The expected report option or configuration could not be selected.", action: "Check the report/template/franchise configuration and whether People Planner changed its interface." };
  }
  if (/browser|chromium|target.*closed|ERR_|navigation|timeout/i.test(error)) {
    return { category: "browser", summary: "The browser or connection failed while opening or exporting the report.", action: "Check network and worker resources. This is not evidence of an incorrect password." };
  }
  return { category: "unknown", summary: "The export did not complete; the available error does not identify an account-specific cause.", action: "Use the session reference to inspect the restricted server logs." };
}
