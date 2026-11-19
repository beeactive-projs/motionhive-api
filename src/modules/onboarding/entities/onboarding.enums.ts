// Onboarding domain enums: the welcome flow. const + type pattern (runtime
// accessible + TypeScript narrowing). Keep in sync with migration 081. The
// category list's own enum is in category/entities/category.enums.ts.

/**
 * The welcome flow's steps. A trainee's flow is ROLE, INTERESTS, LEVEL; a
 * coach's is ROLE, COACH_CATEGORIES, COACH_DETAILS, with their own training
 * (INTERESTS, LEVEL) offered later as a card in Train mode.
 */
export const OnboardingStep = {
  Role: 'ROLE',
  Interests: 'INTERESTS',
  Level: 'LEVEL',
  CoachCategories: 'COACH_CATEGORIES',
  CoachDetails: 'COACH_DETAILS',
} as const;
export type OnboardingStep =
  (typeof OnboardingStep)[keyof typeof OnboardingStep];

/**
 * What became of a step, once something did. A step with no row is still
 * pending. SKIPPED leaves it to be offered again as a Home card; DISMISSED
 * (the card was closed) means never again.
 */
export const OnboardingStepStatus = {
  Done: 'DONE',
  Skipped: 'SKIPPED',
  Dismissed: 'DISMISSED',
} as const;
export type OnboardingStepStatus =
  (typeof OnboardingStepStatus)[keyof typeof OnboardingStepStatus];

/** The answer to "How will you use MotionHive?". */
export const OnboardingRole = {
  Train: 'TRAIN',
  Coach: 'COACH',
} as const;
export type OnboardingRole =
  (typeof OnboardingRole)[keyof typeof OnboardingRole];
