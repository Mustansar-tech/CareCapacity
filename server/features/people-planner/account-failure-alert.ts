import { Resend } from "resend";
import { logger } from "../../infrastructure/logger";

/** No credentials, raw login URLs, or downloaded care data are included. */
export async function sendAccountFailureAlert(details: {
  sessionId: string;
  branchName: string;
  accountKey: string;
  reportType: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const recipient = process.env.ACCESS_BACKUP_EMAIL;
  if (!key || !recipient) {
    logger.error("PP account-failure email could not be sent: email configuration missing", undefined, {
      sessionId: details.sessionId,
    });
    return;
  }
  try {
    const { error } = await new Resend(key).emails.send({
      from: "Care Capacity <noreply@mail.sur-group.co.uk>",
      to: recipient,
      subject: `Care Capacity: ${details.branchName} automation account failed`,
      text: [
        `Branch: ${details.branchName}`,
        `Failed account: ${details.accountKey}`,
        `Report: ${details.reportType}`,
        `Session: ${details.sessionId}`,
        "This account will not be retried in this session.",
        "Automation will try the remaining available global accounts (ACCESS_EMAIL and ACCESS_BACKUP_EMAIL), once each. If none remain, it will stop.",
        "Please check the account's credentials and Access Workspace access.",
      ].join("\n"),
    });
    if (error) throw new Error(error.message);
    logger.info("PP account-failure alert sent", { sessionId: details.sessionId, accountKey: details.accountKey });
  } catch (err) {
    logger.error("PP account-failure alert delivery failed", err instanceof Error ? err : undefined, {
      sessionId: details.sessionId,
      accountKey: details.accountKey,
    });
  }
}
