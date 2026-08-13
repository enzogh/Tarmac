import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DnsDelegationService } from './dns-delegation.service';
import { DnsGroupsService } from './dns-groups.service';
import { DnsRecordsService } from './dns-records.service';
import { DnsZonesService } from './dns-zones.service';
import { CreateDnsGroupDto } from './dto/create-dns-group.dto';
import { CreateDnsZoneDto } from './dto/create-dns-zone.dto';
import { UpdateDnsGroupDto } from './dto/update-dns-group.dto';
import { UpsertDnsGroupMemberDto } from './dto/upsert-dns-group-member.dto';
import { UpsertDnsRecordDto } from './dto/upsert-dns-record.dto';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('dns')
export class DnsController {
  constructor(
    private readonly dnsGroupsService: DnsGroupsService,
    private readonly dnsZonesService: DnsZonesService,
    private readonly dnsRecordsService: DnsRecordsService,
    private readonly dnsDelegationService: DnsDelegationService,
  ) {}

  @Get('groups')
  listGroups(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.dnsGroupsService.listGroups(scope);
  }

  @Post('groups')
  createGroup(
    @Body() dto: CreateDnsGroupDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dnsGroupsService.createGroup(dto, scope, req.user?.userId);
  }

  @Patch('groups/:id')
  updateGroup(
    @Param('id') id: string,
    @Body() dto: UpdateDnsGroupDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dnsGroupsService.updateGroup(id, dto, scope, req.user?.userId);
  }

  @Delete('groups/:id')
  deleteGroup(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.dnsGroupsService.deleteGroup(id, scope, req.user?.userId);
  }

  @Post('groups/:id/members')
  addGroupMember(
    @Param('id') id: string,
    @Body() dto: UpsertDnsGroupMemberDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dnsGroupsService.upsertGroupMember(id, dto, scope, req.user?.userId);
  }

  @Patch('groups/:id/members/:nodeId')
  updateGroupMember(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: Omit<UpsertDnsGroupMemberDto, 'nodeId'>,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dnsGroupsService.upsertGroupMember(
      id,
      { nodeId, role: dto.role, status: dto.status },
      scope,
      req.user?.userId,
    );
  }

  @Delete('groups/:id/members/:nodeId')
  removeGroupMember(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dnsGroupsService.removeGroupMember(id, nodeId, scope, req.user?.userId);
  }

  @Post('groups/:id/members/:nodeId/resolve-port-conflict')
  resolvePortConflict(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dnsGroupsService.resolvePortConflict(id, nodeId, scope, req.user?.userId);
  }

  @Get('zones')
  listZones(@Query('groupId') groupId: string | undefined, @CurrentWorkspace() scope: WorkspaceScope) {
    return this.dnsZonesService.listZones(scope, groupId);
  }

  @Post('zones')
  createZone(
    @Body() dto: CreateDnsZoneDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dnsZonesService.createZone(dto, scope, req.user?.userId);
  }

  @Post('zones/:id/reapply')
  reapplyZone(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.dnsZonesService.reapplyZone(id, scope, req.user?.userId);
  }

  @Delete('zones/:id')
  deleteZone(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.dnsZonesService.deleteZone(id, scope, req.user?.userId);
  }

  @Get('zones/:id/dnssec')
  getDnssecKeys(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope) {
    return this.dnsDelegationService.getDnssecKeys(id, scope);
  }

  @Get('zones/:id/delegation')
  getDelegation(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope) {
    return this.dnsDelegationService.getDelegation(id, scope);
  }

  @Post('zones/:id/records')
  upsertRecord(
    @Param('id') id: string,
    @Body() dto: UpsertDnsRecordDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dnsRecordsService.upsertRecord(id, dto, scope, req.user?.userId);
  }

  @Delete('zones/:id/records/:recordId')
  deleteRecord(
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dnsRecordsService.deleteRecord(id, recordId, scope, req.user?.userId);
  }

  @Get('nodes/:nodeId/records')
  recordsForNode(@Param('nodeId') nodeId: string, @CurrentWorkspace() scope: WorkspaceScope) {
    return this.dnsRecordsService.recordsForNode(nodeId, scope);
  }
}
