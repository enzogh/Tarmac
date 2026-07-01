import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorageService } from './storage.service';

@UseGuards(JwtAuthGuard)
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get('forecast')
  forecast(@Query('nodeId') nodeId?: string) {
    return this.storageService.forecast(nodeId);
  }

  @Get('overview')
  overview(@Query('nodeId') nodeId?: string) {
    return this.storageService.overview(nodeId);
  }
}
