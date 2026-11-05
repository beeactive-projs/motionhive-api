/**
 * API Documentation for Post endpoints
 */

import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const PostDocs = {
  uploadImage: {
    summary: 'Upload a post image',
    description:
      'Accepts a single image under the `file` form field. Max 5 MB, image MIME types only. ' +
      'Returns the public URL + storage key. Caller appends the URL to mediaUrls before POST /posts.',
    auth: true,
    responses: [
      { status: 200, description: 'Image uploaded' },
      { status: 400, description: 'No file, wrong type, or too large' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  createPost: {
    summary: 'Create a post (fans out to N groups)',
    description:
      'Creates one independent post per group in `groupIds` (1–9). Each post owns its own ' +
      'comments, reactions, and image copies — same content, separate threads. The author must ' +
      'be an active member of every target group. Per-group policy applies: OWNER/MODERATOR ' +
      'posts always go through; MEMBER posts are blocked when memberPostPolicy=DISABLED, are ' +
      'immediately visible when OPEN, and land in PENDING when APPROVAL_REQUIRED. Returns ' +
      '`{ posts: FeedItem[] }` — one item per group, in the order of `groupIds`.',
    auth: true,
    responses: [
      { status: 201, description: 'Posts created' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  getMyFeed: {
    summary: "Aggregated feed across the caller's groups",
    description:
      'Paginated APPROVED posts from every group the caller is an active ' +
      'member of, sorted by `postedAt` DESC. Each item includes ' +
      '`group: { id, name, logoUrl }` so the FE can label which group ' +
      'a post came from. Returns an empty page when the caller has no ' +
      'memberships.',
    auth: true,
    responses: [
      { status: 200, description: 'Feed listed' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  getGroupFeed: {
    summary: 'List approved posts for a group',
    description:
      'Paginated feed of APPROVED, non-deleted posts for the given group. Caller must be an ' +
      'active member of the group. Sorted newest first. Includes author + reactionCount + ' +
      'commentCount + the caller’s own reaction (if any).',
    auth: true,
    responses: [
      { status: 200, description: 'Posts listed' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  getPost: {
    summary: 'Get a single post by id',
    description:
      'Returns one hydrated post (author, reactionCount, commentCount, ' +
      'caller`s own reaction) plus its `group` association so the FE can ' +
      'render group context. Caller must be an active member of the ' +
      'post`s group, and the post must be APPROVED.',
    auth: true,
    responses: [
      { status: 200, description: 'Post returned' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  getGroupPending: {
    summary: 'List pending posts awaiting moderation',
    description:
      'Returns PENDING posts for groups configured with APPROVAL_REQUIRED. ' +
      'Only callable by OWNER/MODERATOR of the group.',
    auth: true,
    responses: [
      { status: 200, description: 'Pending posts listed' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  updatePost: {
    summary: 'Update a post (author only)',
    description:
      'Updates content and/or media on a single post. The post`s group is intentionally ' +
      'immutable — to share to a different group, create a new post.',
    auth: true,
    responses: [
      { status: 200, description: 'Post updated' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  deletePost: {
    summary: 'Delete a post',
    description:
      'Soft-deletes the post (tombstones content, cascades to comments + reactions, purges ' +
      'every stored file in the post folder). Idempotent on already-deleted rows. ' +
      'Callable by the author or by any OWNER/MODERATOR of the post`s group.',
    auth: true,
    responses: [
      { status: 200, description: 'Post deleted' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  moderatePost: {
    summary: 'Approve or reject a pending post',
    description:
      'OWNER/MODERATOR of the post`s group only. APPROVED → post becomes visible. REJECTED → ' +
      'post is destroyed (tombstone + cascade + storage purge). Author is notified either way.',
    auth: true,
    responses: [
      { status: 200, description: 'Decision applied' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  addComment: {
    summary: 'Comment on a post',
    description:
      'Caller must be an active member of the post`s group, and the post must be APPROVED. ' +
      'If `parentCommentId` is supplied, it must point to a root comment — 1 level of nesting ' +
      'is enforced server-side.',
    auth: true,
    responses: [
      { status: 201, description: 'Comment created' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  getComments: {
    summary: 'List comments on a post',
    description:
      'Paginated root comments with their replies hydrated. Same membership requirement as ' +
      'reading the feed.',
    auth: true,
    responses: [
      { status: 200, description: 'Comments listed' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  deleteComment: {
    summary: 'Delete a comment',
    description:
      'Author can always delete their own comment. OWNER/MODERATOR of the post`s group may ' +
      'also delete. Replies to a deleted top-level comment are cascaded.',
    auth: true,
    responses: [
      { status: 200, description: 'Comment deleted' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  toggleReaction: {
    summary: 'Toggle the caller’s reaction on a post',
    description:
      'Adds, switches, or removes the caller’s reaction (V1 only LIKE). Returns the new total ' +
      'reaction count and whether the caller is currently reacted.',
    auth: true,
    responses: [
      { status: 200, description: 'Reaction toggled' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,
};

export const GroupRoleDocs = {
  updateMemberRole: {
    summary: 'Promote or demote a group member (OWNER only)',
    description:
      'Sets a non-owner member’s role to MEMBER or MODERATOR. The OWNER role itself ' +
      'cannot be granted via this endpoint — owner transfer is a separate flow.',
    auth: true,
    responses: [
      { status: 200, description: 'Role updated' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,
};
