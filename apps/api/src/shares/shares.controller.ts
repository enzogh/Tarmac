import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateShareDto } from './dto/create-share.dto';
import { UpdateShareClientDto } from './dto/update-share-client.dto';
import { UpdateShareDto } from './dto/update-share.dto';
import { UpsertShareClientDto } from './dto/upsert-share-client.dto';
import { SharesService } from './shares.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('shares')
export class SharesController {
  constructor(private readonly sharesService: SharesService) {}

  @Get()
  list() {
    return this.sharesService.list();
  }

  @Post()
  create(@Body() dto: CreateShareDto, @Req() req: AuthenticatedRequest) {
    return this.sharesService.create(dto, req.user?.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateShareDto, @Req() req: AuthenticatedRequest) {
    return this.sharesService.update(id, dto, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.sharesService.delete(id, req.user?.userId);
  }

  @Get(':id/clients')
  listClients(@Param('id') id: string) {
    return this.sharesService.listClients(id);
  }

  @Post(':id/clients')
  addClient(
    @Param('id') id: string,
    @Body() dto: UpsertShareClientDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sharesService.upsertClient(id, dto.clientId, dto.access, req.user?.userId);
  }

  @Patch(':id/clients/:clientId')
  updateClient(
    @Param('id') id: string,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateShareClientDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sharesService.upsertClient(id, clientId, dto.access, req.user?.userId);
  }

  @Delete(':id/clients/:clientId')
  removeClient(
    @Param('id') id: string,
    @Param('clientId') clientId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sharesService.removeClient(id, clientId, req.user?.userId);
  }
}
