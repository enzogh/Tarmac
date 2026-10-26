import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { VPN_ACCESS_SCOPES, VPN_TAG, VpnAccessScopeValue } from './create-vpn-profile.dto';

export const VPN_BULK_ACTIONS = [
  'enable',
  'disable',
  'delete',
  'add_tag',
  'remove_tag',
  // Let every selected profile reach `peerIds` (or stop it).
  'add_peers',
  'remove_peers',
  // Same access rule for every selected profile.
  'set_mesh_access',
  'set_peer_access',
] as const;
export type VpnBulkAction = (typeof VPN_BULK_ACTIONS)[number];

// One call, one reconcile: acting on 100 profiles one PATCH at a time would
// push 100 full VPN states to every node.
export class BulkVpnProfilesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  ids!: string[];

  @IsIn(VPN_BULK_ACTIONS)
  action!: VpnBulkAction;

  // Required by add_tag / remove_tag.
  @IsOptional()
  @Matches(VPN_TAG, { message: 'tag must be 1-32 letters, digits, spaces, dots, dashes or underscores' })
  tag?: string;

  // add_peers / remove_peers.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  peerIds?: string[];

  // set_mesh_access (+ meshNodeIds when "selected") / set_peer_access
  // ("all" or "none"; a selection goes through add_peers).
  @IsOptional()
  @IsIn(VPN_ACCESS_SCOPES)
  scope?: VpnAccessScopeValue;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  meshNodeIds?: string[];
}
