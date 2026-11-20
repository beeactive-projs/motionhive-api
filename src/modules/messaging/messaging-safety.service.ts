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
import { Op, QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { apiError, ApiErrorBody } from '../../common/i18n';
import {
  BOOKING_CONNECTION_DAYS,
  COACH_REQUEST_MESSAGE_LIMIT,
  REQUEST_MESSAGE_LIMIT,
} from './constants';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import {
  ClientRequest,
  ClientRequestStatus,
} from '../client/entities/client-request.entity';
import {
  MessagePolicy,
  User,
  USER_CARD_ATTRIBUTES,
} from '../user/entities/user.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { MessagingSuspension } from './entities/messaging-suspension.entity';
import { UserBlock, UserBlockReason } from './entities/user-block.entity';

/**
 * Outcome of a permission check before sending. Wider than a boolean so
 * the caller can distinguish the two semantically different denial
 * shapes:
 *   - 'silentDrop': pretend the send succeeded, do nothing.
 *   - 'forbidden': raise a 403 with a clear, translated reason.
 * The 'allowed' branch is the happy path.
 */
export type CanMessageResult =
  | { kind: 'allowed' }
  | { kind: 'silentDrop'; reason: SilentDropReason }
  | { kind: 'forbidden'; reason: ApiErrorBody };

export type SilentDropReason = 'BLOCKED_BY_RECIPIENT';

/**
 * Where a message that is allowed lands (migration 090):
 *   - 'direct':  straight into the recipient's chats.
 *   - 'request': in their message requests; `limit` is how many messages
 *                the sender may send before it is accepted.
 *   - 'refused': the recipient takes messages from connections only.
 */
export type MessageDelivery =
  | { kind: 'direct' }
  | { kind: 'request'; limit: number }
  | { kind: 'refused'; reason: ApiErrorBody };

/** How a message request's sender and its reader might know each other. */
export interface RequestContext {
  /** One group both are active members of (first by name), or null. */
  sharedGroupName: string | null;
  /** How many groups they share. */
  sharedGroupCount: number;
  /** The person writing coaches on MotionHive. */
  isCoach: boolean;
}

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
    @InjectModel(ClientRequest)
    private readonly clientRequestModel: typeof ClientRequest,
    private readonly sequelize: Sequelize,
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
      /**
       * The recipient already took this chat in (they wrote first, or
       * accepted). A new account may always answer someone who wrote to it.
       */
      recipientAccepted?: boolean;
    } = {},
  ): Promise<CanMessageResult> {
    if (senderId === recipientId) {
      return {
        kind: 'forbidden',
        reason: apiError('messaging.cannotMessageSelf'),
      };
    }

    // The three checks are independent reads, so they share one round
    // trip; the verdicts are then applied in precedence order —
    // suspension, then block, then the new-account rule.
    const [suspended, blocked, blockedByMe, throttled] = await Promise.all([
      this.isMessagingSuspended(senderId),
      this.isBlocked(recipientId, senderId),
      this.isBlocked(senderId, recipientId),
      this.senderIsThrottledByAccountAge(
        senderId,
        recipientId,
        opts.senderCreatedAt ?? null,
        opts.recipientAccepted ?? false,
      ),
    ]);

    if (suspended) {
      return {
        kind: 'forbidden',
        reason: apiError('messaging.suspended'),
      };
    }

    if (blocked) {
      return { kind: 'silentDrop', reason: 'BLOCKED_BY_RECIPIENT' };
    }

    // A block works both ways: the person who blocked cannot keep
    // writing to someone who can no longer write back. They know they
    // blocked, so this is said plainly rather than dropped.
    if (blockedByMe) {
      return {
        kind: 'forbidden',
        reason: apiError('messaging.youBlockedThem'),
      };
    }

    if (throttled) {
      return {
        kind: 'forbidden',
        reason: apiError('messaging.newAccountLimited'),
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

  /** True when either of the two has blocked the other. */
  async isBlockedEitherWay(userA: string, userB: string): Promise<boolean> {
    if (userA === userB) {
      return false;
    }
    const row = await this.userBlockModel.findOne({
      where: {
        [Op.or]: [
          { blockerId: userA, blockedId: userB },
          { blockerId: userB, blockedId: userA },
        ],
      },
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
      throw new BadRequestException(apiError('messaging.cannotBlockSelf'));
    }
    const target = await User.findByPk(blockedId, { attributes: ['id'] });
    if (!target) {
      throw new NotFoundException(apiError('messaging.userNotFound'));
    }
    const existing = await this.userBlockModel.findOne({
      where: { blockerId, blockedId },
    });
    if (existing) {
      throw new ConflictException(apiError('messaging.alreadyBlocked'));
    }
    const row = await this.sequelize.transaction(async (transaction) => {
      const created = await this.userBlockModel.create(
        {
          blockerId,
          blockedId,
          reason: reason ?? null,
        },
        { transaction },
      );
      await this.endCoachingBetween(blockerId, blockedId, transaction);
      return created;
    });
    this.logger.log?.(
      `User ${blockerId} blocked ${blockedId} (reason=${reason ?? 'NONE'})`,
      'MessagingSafetyService',
    );
    return row;
  }

  /**
   * A block ends any coaching between the two, whichever side coaches
   * (owner, 2026-11-19): an ACTIVE relationship is archived, so the coach
   * loses the client's training and plans, and a request still waiting
   * either way is cancelled. Silent, like the block itself: nobody is
   * told. Unblocking does not restore it; that takes a new invitation.
   */
  private async endCoachingBetween(
    userA: string,
    userB: string,
    transaction: Transaction,
  ): Promise<void> {
    await this.instructorClientModel.update(
      { status: InstructorClientStatus.ARCHIVED },
      {
        where: {
          status: InstructorClientStatus.ACTIVE,
          [Op.or]: [
            { instructorId: userA, clientId: userB },
            { instructorId: userB, clientId: userA },
          ],
        },
        transaction,
      },
    );
    await this.clientRequestModel.update(
      { status: ClientRequestStatus.CANCELLED, respondedAt: new Date() },
      {
        where: {
          status: ClientRequestStatus.PENDING,
          [Op.or]: [
            { fromUserId: userA, toUserId: userB },
            { fromUserId: userB, toUserId: userA },
          ],
        },
        transaction,
      },
    );
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    const row = await this.userBlockModel.findOne({
      where: { blockerId, blockedId },
    });
    if (!row) {
      throw new NotFoundException(apiError('messaging.notBlocked'));
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
          // A card, never the person's email or phone: anyone can block
          // anyone, so this list read every account's contact details.
          attributes: USER_CARD_ATTRIBUTES,
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
      throw new NotFoundException(apiError('messaging.conversationNotFound'));
    }
  }

  // =========================================================================
  // Internal
  // =========================================================================

  /**
   * Returns true when the sender's account is younger than the
   * configured window AND the sender may not write to the recipient
   * directly (no coaching, recent booking or group they run between
   * them: `mayWriteDirectly`) AND the recipient has not already taken
   * the chat in. A new account answers anyone who wrote to it, but
   * cannot start message requests.
   */
  private async senderIsThrottledByAccountAge(
    senderId: string,
    recipientId: string,
    knownCreatedAt: Date | null,
    recipientAccepted: boolean,
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
    if (recipientAccepted) {
      return false;
    }

    const connected = await this.mayWriteDirectly(senderId, recipientId);
    return !connected;
  }

  // =========================================================================
  // Message requests (migration 090)
  // =========================================================================

  /**
   * Where a message from `senderId` lands when the recipient has not taken
   * the chat in yet. Connected people go straight in; otherwise the
   * recipient's "Who can message you" decides: straight in, a message
   * request, or refused. Blocks and suspensions are `canMessage`'s job and
   * are checked before this.
   */
  async deliveryFor(
    senderId: string,
    recipientId: string,
  ): Promise<MessageDelivery> {
    const [connected, policy] = await Promise.all([
      this.mayWriteDirectly(senderId, recipientId),
      this.messagePolicyOf(recipientId),
    ]);
    if (connected) {
      return { kind: 'direct' };
    }
    if (policy === MessagePolicy.Everyone) {
      return { kind: 'direct' };
    }
    if (policy === MessagePolicy.Connections) {
      return {
        kind: 'refused',
        reason: apiError('messaging.connectionsOnly'),
      };
    }
    const limits = await this.requestLimitsFor([recipientId]);
    return { kind: 'request', limit: limits.get(recipientId) ?? 0 };
  }

  /**
   * True when the sender may write straight into the recipient's chats
   * because of what they share (docs/research/messaging/WHO_CAN_MESSAGE.md
   * §3.1):
   *   - ACTIVE coaching, either way round;
   *   - the recipient sent the sender a coaching request or invitation that
   *     is still waiting (you can always answer someone who reached out;
   *     the person who sent it gets nothing from this);
   *   - a booking (confirmed, pending approval or waitlisted) by one of them
   *     in the other's session, ahead or ended within BOOKING_CONNECTION_DAYS;
   *   - a group they are both in, where one of them is its owner or a
   *     moderator.
   * One query. Raw SQL, so this module imports no session or group code.
   */
  async mayWriteDirectly(
    senderId: string,
    recipientId: string,
  ): Promise<boolean> {
    if (senderId === recipientId) {
      return false;
    }
    const rows = await this.sequelize.query<{ connected: number }>(
      `SELECT 1 AS connected
       WHERE EXISTS (
           SELECT 1 FROM instructor_client ic
           WHERE ic.status = 'ACTIVE'
             AND ((ic.instructor_id = :sender AND ic.client_id = :recipient)
               OR (ic.instructor_id = :recipient AND ic.client_id = :sender))
         )
         OR EXISTS (
           SELECT 1 FROM client_request cr
           WHERE cr.status = 'PENDING'
             AND cr.from_user_id = :recipient
             AND cr.to_user_id = :sender
             AND cr.expires_at > NOW()
         )
         OR EXISTS (
           SELECT 1
           FROM session_participant sp
           JOIN session_instance si
             ON si.id = sp.instance_id AND si.deleted_at IS NULL
           WHERE sp.status IN ('CONFIRMED', 'PENDING_APPROVAL', 'WAITLISTED')
             AND si.start_at > NOW() - (:bookingDays * INTERVAL '1 day')
             AND ((sp.user_id = :sender AND si.instructor_id = :recipient)
               OR (sp.user_id = :recipient AND si.instructor_id = :sender))
         )
         OR EXISTS (
           SELECT 1
           FROM group_member a
           JOIN group_member b
             ON b.group_id = a.group_id AND b.left_at IS NULL
           JOIN "group" g
             ON g.id = a.group_id AND g.deleted_at IS NULL
           WHERE a.user_id = :sender
             AND b.user_id = :recipient
             AND a.left_at IS NULL
             AND (a.role IN ('OWNER', 'MODERATOR')
               OR b.role IN ('OWNER', 'MODERATOR'))
         )`,
      {
        replacements: {
          sender: senderId,
          recipient: recipientId,
          bookingDays: BOOKING_CONNECTION_DAYS,
        },
        type: QueryTypes.SELECT,
      },
    );
    return rows.length > 0;
  }

  /** The person's "Who can message you"; the default for a missing account. */
  async messagePolicyOf(userId: string): Promise<MessagePolicy> {
    const user = await User.findByPk(userId, {
      attributes: ['id', 'messagePolicy'],
    });
    if (!user?.messagePolicy) {
      return MessagePolicy.Requests;
    }
    return user.messagePolicy;
  }

  /**
   * How many messages someone may send to each of these people while a
   * request waits: COACH_REQUEST_MESSAGE_LIMIT for a coach taking clients,
   * REQUEST_MESSAGE_LIMIT for anyone else.
   */
  async requestLimitsFor(recipientIds: string[]): Promise<Map<string, number>> {
    const limits = new Map<string, number>();
    if (recipientIds.length === 0) {
      return limits;
    }
    for (const id of recipientIds) {
      limits.set(id, REQUEST_MESSAGE_LIMIT);
    }
    const coaches = await this.sequelize.query<{ userId: string }>(
      `SELECT user_id AS "userId"
       FROM instructor_profile
       WHERE user_id IN (:ids)
         AND is_accepting_clients = TRUE
         AND deleted_at IS NULL`,
      { replacements: { ids: recipientIds }, type: QueryTypes.SELECT },
    );
    for (const row of coaches) {
      limits.set(row.userId, COACH_REQUEST_MESSAGE_LIMIT);
    }
    return limits;
  }

  /**
   * How many message requests `senderId` started since `since`: the request
   * rows of other people in chats the sender is in.
   */
  async requestsStartedSince(senderId: string, since: Date): Promise<number> {
    const rows = await this.sequelize.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM conversation_participant r
       JOIN conversation_participant s
         ON s.conversation_id = r.conversation_id AND s.user_id = :sender
       WHERE r.user_id <> :sender
         AND r.request_at > :since`,
      {
        replacements: { sender: senderId, since },
        type: QueryTypes.SELECT,
      },
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * What a reader is told about the people whose requests they are looking
   * at: a group in common and whether the writer coaches. Two queries for
   * any number of people.
   */
  async requestContextsFor(
    viewerId: string,
    otherIds: string[],
  ): Promise<Map<string, RequestContext>> {
    const contexts = new Map<string, RequestContext>();
    if (otherIds.length === 0) {
      return contexts;
    }
    for (const id of otherIds) {
      contexts.set(id, {
        sharedGroupName: null,
        sharedGroupCount: 0,
        isCoach: false,
      });
    }

    const [groups, coaches] = await Promise.all([
      this.sequelize.query<{ userId: string; name: string; count: string }>(
        `SELECT o.user_id AS "userId", MIN(g.name) AS name, COUNT(*) AS count
         FROM group_member me
         JOIN group_member o
           ON o.group_id = me.group_id AND o.left_at IS NULL
         JOIN "group" g
           ON g.id = me.group_id AND g.deleted_at IS NULL
         WHERE me.user_id = :viewer
           AND me.left_at IS NULL
           AND o.user_id IN (:others)
         GROUP BY o.user_id`,
        {
          replacements: { viewer: viewerId, others: otherIds },
          type: QueryTypes.SELECT,
        },
      ),
      this.sequelize.query<{ userId: string }>(
        `SELECT user_id AS "userId"
         FROM instructor_profile
         WHERE user_id IN (:others) AND deleted_at IS NULL`,
        { replacements: { others: otherIds }, type: QueryTypes.SELECT },
      ),
    ]);

    for (const row of groups) {
      const context = contexts.get(row.userId);
      if (context) {
        context.sharedGroupName = row.name;
        context.sharedGroupCount = Number(row.count);
      }
    }
    for (const row of coaches) {
      const context = contexts.get(row.userId);
      if (context) {
        context.isCoach = true;
      }
    }
    return contexts;
  }
}
