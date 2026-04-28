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
      'Returns the Cloudinary secure URL + public ID. Caller appends the URL to mediaUrls before POST /posts.',
    auth: true,
    responses: [
      { status: 200, description: 'Image uploaded' },
      { status: 400, description: 'No file, wrong type, or too large' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  createPost: {
    summary: 'Create a post',
    description:
      'Creates a post in one or more groups (1–9). The author must be an active member of every ' +
      'target group. Per-group policy applies: OWNER/MODERATOR posts always go through; MEMBER ' +
      'posts are blocked when the group has memberPostPolicy=DISABLED, are immediately visible ' +
      'when OPEN, and land in PENDING approval state when APPROVAL_REQUIRED.',
    auth: true,
    responses: [
      { status: 201, description: 'Post created' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
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
      'Updates content and/or media. Audience (group list) is intentionally immutable post-creation.',
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
    summary: 'Delete a post — selectively per group, or everywhere',
    description:
      'If `groupIds` is omitted the post is removed from all audiences and the post itself ' +
      'is soft-deleted. If `groupIds` is provided only those audiences are removed; the post ' +
      'is auto-deleted when its last active audience is removed. Author may target any of ' +
      'their groups; OWNER/MODERATOR may only target groups they moderate.',
    auth: true,
    responses: [
      { status: 200, description: 'Post / audiences removed' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  moderatePost: {
    summary: 'Approve or reject a pending post for a specific group',
    description:
      'OWNER/MODERATOR-only. Approves the audience entry (post becomes visible in that group) ' +
      'or rejects it (audience entry is soft-deleted). Sends the post author a notification.',
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
      'Caller must be an active member of at least one APPROVED audience group on the post. ' +
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
      'Author can always delete their own comment. OWNER/MODERATOR of any audience group ' +
      'on the parent post may also delete.',
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
