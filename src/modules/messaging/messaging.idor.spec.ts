/**
 * IDOR (Insecure Direct Object Reference) cross-user permission tests.
 *
 * For every messaging operation a non-participant could try to call,
 * verify that the safety gate fires FIRST and the call returns 404 —
 * not 200, not 403, not 500.
 *
 * The rule (locked in the plan §6 security checklist):
 *   - Non-participant access returns 404 (not 403); does not leak
 *     conversation existence.
 *
 * This file exists as a single dedicated guard against regressions in
 * any cross-user check, separate from the general service spec so a
 * future code change can't accidentally weaken these without a loud
 * test failure.
 */

import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { MessagingService } from './messaging.service';
import { MessagingSafetyService } from './messaging-safety.service';
import { MessagingContentService } from './messaging-content.service';
import { MessagingRateLimitService } from './messaging-rate-limit.service';
import { MessagingVelocityService } from './messaging-velocity.service';
import { MessagingEventsService } from './messaging-events.service';
import { NotificationService } from '../notification/notification.service';
import { Conversation } from './entities/conversation.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { Message, MessageKind } from './entities/message.entity';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';

describe('Messaging IDOR — non-participant access', () => {
  let service: MessagingService;
  let safety: { canMessage: jest.Mock; assertParticipant: jest.Mock };
  let conv: { findByPk: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let part: {
    findOne: jest.Mock;
    findAll: jest.Mock;
    update: jest.Mock;
  };
  let msg: {
    findByPk: jest.Mock;
    findOne: jest.Mock;
    findAll: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
  };

  const NON_PARTICIPANT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const SOMEONE_ELSES_CONVO = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const SOMEONE_ELSES_MESSAGE = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  const NOT_FOUND = new NotFoundException('Conversation not found.');

  beforeEach(async () => {
    safety = {
      canMessage: jest.fn().mockResolvedValue({ kind: 'allowed' }),
      // Every assertParticipant call rejects with 404 — that's the
      // whole premise of these tests.
      assertParticipant: jest.fn().mockRejectedValue(NOT_FOUND),
    };
    conv = {
      findByPk: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    part = {
      findOne: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
    };
    msg = {
      findByPk: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
    };

    const sequelize = {
      transaction: jest.fn(
        async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb({}),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        MessagingService,
        { provide: getModelToken(Conversation), useValue: conv },
        { provide: getModelToken(ConversationParticipant), useValue: part },
        { provide: getModelToken(Message), useValue: msg },
        {
          provide: (await import('sequelize-typescript')).Sequelize,
          useValue: sequelize,
        },
        { provide: MessagingSafetyService, useValue: safety },
        {
          provide: MessagingContentService,
          useValue: { detectThreats: jest.fn() },
        },
        {
          provide: MessagingRateLimitService,
          useValue: {
            assertSendAllowed: jest.fn(),
            shouldSuppressMessageEmail: jest.fn(),
          },
        },
        {
          provide: MessagingVelocityService,
          useValue: { recordSendAndMaybeAlarm: jest.fn() },
        },
        {
          provide: NotificationService,
          useValue: { notify: jest.fn() },
        },
        {
          provide: MessagingEventsService,
          useValue: {
            emitMessageCreated: jest.fn(),
            emitMessageDeleted: jest.fn(),
            emitConversationRead: jest.fn(),
            emitConversationMuted: jest.fn(),
            emitConversationUnread: jest.fn(),
            emitConversationCleared: jest.fn(),
          },
        },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = module.get(MessagingService);
  });

  // ──────────────────────────────────────────────────────────────────
  // Reads — all must 404 on cross-user access.
  // ──────────────────────────────────────────────────────────────────

  it('getConversation: non-participant gets 404 (not 403)', async () => {
    await expect(
      service.getConversation(NON_PARTICIPANT, SOMEONE_ELSES_CONVO),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(safety.assertParticipant).toHaveBeenCalledWith(
      NON_PARTICIPANT,
      SOMEONE_ELSES_CONVO,
    );
  });

  it('listMessages: non-participant gets 404', async () => {
    await expect(
      service.listMessages(NON_PARTICIPANT, SOMEONE_ELSES_CONVO, {
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(safety.assertParticipant).toHaveBeenCalledWith(
      NON_PARTICIPANT,
      SOMEONE_ELSES_CONVO,
    );
    // No message query was issued.
    expect(msg.findAll).not.toHaveBeenCalled();
  });

  it('listMessages: non-participant cannot probe via the `before` cursor either', async () => {
    await expect(
      service.listMessages(NON_PARTICIPANT, SOMEONE_ELSES_CONVO, {
        before: SOMEONE_ELSES_MESSAGE,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // The cursor lookup should NEVER run for a non-participant — that
    // would leak existence ("which message ids belong to this convo").
    expect(msg.findOne).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────
  // Writes — all must 404 on cross-user access. No row mutation may occur.
  // ──────────────────────────────────────────────────────────────────

  it('markRead: non-participant gets 404, no update is issued', async () => {
    await expect(
      service.markRead(NON_PARTICIPANT, SOMEONE_ELSES_CONVO),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(part.update).not.toHaveBeenCalled();
  });

  it('markUnread: non-participant gets 404, no update is issued', async () => {
    await expect(
      service.markUnread(NON_PARTICIPANT, SOMEONE_ELSES_CONVO),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(part.update).not.toHaveBeenCalled();
  });

  it('clearConversation: non-participant gets 404, no update is issued', async () => {
    await expect(
      service.clearConversation(NON_PARTICIPANT, SOMEONE_ELSES_CONVO),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(part.update).not.toHaveBeenCalled();
  });

  it('muteConversation: non-participant gets 404, no update is issued', async () => {
    await expect(
      service.muteConversation(NON_PARTICIPANT, SOMEONE_ELSES_CONVO, null),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(part.update).not.toHaveBeenCalled();
  });

  it('leave: non-participant gets 404, no conversation lookup happens', async () => {
    await expect(
      service.leave(NON_PARTICIPANT, SOMEONE_ELSES_CONVO),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Conversation type check should not run for a non-participant.
    expect(conv.findByPk).not.toHaveBeenCalled();
    expect(part.update).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────
  // Message-level: deleting someone else's message.
  //
  // Note: deleteOwnMessage does not go through assertParticipant — it
  // checks senderId === userId directly (so a user might not even be a
  // current participant if they once sent a message). The IDOR rule
  // there is the 403 on senderId mismatch, asserted in the main spec.
  // We re-verify here that fetching a message you didn't send doesn't
  // mutate state.
  // ──────────────────────────────────────────────────────────────────

  it('deleteOwnMessage: 403 when caller is not the sender, no mutation', async () => {
    const update = jest.fn();
    msg.findByPk.mockResolvedValue({
      id: SOMEONE_ELSES_MESSAGE,
      senderId: 'someone-else',
      deletedAt: null,
      kind: MessageKind.TEXT,
      body: 'secret',
      createdAt: new Date(),
      update,
    });
    await expect(
      service.deleteOwnMessage(NON_PARTICIPANT, SOMEONE_ELSES_MESSAGE),
    ).rejects.toMatchObject({ status: 403 });
    expect(update).not.toHaveBeenCalled();
  });
});
