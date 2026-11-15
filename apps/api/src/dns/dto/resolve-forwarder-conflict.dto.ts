import { IsIn, IsOptional } from 'class-validator';

export const FORWARDER_CONFLICT_ACTIONS = ['hosts', 'stop_service', 'local'] as const;
export type ForwarderConflictAction = (typeof FORWARDER_CONFLICT_ACTIONS)[number];

export class ResolveForwarderConflictDto {
  // hosts: resolve *.tarmac.local from /etc/hosts and leave port 53 alone;
  // stop_service: stop the service holding the port, then install the
  // local forwarder; local: go back from /etc/hosts to the forwarder.
  @IsOptional()
  @IsIn(FORWARDER_CONFLICT_ACTIONS)
  action?: ForwarderConflictAction;
}
