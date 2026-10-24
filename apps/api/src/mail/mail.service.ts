import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { TARMAC_MARK_CID, TARMAC_MARK_PNG_BASE64 } from './templates/tarmac-mark';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

// Thin wrapper around a single nodemailer transport pointed at the internal
// SMTP relay. Unconfigured (no SMTP_HOST) is a normal state, not an error:
// every caller checks isConfigured and degrades to "no email" so the rest of
// the API keeps working on a dev box without a relay.
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  // A login without its password counts as unconfigured: the relay
  // (Stalwart) only accepts authenticated submission, so trying anyway would
  // just fail every sweep while alerts pile up.
  get isConfigured(): boolean {
    const user = this.configService.get<string>('SMTP_USER');
    return Boolean(this.configService.get<string>('SMTP_HOST') && (!user || this.configService.get<string>('SMTP_PASSWORD')));
  }

  get from(): string {
    return this.configService.get<string>('SMTP_FROM') || 'Tarmac <tarmac@intraced.fr>';
  }

  // Base URL used for every link inside an email.
  get frontendUrl(): string {
    return this.configService.get<string>('FRONTEND_URL', 'https://tarmac.casterot.com').replace(/\/$/, '');
  }

  async onModuleInit() {
    if (!this.isConfigured) {
      this.logger.warn(
        this.configService.get<string>('SMTP_HOST')
          ? 'SMTP_USER is set without SMTP_PASSWORD - alert emails disabled'
          : 'SMTP is not configured (SMTP_HOST missing) - alert emails disabled',
      );
      return;
    }
    try {
      await this.getTransporter().verify();
      this.logger.log(`SMTP relay reachable at ${this.configService.get('SMTP_HOST')}`);
    } catch (error) {
      // Same stance as AuthentikService: a relay that's down at boot must not
      // keep the API from starting, sends simply fail (and retry) until it's back.
      this.logger.error(`SMTP relay check failed at startup: ${error instanceof Error ? error.message : error}`);
    }
  }

  async send(to: string, mail: RenderedMail): Promise<void> {
    await this.getTransporter().sendMail({
      from: this.from,
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments: [
        {
          filename: 'tarmac.png',
          content: Buffer.from(TARMAC_MARK_PNG_BASE64, 'base64'),
          contentType: 'image/png',
          cid: TARMAC_MARK_CID,
        },
      ],
    });
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const port = Number(this.configService.get<string>('SMTP_PORT') || 25);
    // Docker Compose passes unset variables as empty strings, so '' means
    // "pick from the port" here rather than false.
    const secureSetting = this.configService.get<string>('SMTP_SECURE');
    const user = this.configService.get<string>('SMTP_USER');
    const password = this.configService.get<string>('SMTP_PASSWORD');
    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>('SMTP_HOST'),
      port,
      // Implicit TLS on 465, STARTTLS (when offered) everywhere else.
      secure: secureSetting ? secureSetting === 'true' : port === 465,
      auth: user ? { user, pass: password ?? '' } : undefined,
      // An internal relay commonly presents a certificate from a private CA.
      tls: {
        rejectUnauthorized: this.configService.get<string>('SMTP_TLS_REJECT_UNAUTHORIZED', 'true') !== 'false',
      },
    });
    return this.transporter;
  }
}
