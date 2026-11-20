/**
 * Errors that are not about any one module: the generic answers for a
 * status, the ownership helper's defaults, and form validation.
 */
export const common = {
  badRequest: 'The request could not be processed.',
  unauthorized: 'Please sign in again.',
  forbidden: "You don't have access to this.",
  notFound: "We couldn't find what you were looking for.",
  conflict: 'This conflicts with something that already exists.',
  tooLarge: 'The file is too large.',
  resourceNotFound: 'Resource not found.',
  notOwner: 'You do not own this resource.',
  /** A form field failed a rule that has no message of its own. */
  invalidInput: 'Some of the details are not valid. Check them and try again.',
  /** The route needs a coach (INSTRUCTOR) role. */
  coachesOnly: 'Only coaches can do this.',
  /** A write support may not make while signed in as someone (admin impersonation). */
  notWhileImpersonating:
    "Support can't do this while signed in as someone. The person has to do it themselves.",
  noFile: 'No file provided.',
  imageOnly: 'Only image files are accepted.',
  fileTooLarge: 'File is larger than {maxMb} MB.',
  imageUploadFailed: "We couldn't upload the image. Try again.",
  /** A post points at an image that was not uploaded through our upload route. */
  imageNotUploaded:
    'One of the images was not uploaded correctly. Upload it again.',
  disposableEmail:
    "We can't accept temporary email addresses. Please use a personal or work email.",
  emailCannotReceive:
    'This email address cannot receive mail (the domain has no mail server). Please check for typos.',
};
