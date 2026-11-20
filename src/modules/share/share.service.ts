import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SHARE_TARGETS } from './share-targets';
import {
  ShareCard,
  ShareCardState,
  ShareRef,
  ShareTargetType,
  shareKey,
  unavailableCard,
} from './share.types';

/**
 * The share registry: whether a thing may be sent right now, and the card
 * each reader sees for it. Cards hold public fields only and are the same
 * for every reader, so one resolution serves a whole page of messages,
 * a group chat, and later a link opened outside the app.
 */
@Injectable()
export class ShareService {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * The cards for these refs, keyed by `shareKey`. One query per type
   * present, whatever the number of refs; a ref that matches nothing gets
   * the UNAVAILABLE card.
   */
  async cardsFor(refs: ShareRef[]): Promise<Map<string, ShareCard>> {
    const cards = new Map<string, ShareCard>();
    const idsByType = new Map<ShareTargetType, Set<string>>();
    for (const ref of refs) {
      const ids = idsByType.get(ref.type) ?? new Set<string>();
      ids.add(ref.id);
      idsByType.set(ref.type, ids);
    }

    const now = new Date();
    await Promise.all(
      [...idsByType.entries()].map(async ([type, ids]) => {
        const target = SHARE_TARGETS[type];
        const rows = await this.sequelize.query<Record<string, unknown>>(
          target.sql,
          { replacements: { ids: [...ids] }, type: QueryTypes.SELECT },
        );
        for (const row of rows) {
          cards.set(
            shareKey({ type, id: String(row.id).trim() }),
            target.toCard(row, now),
          );
        }
      }),
    );

    for (const ref of refs) {
      const key = shareKey(ref);
      if (!cards.has(key)) {
        cards.set(key, unavailableCard(ref.type));
      }
    }
    return cards;
  }

  /** The card, when this may be sent right now (public and not over); else null. */
  async shareableCard(ref: ShareRef): Promise<ShareCard | null> {
    const card = (await this.cardsFor([ref])).get(shareKey(ref)) ?? null;
    if (card?.state !== ShareCardState.Available) {
      return null;
    }
    return card;
  }
}
