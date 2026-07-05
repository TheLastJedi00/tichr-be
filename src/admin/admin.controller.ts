import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';

/**
 * Backoffice (SaaS Manager). Todo o controller exige a flag `admin`
 * (via AdminGuard, apos o AuthGuard global resolver o principal).
 */
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  /** Sonda leve: 200 confirma que o usuario e admin (o front usa no guard). */
  @Get('ping')
  ping(): { admin: boolean } {
    return { admin: true };
  }
}
