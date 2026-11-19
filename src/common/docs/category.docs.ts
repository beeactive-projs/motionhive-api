import { ApiEndpointOptions } from '../decorators/api-response.decorator';

const categoryExample = {
  id: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
  slug: 'strength',
  kind: 'ACTIVITY',
  name: 'Antrenament de forță',
  originalName: 'Strength training',
  icon: 'barbell-outline',
  displayOrder: 1,
  coachesOnly: false,
};

export const CategoryDocs = {
  list: {
    summary: 'The category list: activities and goals',
    description:
      'What people train (`ACTIVITY`) and why (`GOAL`), activities first, ' +
      'each kind in `displayOrder`. Names are in the reader language ' +
      '(`originalName` carries the English one when it differs). ' +
      '`coachesOnly` ones (nutrition) are offered by coaches and never ' +
      'picked as an interest. Open to guests: Discover filters by them ' +
      '(`categoryIds` on the coach, group and session lists).',
    auth: false,
    responses: [
      { status: 200, description: 'Categories', example: [categoryExample] },
    ],
  } as ApiEndpointOptions,
};
