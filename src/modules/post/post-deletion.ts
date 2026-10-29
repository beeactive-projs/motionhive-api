import type { Transaction } from 'sequelize';

import type { Post } from './entities/post.entity';
import type { PostComment } from './entities/post-comment.entity';
import type { PostReaction } from './entities/post-reaction.entity';

/**
 * Tombstone written into post/comment `content` when the row is
 * soft-deleted, so the plaintext doesn't sit in the DB after delete.
 * The row itself is kept (paranoid: true) for audit; the body is gone.
 */
export const DELETED_CONTENT_TOMBSTONE = '[deleted]';

/** The tables a post's deletion reaches besides the post itself. */
export interface PostChildModels {
  comment: typeof PostComment;
  reaction: typeof PostReaction;
}

/**
 * Inside-transaction cleanup when a post is being soft-deleted in full.
 *
 * Tombstones plaintext on the post, cascades the same treatment to its
 * comments (paranoid: true on PostComment), and hard-deletes its
 * reactions (paranoid: false — no content to retain). Shared by a
 * deletion in the post module and a workout takedown (WorkoutModule
 * cannot inject PostService: PostModule imports it).
 */
export async function destroyPostFully(
  post: Post,
  models: PostChildModels,
  tx: Transaction,
): Promise<void> {
  const postId = post.id;
  await models.comment.update(
    { content: DELETED_CONTENT_TOMBSTONE },
    { where: { postId }, transaction: tx },
  );
  await models.comment.destroy({ where: { postId }, transaction: tx });
  await models.reaction.destroy({ where: { postId }, transaction: tx });
  await post.update(
    { content: DELETED_CONTENT_TOMBSTONE, mediaUrls: null },
    { transaction: tx },
  );
  await post.destroy({ transaction: tx });
}
