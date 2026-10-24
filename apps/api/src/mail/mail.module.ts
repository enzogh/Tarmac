import { Global, Module } from '@nestjs/common';
import { AlertDigestService } from './alert-digest.service';
import { MailService } from './mail.service';

// Global so auth (address confirmation) and notification channels (test
// sends) can inject MailService without each importing this module.
@Global()
@Module({
  providers: [MailService, AlertDigestService],
  exports: [MailService],
})
export class MailModule {}
