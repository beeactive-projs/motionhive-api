import { computeOnboardingFlow } from './onboarding-flow';
import {
  OnboardingRole,
  OnboardingStep,
  OnboardingStepStatus,
} from './entities/onboarding.enums';

const { Role, Interests, Level, CoachCategories, CoachDetails } =
  OnboardingStep;
const { Done, Skipped, Dismissed } = OnboardingStepStatus;

describe('computeOnboardingFlow', () => {
  it('asks a new person the role, then their interests and level', () => {
    const result = computeOnboardingFlow({ isCoach: false, statuses: {} });

    expect(result.role).toBeNull();
    expect(result.flow).toEqual([Role, Interests, Level]);
    expect(result.trainCard).toEqual([]);
    expect(result.coachCard).toEqual([]);
    expect(result.steps[Role]).toBeNull();
  });

  it('keeps asking the rest after the person picked TRAIN', () => {
    const result = computeOnboardingFlow({
      isCoach: false,
      statuses: { [Role]: Done },
    });

    expect(result.role).toBe(OnboardingRole.Train);
    expect(result.flow).toEqual([Interests, Level]);
  });

  it('never asks a coach the role, and asks the coach steps', () => {
    const result = computeOnboardingFlow({ isCoach: true, statuses: {} });

    expect(result.role).toBe(OnboardingRole.Coach);
    expect(result.flow).toEqual([CoachCategories, CoachDetails]);
    // Their own training waits on the Train home.
    expect(result.trainCard).toEqual([Interests, Level]);
    expect(result.coachCard).toEqual([]);
  });

  it('moves a skipped step out of the flow and onto a card', () => {
    const result = computeOnboardingFlow({
      isCoach: false,
      statuses: { [Role]: Done, [Interests]: Skipped },
    });

    expect(result.flow).toEqual([Level]);
    expect(result.trainCard).toEqual([Interests]);
  });

  it('shows nothing once the flow was closed and the card dismissed', () => {
    const closed = computeOnboardingFlow({
      isCoach: false,
      statuses: { [Role]: Skipped, [Interests]: Skipped, [Level]: Skipped },
    });
    expect(closed.flow).toEqual([]);
    expect(closed.trainCard).toEqual([Interests, Level]);
    // Skipping the role question keeps the person on the training path.
    expect(closed.role).toBeNull();

    const dismissed = computeOnboardingFlow({
      isCoach: false,
      statuses: {
        [Role]: Skipped,
        [Interests]: Dismissed,
        [Level]: Dismissed,
      },
    });
    expect(dismissed.flow).toEqual([]);
    expect(dismissed.trainCard).toEqual([]);
  });

  it('offers a coach their skipped coach steps on the coach home', () => {
    const result = computeOnboardingFlow({
      isCoach: true,
      statuses: {
        [Role]: Done,
        [CoachCategories]: Done,
        [CoachDetails]: Skipped,
        [Interests]: Done,
        [Level]: Dismissed,
      },
    });

    expect(result.flow).toEqual([]);
    expect(result.coachCard).toEqual([CoachDetails]);
    expect(result.trainCard).toEqual([]);
  });

  it('asks nothing of someone who answered everything', () => {
    const result = computeOnboardingFlow({
      isCoach: false,
      statuses: { [Role]: Done, [Interests]: Done, [Level]: Done },
    });

    expect(result.flow).toEqual([]);
    expect(result.trainCard).toEqual([]);
    expect(result.coachCard).toEqual([]);
  });
});
