import type { Catalog } from '../..';

export const venue: Catalog['errors']['venue'] = {
  notFound: 'Nu am găsit locația.',
  cityRequired: 'Adaugă orașul pentru o locație fizică.',
  invalidCountry: 'Alege o țară validă.',
  coachesOnly: 'Doar antrenorii își pot gestiona locațiile.',
};
