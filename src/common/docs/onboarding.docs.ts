import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

/** The welcome flow state, as `GET /users/me/onboarding` and `GET /users/me` send it. */
export const onboardingStateExample = {
  flowVersion: 1,
  role: null,
  steps: {
    ROLE: null,
    INTERESTS: null,
    LEVEL: null,
    COACH_CATEGORIES: null,
    COACH_DETAILS: null,
  },
  flow: ['ROLE', 'INTERESTS', 'LEVEL'],
  trainCard: [],
  coachCard: [],
  interestIds: [],
  fitnessLevel: null,
  coachCategoryIds: [],
};

const stateResponse = (description: string) => ({
  status: 200,
  description,
  example: onboardingStateExample,
});

export const OnboardingDocs = {
  getState: {
    summary: 'Where the caller is in the welcome flow',
    description:
      '`flow` is what to ask now, in order; empty means go straight in. ' +
      '`trainCard` and `coachCard` are the steps the Train home and the ' +
      'coach home offer as a card. `steps` says what became of each step ' +
      '(null is still pending). A coach is never asked `ROLE`, and their ' +
      'own training waits on the Train card instead of the flow.',
    auth: true,
    responses: [
      stateResponse('Onboarding state'),
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  answerRole: {
    summary: 'Answer "How will you use MotionHive?"',
    description:
      '`COACH` gives the caller a coach profile and the INSTRUCTOR role ' +
      '(as Become a coach does); `TRAIN` only records the answer. Either ' +
      'way `ROLE` is done. Returns the new state, whose `flow` goes on ' +
      'with that role.',
    auth: true,
    responses: [
      stateResponse('Role saved'),
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  setInterests: {
    summary: 'Save the activities the caller likes',
    description:
      'Replaces their activities (goals are left alone). Activity ids ' +
      'only, none of the coaches only ones; an empty list clears them. ' +
      'Marks `INTERESTS` done.',
    auth: true,
    responses: [
      stateResponse('Interests saved'),
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  setLevel: {
    summary: 'Save the caller level and goals',
    description:
      'Sets `fitnessLevel` (null clears it) and replaces their goals ' +
      '(goal ids only). Marks `LEVEL` done.',
    auth: true,
    responses: [
      stateResponse('Level saved'),
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  setCoachCategories: {
    summary: 'Save what a coach coaches',
    description:
      'Coaches only. Replaces their categories (at least one activity; ' +
      'coaches only ones allowed). `otherSpecializations` are added to the ' +
      'profile specializations, blind to case and accents, never replacing ' +
      'them. Marks `COACH_CATEGORIES` done.',
    auth: true,
    responses: [
      stateResponse('Coach categories saved'),
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  setCoachDetails: {
    summary: 'Save where a coach works and whether they take clients',
    description:
      'Coaches only. City and country go on the account (the country is ' +
      'locked once a payout account exists), `isAcceptingClients` on the ' +
      'coach profile. Only the fields sent are saved. Marks ' +
      '`COACH_DETAILS` done.',
    auth: true,
    responses: [
      stateResponse('Coach details saved'),
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  skip: {
    summary: 'Skip welcome flow steps',
    description:
      'Steps passed over, or every step left when the flow is closed. ' +
      'They leave `flow` and wait on a Home card. A step already done or ' +
      'dismissed is left as it is.',
    auth: true,
    responses: [
      stateResponse('Steps skipped'),
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  dismiss: {
    summary: 'Close a Home card for good',
    description:
      'The steps of a closed card are never offered again. A step already ' +
      'done stays done; answering one later still marks it done.',
    auth: true,
    responses: [
      stateResponse('Steps dismissed'),
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,
};
