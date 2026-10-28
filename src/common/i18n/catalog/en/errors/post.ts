export const post = {
  notFound: 'Post not found.',
  commentNotFound: 'Comment not found.',
  duplicateGroups: 'You picked the same group more than once.',
  groupsNotFound: 'One or more groups were not found.',
  cannotPostNotMember:
    "You can't post in {group} because you are not a member.",
  membersCannotPost: 'Only the owner and moderators can post in {group}.',
  onlyAuthorCanEdit: 'Only the author can edit this post.',
  nothingToUpdate: 'Nothing to update.',
  alreadyReviewed:
    '{state, select, APPROVED {This post is already approved.} REJECTED {This post is already rejected.} other {This post has already been reviewed.}}',
  replyTargetNotFound: "We couldn't find the comment you're replying to.",
  cannotReplyToReply:
    "You can't reply to a reply. Reply to the original comment instead.",
  notGroupMember: 'You are not a member of this group.',
  staffOnly: 'Only the group owner and moderators can do this.',
  notVisible: 'This post is not visible to you.',
};
