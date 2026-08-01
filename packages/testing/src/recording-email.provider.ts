import { type EmailPort, type OutgoingMail } from "@hh/notifications";

/**
 * EmailPort double that captures outgoing mail so tests can fish
 * verification/reset tokens out of message bodies.
 */
export class RecordingEmailProvider implements EmailPort {
  readonly sent: OutgoingMail[] = [];

  sendMail(mail: OutgoingMail): Promise<void> {
    this.sent.push(mail);
    return Promise.resolve();
  }

  /** Most recent mail sent to an address (case-insensitive). */
  lastTo(address: string): OutgoingMail | undefined {
    const needle = address.toLowerCase();
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const mail = this.sent[i];
      if (mail && mail.to.toLowerCase() === needle) {
        return mail;
      }
    }
    return undefined;
  }

  /** Extract a `token=...` value from the most recent mail to an address. */
  lastTokenFor(address: string): string | undefined {
    const mail = this.lastTo(address);
    const match = mail?.text.match(/token=([A-Za-z0-9_-]+)/);
    return match?.[1];
  }

  clear(): void {
    this.sent.length = 0;
  }
}
