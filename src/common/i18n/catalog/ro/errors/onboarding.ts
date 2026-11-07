import type { Catalog } from '../..';

export const onboarding: Catalog['errors']['onboarding'] = {
  unknownCategory: 'Una dintre categoriile alese nu există.',
  coachesOnlyCategory: 'Categoria aceasta o oferă antrenorii. Alege alta.',
  coachRequired: 'Doar antrenorii își pot alege ce antrenează.',
  coachCategoryRequired: 'Alege cel puțin un lucru pe care îl antrenezi.',
};
