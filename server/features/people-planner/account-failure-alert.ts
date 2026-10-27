import { Resend } from "resend";
import { logger } from "../../infrastructure/logger";
import type { AutomationFailure } from "./automation-failure";

async function sendAlert(subject: string, text: string, sessionId: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const recipient = process.env.ACCESS_BACKUP_EMAIL;
  if (!key || !recipient) {
    logger.error("PP automation email configuration missing", undefined, { sessionId });
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      new Resend(key).emails.send({
        from: "Care Capacity <noreply@mail.sur-group.co.uk>", to: recipient, subject, text,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Email delivery timeout")), 5000);
      }),
    ]);
    if (result.error) throw new Error(result.error.message);
    logger.info("PP automation notification sent", { sessionId });
  } catch {
    // A mail outage must never stall failover or leak provider response contents.
    logger.error("PP automation notification could not be delivered", undefined, { sessionId });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** No credentials, raw login URLs, or downloaded care data are included. */
export async function sendAccountFailureAlert(details: {
  sessionId: string;
  branchName: string;
  accountKey: string;
  reportType: string;
  failure: AutomationFailure;
}): Promise<void> {
  await sendAlert(
    `Automation: ${details.branchName} export attempt failed — checking backups`,
    [
        `Branch: ${details.branchName}`,
        `Failed account: ${details.accountKey}`,
        `Report: ${details.reportType}`,
        `Session: ${details.sessionId}`,
         `Failure category: ${details.failure.category}`,
         `Reason: ${details.failure.summary}`,
         "This is an attempt-level warning, NOT the final result of the automation.",
        "This account will not be retried in this session.",
        "Automation will try the remaining available global accounts (ACCESS_EMAIL and ACCESS_BACKUP_EMAIL), once each. If none remain, it will stop.",
         "A separate final outcome message will report whether this branch recovered.",
         `If action is needed: ${details.failure.action}`,
    ].join("\n"),
    details.sessionId,
  );
}

export async function sendAutomationOutcomeAlert(details: {
  sessionId: string;
  branchName: string;
  automation: "Care Capacity" | "BI Financial Summary";
  status: "completed" | "partial" | "failed";
  completed: number;
  failed: number;
  accountKey: string;
  failedAccounts: number;
}): Promise<void> {
  const outcome = details.status === "completed" ? "RECOVERED" : details.status === "partial" ? "PARTIALLY COMPLETED" : "FAILED";
  await sendAlert(
    `${details.automation}: ${details.branchName} — ${outcome}`,
    [
      `Branch: ${details.branchName}`,
      `Automation: ${details.automation}`,
      `Final outcome: ${outcome}`,
      `Completed items: ${details.completed}`,
      `Failed items: ${details.failed}`,
      `Last selected account: ${details.accountKey}`,
      `Accounts that failed: ${details.failedAccounts}`,
      `Session: ${details.sessionId}`,
      details.status === "completed"
        ? "The backup completed this branch's work. The earlier attempt warning does not mean the final run failed."
        : "Not all requested data was refreshed. Check the failed items; existing data must not be treated as newly synced.",
      "No failed account was repeatedly retried in this session.",
    ].join("\n"),
    details.sessionId,
  );
}
