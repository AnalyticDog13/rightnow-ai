import { randomBytes } from "node:crypto";

/** A hard-bounce DSN (5.1.1) for `rfcMessageId`, as Gmail's mailer-daemon sends it. */
export function dsn(to: string, lead: string, rfcMessageId: string, at: Date) {
  return Buffer.from(
    [
      "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      `To: ${to}`,
      "Subject: Delivery Status Notification (Failure)",
      `Date: ${at.toUTCString()}`,
      `Message-ID: <dsn-${randomBytes(4).toString("hex")}@mx.test>`,
      "MIME-Version: 1.0",
      'Content-Type: multipart/report; report-type=delivery-status; boundary="B1"',
      "",
      "--B1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      `Address not found. Your message wasn't delivered to ${lead}.`,
      "",
      "--B1",
      "Content-Type: message/delivery-status",
      "",
      "Reporting-MTA: dns; mx.test",
      "",
      `Final-Recipient: rfc822; ${lead}`,
      "Action: failed",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist.",
      "",
      "--B1",
      "Content-Type: text/rfc822-headers",
      "",
      `From: ${to}`,
      `To: ${lead}`,
      `Message-ID: ${rfcMessageId}`,
      "",
      "--B1--",
      "",
    ].join("\r\n"),
  );
}
