import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const DEFAULT_API_URL = 'https://api.zeptomail.in/v1.1/email';

// Uses ZeptoMail's HTTPS API (port 443) rather than SMTP — Railway blocks
// outbound SMTP on both 587 and 465, which silently timed out every send.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly fromAddress: string;

  constructor(config: ConfigService) {
    this.apiUrl = config.get<string>('ZEPTOMAIL_API_URL', DEFAULT_API_URL);
    this.apiToken = config.getOrThrow<string>('ZEPTOMAIL_API_TOKEN');
    this.fromAddress = config.getOrThrow<string>('ZEPTOMAIL_FROM_ADDRESS');
  }

  /**
   * Never throws — a notification email failing to send must not fail the
   * business operation (e.g. user creation) that triggered it.
   */
  async send(input: SendMailInput): Promise<void> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: this.apiToken,
        },
        body: JSON.stringify({
          from: { address: this.fromAddress },
          to: [{ email_address: { address: input.to } }],
          subject: input.subject,
          htmlbody: input.html,
          ...(input.text ? { textbody: input.text } : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`ZeptoMail API responded ${response.status}: ${body}`);
      }

      this.logger.log(`Sent mail to ${input.to}: ${input.subject}`);
    } catch (err) {
      this.logger.error(`Failed to send mail to ${input.to}: ${(err as Error).message}`);
    }
  }
}
