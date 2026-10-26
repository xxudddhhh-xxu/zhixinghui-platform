import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('overview')
  overview() {
    return this.dashboardService.overview();
  }

  @Get('messages-trend')
  trend(
    @Query('days', new DefaultValuePipe(14), ParseIntPipe) days: number,
  ) {
    return this.dashboardService.messagesTrend(Math.min(Math.max(days, 7), 60));
  }

  @Get('team-docs')
  teamDocs() {
    return this.dashboardService.teamDocs();
  }

  @Get('model-usage')
  modelUsage() {
    return this.dashboardService.modelUsage();
  }

  @Get('top-queries')
  topQueries() {
    return this.dashboardService.topQueries();
  }
}
