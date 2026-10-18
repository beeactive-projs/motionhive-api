import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { ClientService } from '../client/client.service';
import {
  ClientRequest,
  ClientRequestStatus,
} from '../client/entities/client-request.entity';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import { coachLeftForClient } from '../client/notifications';
import {
  GroupJoinRequest,
  GroupJoinRequestStatus,
} from '../group/entities/group-join-request.entity';
import { Group } from '../group/entities/group.entity';
import {
  GroupMember,
  GroupMemberRole,
} from '../group/entities/group-member.entity';
import { GroupService } from '../group/group.service';
import { groupClosedForMembers } from '../group/notifications';
import { Invitation } from '../invitation/entities/invitation.entity';
import { NotificationService } from '../notification/notification.service';
import { Subscription } from '../payment/entities/subscription.entity';
import { SubscriptionService } from '../payment/services/subscription.service';
import { SearchIndexService } from '../search/search-index.service';
import { CancelBookingDto } from '../session/dto/cancel-booking.dto';
import { CancelInstanceDto } from '../session/dto/cancel-instance.dto';
import {
  SessionInstanceStatus,
  SessionTemplateStatus,
} from '../session/entities/session.enums';
import { SessionInstance } from '../session/entities/session-instance.entity';
import { SessionParticipant } from '../session/entities/session-participant.entity';
import { SessionTemplate } from '../session/entities/session-template.entity';
import { SessionBookingService } from '../session/services/session-booking.service';
import { SessionLifecycleService } from '../session/services/session-lifecycle.service';
import { User } from '../user/entities/user.entity';
import {
  LIVE_BOOKING_STATUSES,
  LIVE_SUBSCRIPTION_STATUSES,
} from './account-deletion.constants';

/**
 * Ends everything an account shares with other people, when the person
 * confirms they want it deleted.
 *
 * Each step finds what is still live and ends it through the module that
 * owns it, so the other side gets the same notification it would if the
 * person had done it by hand: a coach hears a client left, people booked
 * on a cancelled session hear it was cancelled, members hear their group
 * closed. Every step reads the current state first, so running the whole
 * thing again (the daily sweep does, after a failure) is harmless.
 *
 * Nothing here is reversed if the person keeps the account; the screen and
 * the emails say so before they confirm.
 */
@Injectable()
export class AccountWindDownService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Subscription)
    private readonly subscriptionModel: typeof Subscription,
    @InjectModel(SessionTemplate)
    private readonly templateModel: typeof SessionTemplate,
    @InjectModel(SessionInstance)
    private readonly instanceModel: typeof SessionInstance,
    @InjectModel(SessionParticipant)
    private readonly participantModel: typeof SessionParticipant,
    @InjectModel(Group) private readonly groupModel: typeof Group,
    @InjectModel(GroupMember)
    private readonly memberModel: typeof GroupMember,
    @InjectModel(GroupJoinRequest)
    private readonly joinRequestModel: typeof GroupJoinRequest,
    @InjectModel(Invitation)
    private readonly invitationModel: typeof Invitation,
    @InjectModel(InstructorClient)
    private readonly instructorClientModel: typeof InstructorClient,
    @InjectModel(ClientRequest)
    private readonly clientRequestModel: typeof ClientRequest,
    private readonly subscriptionService: SubscriptionService,
    private readonly sessionLifecycleService: SessionLifecycleService,
    private readonly sessionBookingService: SessionBookingService,
    private readonly groupService: GroupService,
    private readonly clientService: ClientService,
    private readonly searchIndexService: SearchIndexService,
    private readonly notificationService: NotificationService,
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Run every step. A failing step is logged and the rest still run, so one
   * Stripe outage does not leave a coach's sessions live. Returns true only
   * when every step finished.
   */
  async windDown(userId: string): Promise<boolean> {
    const user = await this.userModel.findByPk(userId, {
      attributes: ['id', 'firstName', 'lastName'],
    });
    const name = user
      ? `${user.firstName} ${user.lastName}`.trim() || null
      : null;

    const steps: Array<[string, () => Promise<void>]> = [
      // As someone who trains, books and belongs.
      ['own subscriptions', () => this.cancelOwnSubscriptions(userId)],
      ['bookings', () => this.cancelBookings(userId)],
      ['coaches', () => this.leaveCoaches(userId)],
      ['client requests', () => this.closeClientRequests(userId)],
      ['join requests', () => this.cancelJoinRequests(userId)],
      ['group memberships', () => this.leaveGroups(userId)],
      // As a coach and a group owner.
      ['client subscriptions', () => this.cancelClientSubscriptions(userId)],
      ['sessions', () => this.cancelSessions(userId)],
      ['owned groups', () => this.closeOwnedGroups(userId)],
      ['clients', () => this.endClientRelationships(userId, name)],
      // Nobody finds them any more.
      ['search', () => this.searchIndexService.removeAllForUser(userId)],
    ];

    let ok = true;
    for (const [label, step] of steps) {
      try {
        await step();
      } catch (err) {
        ok = false;
        this.logger.error(
          `Wind-down step "${label}" failed for ${userId}: ${errorText(err)}`,
          'AccountWindDownService',
        );
      }
    }
    return ok;
  }

  // ── As someone who trains ─────────────────────────────────────────────

  /** Their subscriptions to coaches stop renewing; each coach is told. */
  private async cancelOwnSubscriptions(userId: string): Promise<void> {
    const subs = await this.subscriptionModel.findAll({
      where: {
        clientId: userId,
        status: { [Op.in]: LIVE_SUBSCRIPTION_STATUSES },
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: { [Op.ne]: null },
      },
      attributes: ['id'],
    });
    await this.each(subs, (sub) =>
      this.subscriptionService.cancelByClient(userId, sub.id),
    );
  }

  /** Future bookings are cancelled; the coach is told, the waitlist moves up. */
  private async cancelBookings(userId: string): Promise<void> {
    const bookings = await this.participantModel.findAll({
      where: {
        userId,
        status: { [Op.in]: LIVE_BOOKING_STATUSES },
      },
      attributes: ['id', 'instanceId'],
      include: [
        {
          model: SessionInstance,
          attributes: ['id'],
          required: true,
          where: {
            status: SessionInstanceStatus.Scheduled,
            startAt: { [Op.gt]: new Date() },
          },
        },
      ],
    });
    const dto: CancelBookingDto = {};
    await this.each(bookings, (booking) =>
      this.sessionBookingService.cancelBooking(userId, booking.instanceId, dto),
    );
  }

  /** Each coach they train with is told they left. */
  private async leaveCoaches(userId: string): Promise<void> {
    const links = await this.instructorClientModel.findAll({
      where: {
        clientId: userId,
        status: { [Op.ne]: InstructorClientStatus.ARCHIVED },
      },
      attributes: ['instructorId'],
    });
    await this.each(links, (link) =>
      this.clientService.leaveInstructor(userId, link.instructorId),
    );
  }

  /** Requests they sent are withdrawn; requests sent to them are declined. */
  private async closeClientRequests(userId: string): Promise<void> {
    const pending = await this.clientRequestModel.findAll({
      where: {
        status: ClientRequestStatus.PENDING,
        [Op.or]: [{ fromUserId: userId }, { toUserId: userId }],
      },
      attributes: ['id', 'fromUserId'],
    });
    await this.each(pending, (request) =>
      request.fromUserId === userId
        ? this.clientService.cancelRequest(request.id, userId)
        : this.clientService.declineRequest(request.id, userId),
    );
  }

  private async cancelJoinRequests(userId: string): Promise<void> {
    const pending = await this.joinRequestModel.findAll({
      where: { userId, status: GroupJoinRequestStatus.PENDING },
      attributes: ['groupId'],
    });
    await this.each(pending, (request) =>
      this.groupService.cancelMyJoinRequest(request.groupId, userId),
    );
  }

  /** Groups they are in but do not own; each owner is told. */
  private async leaveGroups(userId: string): Promise<void> {
    const memberships = await this.memberModel.findAll({
      where: {
        userId,
        leftAt: null,
        role: { [Op.ne]: GroupMemberRole.OWNER },
      },
      attributes: ['groupId'],
    });
    await this.each(memberships, (membership) =>
      this.groupService.leaveGroup(membership.groupId, userId),
    );
  }

  // ── As a coach ────────────────────────────────────────────────────────

  /**
   * Their clients' subscriptions stop at the end of the period already
   * paid for, one by one so each client is told (the bulk helper the
   * Stripe-disconnect webhook uses tells no one).
   */
  private async cancelClientSubscriptions(userId: string): Promise<void> {
    const subs = await this.subscriptionModel.findAll({
      where: {
        instructorId: userId,
        status: { [Op.in]: LIVE_SUBSCRIPTION_STATUSES },
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: { [Op.ne]: null },
      },
      attributes: ['id'],
    });
    await this.each(subs, (sub) =>
      this.subscriptionService.cancel(userId, sub.id, false),
    );
  }

  /**
   * Every class they run ends. A series with a future occurrence is
   * cancelled through it (scope "series"), which cancels the rest, marks
   * every booking cancelled and tells each person once. A series with
   * nothing left on the calendar is just ended, so it stops generating.
   */
  private async cancelSessions(userId: string): Promise<void> {
    const templates = await this.templateModel.findAll({
      where: { instructorId: userId, status: SessionTemplateStatus.Active },
      attributes: ['id'],
    });
    const dto: CancelInstanceDto = { scope: 'series' };

    await this.each(templates, async (template) => {
      const next = await this.instanceModel.findOne({
        where: {
          templateId: template.id,
          status: SessionInstanceStatus.Scheduled,
          startAt: { [Op.gt]: new Date() },
        },
        order: [['startAt', 'ASC']],
        attributes: ['id'],
      });
      if (next) {
        await this.sessionLifecycleService.cancel(userId, next.id, dto);
        return;
      }
      await this.templateModel.update(
        { status: SessionTemplateStatus.Ended, endedAt: new Date() },
        { where: { id: template.id } },
      );
      await this.searchIndexService.upsertSession(template.id);
    });
  }

  /**
   * Groups they own close: pending invitations and join requests lapse,
   * every member leaves and is told the group closed, then the group goes.
   * GroupService.deleteGroup alone would leave the members inside a group
   * that no longer exists.
   */
  private async closeOwnedGroups(userId: string): Promise<void> {
    const owned = await this.memberModel.findAll({
      where: { userId, leftAt: null, role: GroupMemberRole.OWNER },
      attributes: ['groupId'],
    });

    await this.each(owned, async ({ groupId }) => {
      const group = await this.groupModel.findByPk(groupId, {
        attributes: ['id', 'name'],
      });
      if (!group) return;

      const now = new Date();
      const memberIds = await this.sequelize.transaction(async (tx) => {
        await this.invitationModel.update(
          { declinedAt: now },
          {
            where: { groupId, acceptedAt: null, declinedAt: null },
            transaction: tx,
          },
        );
        await this.joinRequestModel.update(
          { status: GroupJoinRequestStatus.CANCELLED },
          {
            where: { groupId, status: GroupJoinRequestStatus.PENDING },
            transaction: tx,
          },
        );
        const members = await this.memberModel.findAll({
          where: { groupId, leftAt: null, userId: { [Op.ne]: userId } },
          attributes: ['userId'],
          transaction: tx,
        });
        await this.memberModel.update(
          { leftAt: now },
          {
            where: { groupId, leftAt: null, userId: { [Op.ne]: userId } },
            transaction: tx,
          },
        );
        return members.map((member) => member.userId);
      });

      // Soft-deletes the group and drops it from search; needs the owner's
      // membership still open, so the owner leaves after.
      await this.groupService.deleteGroup(groupId, userId);
      await this.memberModel.update(
        { leftAt: new Date() },
        { where: { groupId, userId, leftAt: null } },
      );

      // notify-after-commit
      if (memberIds.length > 0) {
        await this.notificationService.notifyMany(
          memberIds,
          groupClosedForMembers({ id: group.id, name: group.name }),
        );
      }
    });
  }

  /**
   * Their clients are let go, and each one with a live relationship hears
   * their coach left. The plans the coach assigned are copies, so the
   * clients keep training on them.
   */
  private async endClientRelationships(
    userId: string,
    coachName: string | null,
  ): Promise<void> {
    const links = await this.instructorClientModel.findAll({
      where: {
        instructorId: userId,
        status: { [Op.ne]: InstructorClientStatus.ARCHIVED },
      },
      attributes: ['id', 'clientId', 'status'],
    });
    if (links.length === 0) return;

    await this.instructorClientModel.update(
      { status: InstructorClientStatus.ARCHIVED },
      { where: { id: { [Op.in]: links.map((link) => link.id) } } },
    );

    // notify-after-commit: only people who were actually training with them.
    const clientIds = links
      .filter((link) => link.status === InstructorClientStatus.ACTIVE)
      .map((link) => link.clientId);
    await this.each(clientIds, (clientId) =>
      this.notificationService.notify(coachLeftForClient(clientId, coachName)),
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Run `fn` for every item, even after one fails, then fail the step if
   * any did: one stuck subscription must not stop the rest being cancelled.
   */
  private async each<T>(
    items: readonly T[],
    fn: (item: T) => Promise<unknown>,
  ): Promise<void> {
    const failures: string[] = [];
    for (const item of items) {
      try {
        await fn(item);
      } catch (err) {
        failures.push(errorText(err));
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} of ${items.length} failed: ${failures.join('; ')}`,
      );
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
