import {
  OnboardingRole,
  OnboardingStep,
  OnboardingStepStatus,
} from './entities/onboarding.enums';

/**
 * The welcome flow's version. Stored on every step row, so a later version
 * can add a question that only the people who have not seen it are asked.
 */
export const ONBOARDING_FLOW_VERSION = 1;

/** The steps of someone who trains: what, then how far along and why. */
export const TRAINING_STEPS: readonly OnboardingStep[] = [
  OnboardingStep.Interests,
  OnboardingStep.Level,
];

/** The steps of a coach: what they coach, then where and whether they take clients. */
export const COACH_STEPS: readonly OnboardingStep[] = [
  OnboardingStep.CoachCategories,
  OnboardingStep.CoachDetails,
];

export const ALL_STEPS: readonly OnboardingStep[] = [
  OnboardingStep.Role,
  ...TRAINING_STEPS,
  ...COACH_STEPS,
];

export interface OnboardingFlowInput {
  /** Holds the INSTRUCTOR role. */
  isCoach: boolean;
  /** The person's step rows: what became of each step so far. */
  statuses: Partial<Record<OnboardingStep, OnboardingStepStatus>>;
}

export interface OnboardingFlow {
  /** COACH for a coach, TRAIN once the role question was answered, else null. */
  role: OnboardingRole | null;
  /** Every step with what became of it; null is still pending. */
  steps: Record<OnboardingStep, OnboardingStepStatus | null>;
  /**
   * The welcome flow to show now, in order. Empty means nothing to ask: the
   * app goes straight in. Only pending steps; a skipped one waits on a card.
   */
  flow: OnboardingStep[];
  /** Steps the Train home offers as a card ("Tell us what you like"). */
  trainCard: OnboardingStep[];
  /** Steps the coach home offers as a card ("Finish your coach profile"). */
  coachCard: OnboardingStep[];
}

/**
 * Works out what the apps should ask a person, from their role and what
 * became of each step. Pure, so the rules are tested without a database:
 *
 * - The role question is asked once, and never of a coach (they answered it
 *   by becoming one, whichever way they did).
 * - Someone who trains is asked their interests, then level and goals.
 *   Until they answer the role question that is the path they are on.
 * - A coach is asked what they coach, then their details. Their own
 *   training is never in the flow: it waits on a card in Train mode.
 * - A skipped step leaves the flow and waits on a Home card. Closing that
 *   card dismisses it for good. A done step is never asked again.
 */
export function computeOnboardingFlow(
  input: OnboardingFlowInput,
): OnboardingFlow {
  const steps = {} as Record<OnboardingStep, OnboardingStepStatus | null>;
  for (const step of ALL_STEPS) {
    const status = input.statuses[step];
    if (status) {
      steps[step] = status;
    } else {
      steps[step] = null;
    }
  }

  const isPending = (step: OnboardingStep) => steps[step] === null;
  const isSkipped = (step: OnboardingStep) =>
    steps[step] === OnboardingStepStatus.Skipped;

  let role: OnboardingRole | null = null;
  if (input.isCoach) {
    role = OnboardingRole.Coach;
  } else if (steps[OnboardingStep.Role] === OnboardingStepStatus.Done) {
    role = OnboardingRole.Train;
  }

  const flow: OnboardingStep[] = [];
  let trainCard: OnboardingStep[] = [];
  let coachCard: OnboardingStep[] = [];

  if (input.isCoach) {
    flow.push(...COACH_STEPS.filter(isPending));
    coachCard = COACH_STEPS.filter(isSkipped);
    // A coach's own training waits in Train mode, pending or skipped alike.
    trainCard = TRAINING_STEPS.filter(
      (step) => isPending(step) || isSkipped(step),
    );
  } else {
    if (isPending(OnboardingStep.Role)) {
      flow.push(OnboardingStep.Role);
    }
    flow.push(...TRAINING_STEPS.filter(isPending));
    trainCard = TRAINING_STEPS.filter(isSkipped);
  }

  return { role, steps, flow, trainCard, coachCard };
}
