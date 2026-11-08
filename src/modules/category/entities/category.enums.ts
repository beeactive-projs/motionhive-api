// Category list enums. const + type pattern (runtime accessible + TypeScript
// narrowing). Keep in sync with migration 081.

/** ACTIVITY is what you do, GOAL is why you train. */
export const CategoryKind = {
  Activity: 'ACTIVITY',
  Goal: 'GOAL',
} as const;
export type CategoryKind = (typeof CategoryKind)[keyof typeof CategoryKind];
