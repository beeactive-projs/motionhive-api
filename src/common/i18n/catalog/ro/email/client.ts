import type { Catalog } from '../..';

export const client: Catalog['email']['client'] = {
  invitationNewUser: {
    subject: '{name} te-a invitat pe MotionHive',
    preheader: '{name} te-a invitat pe MotionHive',
    eyebrow: 'INVITAȚIE',
    heading: 'Ai primit o invitație!',
    subheading: '{name} te invită pe MotionHive ca să te antreneze',
    personRole: 'Antrenor',
    body: '**{name}** îți propune să te antreneze și te invită să-ți faci cont pe MotionHive.',
    messageQuote: '„{message}”',
    messageLine: 'Mesaj: „{message}”',
    cta: 'Fă-ți cont pe MotionHive',
    security:
      'Dacă ai deja cont, intră în cont și invitația te așteaptă acolo.',
  },
  invitationExistingUser: {
    subject: '{name} vrea să te adauge printre clienții săi pe MotionHive',
    preheader: '{name} vrea să te adauge printre clienții săi pe MotionHive',
    eyebrow: 'INVITAȚIE',
    greeting: '{recipient, select, null {Salut,} other {Salut, {recipient},}}',
    heading: '{name} îți propune să te antreneze',
    personRole: 'Antrenor',
    body: '**{name}** vrea să te adauge printre clienții săi pe MotionHive. Dacă accepți, puteți gestiona împreună, în aplicație, sesiunile, abonamentele și facturile.',
    messageQuote: '„{message}”',
    messageLine: 'Mesaj: „{message}”',
    cta: 'Vezi invitația',
    security:
      'Dacă nu te așteptai la această invitație, poți ignora emailul sau o poți refuza din contul tău.',
  },
  invitationImported: {
    subject: '{name} te-a adăugat printre clienții săi pe MotionHive',
    preheader: '{name} te invită să vă antrenați împreună pe MotionHive.',
    eyebrow: 'INVITAȚIE',
    greeting: '{recipient, select, null {Salut,} other {Salut, {recipient},}}',
    heading: '{name} este acum pe MotionHive',
    personRole: 'Antrenor',
    bodyNew:
      '**{name}** te-a adăugat printre clienții săi pe MotionHive. Fă-ți cont și sunteți conectați imediat. Programele, sesiunile și mesajele voastre vor fi toate într-un singur loc.',
    bodyExisting:
      '**{name}** te-a adăugat printre clienții săi pe MotionHive. Acceptă cererea și veți avea programele, sesiunile și mesajele într-un singur loc.',
    messageQuote: '„{message}”',
    messageLine: 'Mesaj: „{message}”',
    ctaNew: 'Antrenează-te cu {name} pe MotionHive',
    ctaExisting: 'Vezi cererea',
    expiry: 'Invitația este valabilă 30 de zile.',
    why: 'Primești acest email pentru că {name} ți-a adăugat adresa în lista sa de clienți. Dacă nu știi cine este, poți ignora acest email.',
  },
  requestToInstructor: {
    subject: '{name} vrea să se antreneze sub îndrumarea ta',
    preheader: '{name} vrea să se antreneze sub îndrumarea ta',
    eyebrow: 'CERERE NOUĂ',
    greeting: '{recipient, select, null {Salut,} other {Salut, {recipient},}}',
    heading: 'Ai o cerere nouă',
    personRole: 'Ți-a trimis o cerere',
    body: '**{name}** vrea să se antreneze sub îndrumarea ta.',
    messageQuote: '„{message}”',
    messageLine: 'Mesaj: „{message}”',
    cta: 'Vezi cererea',
  },
  requestAccepted: {
    greeting: '{recipient, select, null {Salut,} other {Salut, {recipient},}}',
    cta: 'Deschide MotionHive',
    client: {
      subject: '{name} a acceptat să te antreneze',
      preheader: '{name} a acceptat să te antreneze',
      eyebrow: 'CERERE ACCEPTATĂ',
      heading: 'Cererea ta a fost acceptată',
      personRole: 'Antrenorul tău',
      body: '**{name}** a acceptat să te antreneze. De acum puteți gestiona împreună, în aplicație, sesiunile, abonamentele și facturile.',
    },
    instructor: {
      subject: '{name} ți-a acceptat invitația pe MotionHive',
      preheader: '{name} ți-a acceptat invitația pe MotionHive',
      eyebrow: 'INVITAȚIE ACCEPTATĂ',
      heading: 'Invitație acceptată',
      personRole: 'Client nou',
      body: '**{name}** ți-a acceptat invitația și face acum parte dintre clienții tăi. De acum puteți gestiona împreună, în aplicație, sesiunile, abonamentele și facturile.',
    },
  },
  requestDeclined: {
    greeting: '{recipient, select, null {Salut,} other {Salut, {recipient},}}',
    client: {
      subject: 'Ai primit un răspuns la cererea ta de pe MotionHive',
      preheader: 'Ai primit un răspuns la cererea ta de pe MotionHive',
      heading: 'Răspuns la cererea ta',
      body: '**{name}** nu îți poate accepta cererea în acest moment.',
      note: 'Când vrei, poți căuta alți antrenori pe MotionHive.',
    },
    instructor: {
      subject: 'Ai primit un răspuns la invitația ta de pe MotionHive',
      preheader: 'Ai primit un răspuns la invitația ta de pe MotionHive',
      heading: 'Răspuns la invitația ta',
      body: '**{name}** ți-a refuzat invitația.',
      note: 'Poți invita oricând alți clienți.',
    },
  },
  collaborationEnded: {
    heading: 'Nu vă mai antrenați împreună',
    client: {
      self: {
        subject: 'Nu te mai antrenezi cu {name}',
        body: '{recipient, select, null {Salut!} other {Salut, {recipient}!}} Ai ales să nu te mai antrenezi cu **{name}** pe MotionHive. Nu mai apare în lista ta de antrenori și nu te mai poate invita la sesiuni.',
      },
      other: {
        subject: '{name} nu te mai antrenează',
        body: '{recipient, select, null {Salut!} other {Salut, {recipient}!}} **{name}** a ales să nu te mai antreneze pe MotionHive. Nu mai apare în lista ta de antrenori.',
      },
      membershipNote:
        'Dacă ai un abonament activ, el rămâne activ până când îl anulezi din profilul tău, din secțiunea Abonamente.',
      reconnect: 'Poți relua oricând legătura trimițând o cerere nouă.',
      footerNote:
        'Primești acest email pentru că s-a schimbat lista ta de antrenori de pe MotionHive.',
    },
    instructor: {
      self: {
        subject: '{name} nu mai face parte dintre clienții tăi',
        body: '{recipient, select, null {Salut!} other {Salut, {recipient}!}} Ai ales să nu mai continui antrenamentele cu **{name}** pe MotionHive. Nu mai apare în lista ta de clienți și nu mai poate vedea sesiunile tale doar pentru clienți.',
      },
      other: {
        subject: '{name} nu se mai antrenează cu tine',
        body: '{recipient, select, null {Salut!} other {Salut, {recipient}!}} **{name}** a ales să nu se mai antreneze cu tine pe MotionHive. Nu mai apare în lista ta de clienți.',
      },
      membershipNote:
        'Abonamentele active dintre voi rămân valabile până când le anulează unul dintre voi. Faptul că nu vă mai antrenați împreună nu le anulează automat.',
      reconnect: 'Poți relua oricând legătura trimițând o invitație nouă.',
      footerNote:
        'Primești acest email pentru că s-a schimbat lista ta de clienți de pe MotionHive.',
    },
  },
};
