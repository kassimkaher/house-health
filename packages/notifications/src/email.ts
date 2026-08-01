/** Injection token for the EmailPort implementation. */
export const EMAIL_PORT = "EMAIL_PORT";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Outbound-email port; real SMTP/provider adapters arrive in a later phase. */
export interface EmailPort {
  sendMail(mail: OutgoingMail): Promise<void>;
}

/**
 * Development provider: prints mail to stderr (console.warn) with a loud
 * banner so verification/reset URLs are easy to grab from dev logs.
 */
export class LogEmailProvider implements EmailPort {
  sendMail(mail: OutgoingMail): Promise<void> {
    console.warn(
      [
        "=== DEV EMAIL ===",
        `To:      ${mail.to}`,
        `Subject: ${mail.subject}`,
        "",
        mail.text,
        "=== END DEV EMAIL ===",
      ].join("\n"),
    );
    return Promise.resolve();
  }
}
