/**
 * Form-validation messages a person can actually hit. DTOs name these
 * as their `message` (`message: 'errors.validation.passwordsDoNotMatch'`);
 * any other failed rule answers with `errors.common.invalidInput`.
 */
export const validation = {
  passwordsDoNotMatch: 'Passwords do not match.',
  /** `@Match` with no message of its own. */
  valuesDoNotMatch: 'The two values do not match.',
  weakPassword:
    'Password must contain at least 8 characters, including uppercase, lowercase, number, and special character (!@#$%^&*...).',
  dateInPast: 'Choose a date and time in the future.',
  invalidEmail: 'Enter a valid email address.',
  invalidCode: 'Enter the 6-digit code from the email.',
  invalidPhone:
    'Enter the phone number with the country code, for example +40712345678.',
  invalidHandle:
    'Your handle can use 3 to 40 lowercase letters, digits, "_" or "-", and must start and end with a letter or digit.',
  invalidPostalCode:
    'Enter a valid postal code (2 to 20 letters, digits, spaces or hyphens).',
  coachNameTooShort: 'Coach name must be at least 2 characters.',
  noteTooLong: 'Note must be 500 characters or fewer.',
  personalMessageTooLong: 'Personal message must be 500 characters or fewer.',
};
