import { Module } from '@nestjs/common';
import { ShareService } from './share.service';

/**
 * Things that can be sent as a card: the registry and its readers
 * (docs/research/messaging/SHARE_IN_MESSAGES.md). Imports nothing of ours,
 * so messaging now, and posts or the website later, can use it.
 */
@Module({
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
