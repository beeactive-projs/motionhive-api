import type { Catalog } from '../..';

export const exercise: Catalog['notifications']['exercise'] = {
  forked: {
    title: 'Exercițiul tău a fost copiat',
    body: '{name, select, null {Un alt antrenor} other {{name}}} a copiat „{exercise}” în biblioteca sa. {count, plural, one {Este prima copie.} few {Până acum l-au copiat # persoane.} other {Până acum l-au copiat # de persoane.}}',
  },
};
