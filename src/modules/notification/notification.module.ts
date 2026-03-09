import { Module, Global } from '@nestjs/common';
import { NotificationService } from './notification.service';

/**
 * Notification Module (Phase 1 — Dummy/Logger)
 *
 * Global module so any service can inject NotificationService
 * without importing NotificationModule explicitly.
 *
 * See NOTIFICATION_SYSTEM_PLAN.md for the full implementation plan.
 */
@Global()
@Module({
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
