import { IsString, MaxLength } from 'class-validator';

export class UpdateVpnDnsDto {
  // Suffix of every VPN client's internal name, e.g. intranet.internal.
  // Checked in VpnService (zoneProblem) for a readable message.
  @IsString()
  @MaxLength(200)
  zone!: string;
}
