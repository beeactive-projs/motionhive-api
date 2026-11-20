export const messaging = {
  conversationNotFound: 'Conversation not found.',
  messageNotFound: 'Message not found.',
  userNotFound: 'User not found.',
  cannotMessageSelf: 'Cannot send a message to yourself.',
  emptyMessage: 'Your message is empty. Write something before sending it.',
  suspended: 'Your messaging has been restricted. Contact support.',
  newAccountLimited:
    'New accounts can only message people they train with, or people who wrote to them first.',
  connectionsOnly:
    'This person only takes messages from people they train with.',
  requestWaiting:
    'Your message request is waiting. You can write more once {name, select, null {they accept} other {{name} accepts}}.',
  requestLimit:
    "You've started a lot of new conversations today. Try again tomorrow.",
  notARequest: 'This chat is not a message request.',
  acceptRequestFirst: 'Accept this message request first.',
  notShareable:
    "This can't be sent. Only things anyone can see can be shared, and a session only until it ends.",
  tooManyMessages:
    'You can send up to {max, plural, one {# message} other {# messages}} a minute. Wait a moment and try again.',
  tooManyMessagesInConversation:
    'Too many messages in this conversation. Wait a moment and try again.',
  youBlockedThem: 'You blocked this person. Unblock them to send a message.',
  cannotLoadOlderMessages:
    "We couldn't load older messages. Refresh the conversation and try again.",
  invalidDate: 'Choose a valid date and time.',
  cannotLeaveDirect:
    'Cannot leave a direct conversation. Block the other user instead.',
  cannotDeleteOthersMessage: 'You can only delete your own messages.',
  cannotBlockSelf: 'You cannot block yourself.',
  alreadyBlocked: 'You have already blocked this user.',
  notBlocked: "You haven't blocked this user.",
  reportTargetRequired: 'Choose a message or a conversation to report.',
  cannotReportSelf: 'You cannot report your own messages.',
  reportAlreadyOpen:
    'You already have an open report against this user. Our team will review it.',
  cannotReportSystemMessage: 'Cannot report a system message.',
  reportSpecificMessage:
    'For group conversations, please report a specific message.',
  reportTargetUnclear:
    "We couldn't tell who to report in this conversation. Report a specific message instead.",
};
