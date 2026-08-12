import { Controller, Get } from '@nestjs/common';
import { getControlPlaneVersion } from '../common/build-info';

// Deliberately unguarded - the control-plane version isn't sensitive, and
// the frontend's global version badge (and the infra page's agent-version
// comparison) both need to read it without requiring a session, so there's
// one single source of truth instead of two independently-computed values
// that can drift.
@Controller('system')
export class SystemController {
  @Get('version')
  version() {
    return { version: getControlPlaneVersion() };
  }
}
