import type { LoggerService } from '@nestjs/common';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { isEmail } from 'class-validator';
import { randomBytes } from 'crypto';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { col, fn, Op, where as whereFn } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { apiError, toLocale } from '../../common/i18n';
import type { Locale } from '../../common/i18n';
import { EmailService } from '../../common/services/email.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationService } from '../notification/notification.service';
import { RoleService } from '../role/role.service';
import { User } from '../user/entities/user.entity';
import {
  ImportClientRowDto,
  ImportClientsDto,
  PreviewImportEmailDto,
} from './dto/import-clients.dto';
import {
  ClientInviteEmailStatus,
  ClientRequest,
  ClientRequestStatus,
  ClientRequestType,
} from './entities/client-request.entity';
import {
  InstructorClient,
  InstructorClientStatus,
} from './entities/instructor-client.entity';
import { clientInvitationReceived } from './notifications';

/**
 * Invite emails one coach's imports may send in any 24 hours. Every one
 * goes out from our sending domain, so a coach uploading a bought list
 * would cost every coach's deliverability; this bounds the damage.
 */
export const CLIENT_IMPORT_DAILY_LIMIT = 500;

const INVITE_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What happens to one row. Every status is a fact about the coach's own
 * data (their clients, their invites, their own address). Whether an
 * address has a MotionHive account is deliberately not one: a screen that
 * takes 200 addresses and marks who is on MotionHive is a lookup tool
 * for anyone who becomes a coach. Both kinds of person read INVITE, and
 * the server picks the right invite for each.
 */
export enum ClientImportRowStatus {
  /** Gets an invite: a signup link with no account, an in-app request with one. */
  INVITE = 'INVITE',
  /** This coach has a pending invite out to them already. Sent again only with `resendPending`. */
  ALREADY_INVITED = 'ALREADY_INVITED',
  ALREADY_CLIENT = 'ALREADY_CLIENT',
  /** In the client list as archived: the coach restores them there instead. */
  ARCHIVED_CLIENT = 'ARCHIVED_CLIENT',
  /** They asked to train with this coach; the answer is in Requests. */
  REQUESTED_YOU = 'REQUESTED_YOU',
  /** The same address appears earlier in the list. */
  DUPLICATE = 'DUPLICATE',
  INVALID_EMAIL = 'INVALID_EMAIL',
  /** The coach's own address. */
  SELF = 'SELF',
}

export interface ClientImportRowResult {
  /** Position in the submitted `rows`, so the screen can match it back. */
  index: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: ClientImportRowStatus;
  /** When the invite already out went (ALREADY_INVITED only). */
  invitedAt: Date | null;
}

export interface ClientImportResult {
  dryRun: boolean;
  rows: ClientImportRowResult[];
  counts: Record<ClientImportRowStatus, number>;
  /** Invite emails this import sends (or, in a preview, would send). */
  toSend: number;
  /** Invite emails the coach has left in the last 24 hours, before this import. */
  dailyRemaining: number;
}

export type InviteEmailOutcome =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

/** A row plus what the server knows about it and never returns. */
interface ClassifiedRow extends ClientImportRowResult {
  note: string | null;
  /** The account behind the address. Internal: returning it would answer "is this person on MotionHive". */
  userId: string | null;
  /** This coach's pending invite to them (ALREADY_INVITED). */
  existingRequest: ClientRequest | null;
}

type Coach = Pick<
  User,
  'id' | 'email' | 'firstName' | 'lastName' | 'language' | 'avatarUrl'
>;

/** Collapse runs of whitespace; empty becomes null. Stored as typed, escaped on output. */
function cleanName(value: string | undefined): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

/** Same, but a note keeps its line breaks. */
function cleanNote(value: string | undefined): string | null {
  const text = (value ?? '').replace(/[ \t\f\v]+/g, ' ').trim();
  return text || null;
}

function fullName(user: Pick<User, 'firstName' | 'lastName'> | null): string {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
}

/**
 * Client import: a coach's spreadsheet becomes ordinary
 * INSTRUCTOR_TO_CLIENT invitations.
 *
 * Nothing downstream is new. Someone with no account gets a token
 * invite (signup by token connects them on the spot, signup by the same
 * email links it), someone with an account gets an in-app request. What
 * import adds is the batch: one preview that says what each row will do,
 * one transaction that writes them, and the emails on the job queue,
 * because 200 sends in the request would be slow and fail half-way.
 *
 * `importClients(…, dryRun = true)` is the preview. Same code path as
 * the commit, so what the coach reviewed is exactly what gets sent.
 */
@Injectable()
export class ClientImportService {
  constructor(
    @InjectModel(ClientRequest)
    private readonly clientRequestModel: typeof ClientRequest,
    @InjectModel(InstructorClient)
    private readonly instructorClientModel: typeof InstructorClient,
    private readonly sequelize: Sequelize,
    private readonly roleService: RoleService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
    private readonly jobs: JobsService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async importClients(
    instructorId: string,
    dto: ImportClientsDto,
    dryRun: boolean,
  ): Promise<ClientImportResult> {
    const coach = await this.loadCoach(instructorId);
    const rows = await this.classify(coach, dto.rows);
    const dailyRemaining = await this.dailyRemaining(instructorId);

    const toInvite = rows.filter(
      (row) => row.status === ClientImportRowStatus.INVITE,
    );
    const toResend = dto.resendPending
      ? rows.filter(
          (row) => row.status === ClientImportRowStatus.ALREADY_INVITED,
        )
      : [];
    const toSend = toInvite.length + toResend.length;

    const result: ClientImportResult = {
      dryRun,
      rows: rows.map((row) => ({
        index: row.index,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        status: row.status,
        invitedAt: row.invitedAt,
      })),
      counts: this.countByStatus(rows),
      toSend,
      dailyRemaining,
    };

    if (dryRun || toSend === 0) return result;

    if (toSend > dailyRemaining) {
      throw new BadRequestException(
        apiError('client.importDailyLimit', { remaining: dailyRemaining }),
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);
    const message = cleanNote(dto.message);

    const queued = await this.sequelize.transaction(async (transaction) => {
      const created = await this.clientRequestModel.bulkCreate(
        toInvite.map((row) => ({
          fromUserId: instructorId,
          toUserId: row.userId,
          // Same shape as a hand-typed invite: an address and a token only
          // for someone with no account; an account is reached by id.
          invitedEmail: row.userId ? null : row.email,
          token: row.userId ? null : randomBytes(32).toString('hex'),
          type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
          status: ClientRequestStatus.PENDING,
          message,
          expiresAt,
          invitedFirstName: row.firstName,
          invitedLastName: row.lastName,
          coachNote: row.note,
          emailStatus: ClientInviteEmailStatus.QUEUED,
          importedAt: now,
        })),
        { transaction },
      );

      const resent: ClientRequest[] = [];
      for (const row of toResend) {
        const request = row.existingRequest;
        if (!request) continue;
        // Mirrors `resendInvitation`: 30 more days and, for an email-only
        // invite, a fresh token. What the sheet adds fills gaps only; it
        // never overwrites what the coach wrote on the invite before.
        await request.update(
          {
            expiresAt,
            token: request.invitedEmail
              ? randomBytes(32).toString('hex')
              : request.token,
            message: message ?? request.message,
            invitedFirstName: request.invitedFirstName ?? row.firstName,
            invitedLastName: request.invitedLastName ?? row.lastName,
            coachNote: request.coachNote ?? row.note,
            emailStatus: ClientInviteEmailStatus.QUEUED,
            importedAt: now,
          },
          { transaction },
        );
        resent.push(request);
      }

      return [...created, ...resent];
    });

    // notify-after-commit: the requests above are committed. An account
    // holder hears about a new invite in the app too, as with a
    // hand-typed one; a resend does not ping them again.
    const coachName = fullName(coach) || null;
    for (const row of toInvite) {
      if (!row.userId) continue;
      await this.notificationService
        .notify(clientInvitationReceived(row.userId, coachName))
        .catch((err: Error) =>
          this.logger.error(
            `Failed to notify invitee on client import: ${err.message}`,
            'ClientImportService',
          ),
        );
    }

    await this.queueInviteEmails(
      queued,
      dto.locale ?? toLocale(coach.language),
    );

    this.logger.log(
      `Instructor ${instructorId} imported ${toInvite.length} client(s), resent ${toResend.length}`,
      'ClientImportService',
    );

    return result;
  }

  /**
   * The invite email exactly as the list will get it, with the coach's own
   * name, photo and message. Nothing is saved; the review screen asks for
   * it when the coach opens "Preview email".
   */
  async previewInviteEmail(
    instructorId: string,
    dto: PreviewImportEmailDto,
  ): Promise<{ subject: string; html: string }> {
    const coach = await this.loadCoach(instructorId);
    return this.emailService.previewClientImportInvitationEmail({
      recipientFirstName: cleanName(dto.recipientFirstName),
      instructorName: fullName(coach),
      instructorAvatarUrl: coach.avatarUrl ?? null,
      message: cleanNote(dto.message) ?? undefined,
      locale: dto.locale ?? toLocale(coach.language),
    });
  }

  /**
   * Send one imported invite. Called by the `notifications.client_invite_send`
   * job, and inline when there is no Redis.
   *
   * Reads the row at send time: an invite cancelled, accepted or already
   * sent since it was queued is skipped, which is what makes a retry
   * after a half-finished attempt safe. A failure is returned, not
   * thrown, so the caller decides between retrying and giving up.
   */
  async sendInviteEmail(
    requestId: string,
    locale: Locale,
  ): Promise<InviteEmailOutcome> {
    const request = await this.clientRequestModel.findByPk(requestId, {
      include: [
        {
          model: User,
          as: 'fromUser',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
        },
        {
          model: User,
          as: 'toUser',
          attributes: ['id', 'email', 'firstName', 'language'],
        },
      ],
    });

    if (!request) return { status: 'skipped', reason: 'request gone' };
    if (request.status !== ClientRequestStatus.PENDING) {
      return { status: 'skipped', reason: `request ${request.status}` };
    }
    if (request.emailStatus !== ClientInviteEmailStatus.QUEUED) {
      return { status: 'skipped', reason: `email ${request.emailStatus}` };
    }

    const to = request.toUser?.email ?? request.invitedEmail;
    if (!to) return { status: 'skipped', reason: 'no address' };

    const outcome = await this.emailService.sendClientImportInvitationEmail({
      to,
      recipientFirstName:
        request.toUser?.firstName ?? request.invitedFirstName ?? null,
      instructorName: fullName(request.fromUser),
      instructorAvatarUrl: request.fromUser?.avatarUrl ?? null,
      requestId: request.id,
      // Someone who signed up since the import (linked by email) has an
      // account now: they get the in-app request, not the signup link.
      token: request.toUserId ? null : request.token,
      message: request.message ?? undefined,
      locale: request.toUser ? toLocale(request.toUser.language) : locale,
    });

    if (!outcome.ok) return { status: 'failed', reason: outcome.reason };

    await request.update({ emailStatus: ClientInviteEmailStatus.SENT });
    return { status: 'sent' };
  }

  /**
   * Send an imported invite's email again (`POST /clients/invite/:id/resend`
   * lands here for imported rows). The caller has already renewed the
   * request; this puts it back on QUEUED and on the queue.
   */
  async requeueInviteEmail(
    request: ClientRequest,
    locale: Locale,
  ): Promise<void> {
    await request.update({ emailStatus: ClientInviteEmailStatus.QUEUED });
    await this.queueInviteEmails([request], locale);
  }

  /** After the last attempt: the coach sees "couldn't send" instead of a row stuck on sending. */
  async markInviteEmailFailed(requestId: string): Promise<void> {
    await this.clientRequestModel.update(
      { emailStatus: ClientInviteEmailStatus.FAILED },
      {
        where: { id: requestId, emailStatus: ClientInviteEmailStatus.QUEUED },
      },
    );
  }

  private async loadCoach(instructorId: string): Promise<Coach> {
    const isCoach = await this.roleService.userHasRole(
      instructorId,
      'INSTRUCTOR',
    );
    const coach = isCoach
      ? await User.findByPk(instructorId, {
          attributes: [
            'id',
            'email',
            'firstName',
            'lastName',
            'language',
            'avatarUrl',
          ],
        })
      : null;
    if (!coach) {
      throw new ForbiddenException(apiError('client.coachesOnly'));
    }
    return coach;
  }

  /**
   * Decide every row in a handful of queries, however long the list:
   * accounts by address, this coach's relationships with them, and the
   * requests already pending between them.
   */
  private async classify(
    coach: Coach,
    input: ImportClientRowDto[],
  ): Promise<ClassifiedRow[]> {
    const coachEmail = coach.email.toLowerCase();
    const seen = new Set<string>();

    const rows: ClassifiedRow[] = input.map((raw, index) => {
      const email = raw.email.trim().toLowerCase();
      const row: ClassifiedRow = {
        index,
        email,
        firstName: cleanName(raw.firstName),
        lastName: cleanName(raw.lastName),
        note: cleanNote(raw.note),
        status: ClientImportRowStatus.INVITE,
        invitedAt: null,
        userId: null,
        existingRequest: null,
      };
      if (!isEmail(email)) {
        row.status = ClientImportRowStatus.INVALID_EMAIL;
      } else if (email === coachEmail) {
        row.status = ClientImportRowStatus.SELF;
      } else if (seen.has(email)) {
        row.status = ClientImportRowStatus.DUPLICATE;
      } else {
        seen.add(email);
      }
      return row;
    });

    const emails = [...seen];
    if (emails.length === 0) return rows;

    // Case-insensitive: signup stores the address as typed, so an exact
    // match would treat "Ana.Pop@…" as someone new.
    const users = await User.findAll({
      where: whereFn(fn('LOWER', col('email')), { [Op.in]: emails }),
      attributes: ['id', 'email'],
    });
    const userIdByEmail = new Map(
      users.map((user) => [user.email.toLowerCase(), user.id]),
    );
    const userIds = [...userIdByEmail.values()];

    const [relationships, pending] = await Promise.all([
      userIds.length > 0
        ? this.instructorClientModel.findAll({
            where: {
              instructorId: coach.id,
              clientId: { [Op.in]: userIds },
              status: {
                [Op.in]: [
                  InstructorClientStatus.ACTIVE,
                  InstructorClientStatus.ARCHIVED,
                ],
              },
            },
            attributes: ['clientId', 'status'],
          })
        : Promise.resolve([] as InstructorClient[]),
      this.clientRequestModel.findAll({
        where: {
          status: ClientRequestStatus.PENDING,
          expiresAt: { [Op.gt]: new Date() },
          [Op.or]: [
            {
              fromUserId: coach.id,
              type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
              [Op.or]: [
                { invitedEmail: { [Op.in]: emails } },
                ...(userIds.length > 0
                  ? [{ toUserId: { [Op.in]: userIds } }]
                  : []),
              ],
            },
            ...(userIds.length > 0
              ? [
                  {
                    toUserId: coach.id,
                    type: ClientRequestType.CLIENT_TO_INSTRUCTOR,
                    fromUserId: { [Op.in]: userIds },
                  },
                ]
              : []),
          ],
        },
      }),
    ]);

    const relationshipByUser = new Map(
      relationships.map((rel) => [rel.clientId, rel.status]),
    );
    const outgoingByEmail = new Map<string, ClientRequest>();
    const outgoingByUser = new Map<string, ClientRequest>();
    const requestedBy = new Set<string>();
    for (const request of pending) {
      if (request.type === ClientRequestType.CLIENT_TO_INSTRUCTOR) {
        requestedBy.add(request.fromUserId);
        continue;
      }
      if (request.invitedEmail) {
        outgoingByEmail.set(request.invitedEmail.toLowerCase(), request);
      }
      if (request.toUserId) outgoingByUser.set(request.toUserId, request);
    }

    for (const row of rows) {
      if (row.status !== ClientImportRowStatus.INVITE) continue;

      const userId = userIdByEmail.get(row.email) ?? null;
      row.userId = userId;
      const relationship = userId ? relationshipByUser.get(userId) : undefined;
      const outgoing =
        outgoingByEmail.get(row.email) ??
        (userId ? outgoingByUser.get(userId) : undefined);

      if (relationship === InstructorClientStatus.ACTIVE) {
        row.status = ClientImportRowStatus.ALREADY_CLIENT;
      } else if (relationship === InstructorClientStatus.ARCHIVED) {
        row.status = ClientImportRowStatus.ARCHIVED_CLIENT;
      } else if (userId && requestedBy.has(userId)) {
        row.status = ClientImportRowStatus.REQUESTED_YOU;
      } else if (outgoing) {
        row.status = ClientImportRowStatus.ALREADY_INVITED;
        row.existingRequest = outgoing;
        row.invitedAt = outgoing.createdAt;
      }
    }

    return rows;
  }

  /**
   * What the rolling 24-hour cap leaves. Counts invites by when an import
   * last sent them, so sending the same person again today costs nothing
   * extra.
   */
  private async dailyRemaining(instructorId: string): Promise<number> {
    const used = await this.clientRequestModel.count({
      where: {
        fromUserId: instructorId,
        importedAt: { [Op.gt]: new Date(Date.now() - DAY_MS) },
      },
    });
    return Math.max(0, CLIENT_IMPORT_DAILY_LIMIT - used);
  }

  private countByStatus(
    rows: ClassifiedRow[],
  ): Record<ClientImportRowStatus, number> {
    const counts = Object.fromEntries(
      Object.values(ClientImportRowStatus).map((status) => [status, 0]),
    ) as Record<ClientImportRowStatus, number>;
    for (const row of rows) counts[row.status] += 1;
    return counts;
  }

  /**
   * One job per invite, keyed on the request and its expiry: a double
   * submit dedupes, while a resend (new expiry) is a new job even though
   * the last one is still in BullMQ's completed list.
   *
   * With no Redis, `enqueue` returns null for every job. The first null
   * hands the rest to an inline sender in the background, so dev still
   * sends (logs, without Resend) and the request does not wait on it.
   */
  private async queueInviteEmails(
    requests: ClientRequest[],
    locale: Locale,
  ): Promise<void> {
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      const job = await this.jobs.enqueue(
        'notifications.client_invite_send',
        { requestId: request.id, locale },
        { jobId: `client-invite-${request.id}-${request.expiresAt.getTime()}` },
      );
      if (!job) {
        void this.sendInline(
          requests.slice(i).map((r) => r.id),
          locale,
        );
        return;
      }
    }
  }

  private async sendInline(
    requestIds: string[],
    locale: Locale,
  ): Promise<void> {
    for (const requestId of requestIds) {
      try {
        const outcome = await this.sendInviteEmail(requestId, locale);
        if (outcome.status === 'failed') {
          await this.markInviteEmailFailed(requestId);
        }
      } catch (err) {
        this.logger.error(
          `Inline client invite send failed for ${requestId}: ${(err as Error).message}`,
          'ClientImportService',
        );
      }
    }
  }
}
