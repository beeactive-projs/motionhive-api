export const messaging = {
  received: {
    title: 'New message from {name, select, null {Someone} other {{name}}}',
    body: '{name, select, null {Someone} other {{name}}}: {preview}',
    cta: 'Open conversation',
  },
  /**
   * Someone the reader isn't connected with wrote. No preview: a
   * stranger's words don't go on a lock screen before the reader chose to
   * read them.
   */
  requestReceived: {
    title: '{name, select, null {Someone} other {{name}}} wants to message you',
    body: 'Open your message requests to read it and decide.',
    cta: 'Open message requests',
  },
  /** A share sent without a caption. `title` is null for translated content. */
  shared: {
    title: 'New message from {name, select, null {Someone} other {{name}}}',
    body: '{name, select, null {Someone} other {{name}}} shared {type, select, SESSION {a session} GROUP {a group} COACH {a coach profile} EXERCISE {an exercise} ROUTINE {a routine} PROGRAM {a program} other {something}}{title, select, null {} other {: {title}}}',
    cta: 'Open conversation',
  },
  /** The reader has turned message previews off in emails. */
  receivedPrivate: {
    title: 'New message from {name, select, null {Someone} other {{name}}}',
    body: '{name, select, null {Someone} other {{name}}} sent you a new message.',
    cta: 'Open conversation',
  },
};
