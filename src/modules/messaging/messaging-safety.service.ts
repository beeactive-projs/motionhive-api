import type { LoggerService } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import { User, USER_SAFE_ATTRIBUTES } from '../user/entities/user.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { MessagingSuspension } from './entities/messaging-suspension.entity';
import { UserBlock, UserBlockReason } from './entities/user-block.entity';

/**
 * Outcome of a permission check before sending. Wider than a boolean so
 * the caller can distinguish the two semantically different denial
 * shapes:
 *   - 'silentDrop': pretend the send succeeded, do nothing.
 *   - 'forbidden': raise a 403 with a clear reason.
 * The 'allowed' branch is the happy path.
 */
export type CanMessageResult =
  | { kind: 'allowed' }
  | { kind: 'silentDrop'; reason: SilentDropReason }
  | { kind: 'forbidden'; reason: string };

export type SilentDropReason = 'BLOCKED_BY_RECIPIENT';

const NEW_ACCOUNT_HOURS = 48;
const NEW_ACCOUNT_WINDOW_MS = NEW_ACCOUNT_HOURS * 60 * 60 * 1000;

/**
 * MessagingSafetyService — the single seam for *all* permission checks
 * the messaging module performs. Other services (notably
 * MessagingService.sendMessage) consult this and never read the
 * underlying tables directly.
 *
 * Stage 3 implements:
 *   - canMessage(senderId, recipientId)
 *   - assertParticipant(userId, conversationId)  ← delegated from MessagingService
 *   - block / unblock / listBlocks
 *   - isMessagingSuspended
 *
 * Future safety rules (rate-limit decisions, content scanning, etc.)
 * also land here. The principle is: any "can this happen" question for
 * messaging is answered in this file.
 */
@Injectable()
export class MessagingSafetyService {
  constructor(
    @InjectModel(UserBlock)
    private readonly userBlockModel: typeof UserBlock,
    @InjectModel(MessagingSuspension)
    private readonly suspensionModel: typeof MessagingSuspension,
    @InjectModel(ConversationParticipant)
    private readonly participantModel: typeof ConversationParticipant,
    @InjectModel(InstructorClient)
    private readonly instructorClientModel: typeof InstructorClient,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // =========================================================================
  // canMessage gate
  // =========================================================================

  /**
   * Resolve whether `senderId` may send a message to `recipientId`.
   *
   * Order matters. Suspension is checked first (it produces an explicit
   * 403) so a suspended account never silently appears to succeed at
   * sending. Then the block check (silent drop), then the new-account
   * rule (403 — sender's own account is too young AND they have no
   * ACTIVE relationship with the recipient).
   *
   * Note: this method never throws. The MessagingService caller decides
   * how to translate each kind into an HTTP outcome.
   */
  async canMessage(
    senderId: string,
    recipientId: string,
    opts: {
      /**
       * The sender's `createdAt` when the caller already has it (the
       * send path loads the sender up front). Skips one lookup.
       */
      senderCreatedAt?: Date | null;
    } = {},
  ): Promise<CanMessageResult> {
    if (senderId === recipientId) {
      return { kind: 'forbidden', reason: 'Cannot message yourself.' };
    }

    // The three checks are independent reads, so they share one round
    // trip; the verdicts are then applied in precedence order —
    // suspension, then block, then the new-account rule.
    const [suspended, blocked, throttled] = await Promise.all([
      this.isMessagingSuspended(senderId),
      this.isBlocked(recipientId, senderId),
      this.senderIsThrottledByAccountAge(
        senderId,
        recipientId,
        opts.senderCreatedAt ?? null,
      ),
    ]);

    if (suspended) {
      return {
        kind: 'forbidden',
        reason: 'Your messaging has been restricted. Contact support.',
      };
    }

    if (blocked) {
      return { kind: 'silentDrop', reason: 'BLOCKED_BY_RECIPIENT' };
    }

    if (throttled) {
      return {
        kind: 'forbidden',
        reason:
          'New accounts can only message users they already have an active relationship with.',
      };
    }

    return { kind: 'allowed' };
  }

  // =========================================================================
  // Suspension
  // =========================================================================

  /**
   * True iff the user has an active (non-lifted, non-expired) suspension.
   */
  async isMessagingSuspended(userId: string): Promise<boolean> {
    const now = new Date();
    const row = await this.suspensionModel.findOne({
      where: {
        userId,
        liftedAt: null,
        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }],
      },
      attributes: ['id'],
    });
    return !!row;
  }

  // =========================================================================
  // Block / unblock
  // =========================================================================

  /**
   * True iff `blockerId` has blocked `blockedId`. The check is
   * one-directional — A blocking B does not imply B blocked A.
   */
  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    if (blockerId === blockedId) return false;
    const row = await this.userBlockModel.findOne({
      where: { blockerId, blockedId },
      attributes: ['id'],
    });
    return !!row;
  }

  async block(
    blockerId: string,
    blockedId: string,
    reason?: UserBlockReason,
  ): Promise<UserBlock> {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot block yourself.');
    }
    const target = await User.findByPk(blockedId, { attributes: ['id'] });
    if (!target) {
      throw new NotFoundException('User not found.');
    }
    const existing = await this.userBlockModel.findOne({
      where: { blockerId, blockedId },
    });
    if (existing) {
      throw new ConflictException('You have already blocked this user.');
    }
    const row = await this.userBlockModel.create({
      blockerId,
      blockedId,
      reason: reason ?? null,
    });
    this.logger.log?.(
      `User ${blockerId} blocked ${blockedId} (reason=${reason ?? 'NONE'})`,
      'MessagingSafetyService',
    );
    return row;
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    const row = await this.userBlockModel.findOne({
      where: { blockerId, blockedId },
    });
    if (!row) {
      throw new NotFoundException('Block not found.');
    }
    await row.destroy();
    this.logger.log?.(
      `User ${blockerId} unblocked ${blockedId}`,
      'MessagingSafetyService',
    );
  }

  async listBlocks(blockerId: string): Promise<UserBlock[]> {
    return this.userBlockModel.findAll({
      where: { blockerId },
      include: [
        {
          model: User,
          as: 'blocked',
          attributes: USER_SAFE_ATTRIBUTES,
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  }

  // =========================================================================
  // Participant assertion (delegated from MessagingService in Stage 3+)
  // =========================================================================

  /**
   * Throws NotFoundException if the user is not an *active* participant
   * in the conversation. Intentionally 404 — non-participants should not
   * learn the conversation exists.
   */
  async assertParticipant(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const row = await this.participantModel.findOne({
      where: { conversationId, userId, leftAt: null },
      attributes: ['id'],
    });
    if (!row) {
      throw new NotFoundException('Conversation not found.');
    }
  }

  // =========================================================================
  // Internal
  // =========================================================================

  /**
   * Returns true when the sender's account is younger than the
   * configured window AND there is no ACTIVE InstructorClient row
   * between sender and recipient in EITHER direction.
   *
   * Why both directions: an instructor messaging a brand-new client
   * shouldn't be blocked — they already have an ACTIVE link. The
   * direction of the relationship (instructor vs client side) is not
   * what matters for messaging; the existence of a confirmed link is.
   */
  private async senderIsThrottledByAccountAge(
    senderId: string,
    recipientId: string,
    knownCreatedAt: Date | null,
  ): Promise<boolean> {
    let createdAt = knownCreatedAt;
    if (!createdAt) {
      const sender = await User.findByPk(senderId, {
        attributes: ['id', 'createdAt'],
      });
      if (!sender) {
        // Defensive: a missing sender would have already 401'd at the
        // guard layer. Treat as throttled so we never accidentally allow.
        return true;
      }
      createdAt = sender.createdAt;
    }

    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs >= NEW_ACCOUNT_WINDOW_MS) {
      return false;
    }

    const activeLink = await this.instructorClientModel.findOne({
      where: {
        status: InstructorClientStatus.ACTIVE,
        [Op.or]: [
          { instructorId: senderId, clientId: recipientId },
          { instructorId: recipientId, clientId: senderId },
        ],
      },
      attributes: ['id'],
    });

    return !activeLink;
  }
}
