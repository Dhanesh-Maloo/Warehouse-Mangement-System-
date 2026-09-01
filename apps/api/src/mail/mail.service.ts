import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly fromAddress: string;

  constructor(config: ConfigService) {
    this.fromAddress = config.getOrThrow<string>('ZEPTOMAIL_FROM_ADDRESS');

    this.transporter = nodemailer.createTransport({
      host: config.getOrThrow<string>('ZEPTOMAIL_SMTP_HOST'),
      port: config.get<number>('ZEPTOMAIL_SMTP_PORT', 587),
      secure: config.get<number>('ZEPTOMAIL_SMTP_PORT', 587) === 465,
      auth: {
        user: config.getOrThrow<string>('ZEPTOMAIL_SMTP_USERNAME'),
        pass: config.getOrThrow<string>('ZEPTOMAIL_SMTP_PASSWORD'),
      },
    });
  }

  /**
   * Never throws — a notification email failing to send must not fail the
   * business operation (e.g. user creation) that triggered it.
   */
  async send(input: SendMailInput): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
    } catch (err) {
      this.logger.error(`Failed to send mail to ${input.to}: ${(err as Error).message}`);
    }
  }
}
