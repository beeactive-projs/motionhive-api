import type { Catalog } from '../..';

export const messaging: Catalog['notifications']['messaging'] = {
  received: {
    title:
      '{name, select, null {Ai un mesaj nou} other {Mesaj nou de la {name}}}',
    body: '{name, select, null {Mesaj nou} other {{name}}}: {preview}',
    cta: 'Deschide conversația',
  },
  requestReceived: {
    title:
      '{name, select, null {Cineva vrea să-ți scrie} other {{name} vrea să-ți scrie}}',
    body: 'Deschide solicitările de mesaje ca să citești și să decizi.',
    cta: 'Deschide solicitările',
  },
  shared: {
    title:
      '{name, select, null {Ai un mesaj nou} other {Mesaj nou de la {name}}}',
    body: '{name, select, null {Cineva} other {{name}}} a trimis {type, select, SESSION {o sesiune} GROUP {un grup} COACH {profilul unui antrenor} EXERCISE {un exercițiu} ROUTINE {o rutină} PROGRAM {un program} other {ceva}}{title, select, null {} other {: {title}}}',
    cta: 'Deschide conversația',
  },
  receivedPrivate: {
    title:
      '{name, select, null {Ai un mesaj nou} other {Mesaj nou de la {name}}}',
    body: '{name, select, null {Ai primit un mesaj nou.} other {{name} ți-a trimis un mesaj.}}',
    cta: 'Deschide conversația',
  },
};
