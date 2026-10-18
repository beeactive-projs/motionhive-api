import type { Catalog } from '../..';

export const group: Catalog['notifications']['group'] = {
  memberLeft: {
    title: 'Un membru a părăsit grupul',
    body: '{name, select, null {Un membru} other {{name}}} a părăsit {group, select, null {grupul tău} other {grupul „{group}”}}.',
  },
  memberRemoved: {
    title: 'Nu mai faci parte dintr-un grup',
    body: 'Administratorul te-a scos {group, select, null {dintr-un grup} other {din grupul „{group}”}}.',
  },
  closed: {
    title: 'Un grup a fost închis',
    body: '{group, select, null {Un grup din care făceai parte} other {Grupul „{group}”}} a fost închis, pentru că persoana care îl conducea a părăsit MotionHive.',
  },
  joinRequestReceived: {
    title: 'Cerere nouă de intrare în grup',
    body: '{name, select, null {Cineva} other {{name}}} vrea să intre în {group, select, null {grupul tău} other {grupul „{group}”}}.',
  },
  joinRequestApproved: {
    title: 'Cererea ta a fost aprobată',
    body: 'Faci parte acum din {group, select, null {grup} other {grupul „{group}”}}.',
  },
  joinRequestRejected: {
    title: 'Cererea ta nu a fost aprobată',
    body: 'Administratorul nu ți-a aprobat cererea de a intra în {group, select, null {grup} other {grupul „{group}”}}.',
  },
  ownershipReceived: {
    title: 'Ești acum administratorul grupului',
    body: 'Ți-a fost predată administrarea {group, select, null {grupului} other {grupului „{group}”}}.',
  },
  ownershipTransferred: {
    title: 'Ai predat administrarea grupului',
    body: 'Ai predat administrarea {group, select, null {grupului} other {grupului „{group}”}}.',
  },
  invitationReceived: {
    title: 'Ai primit o invitație într-un grup',
    body: '{name, select, null {Cineva} other {{name}}} te invită {group, select, null {într-un grup} other {în grupul „{group}”}}.',
  },
  invitationAccepted: {
    title: 'Invitație acceptată',
    body: '{name, select, null {Cineva} other {{name}}} ți-a acceptat invitația în {group, select, null {grupul tău} other {grupul „{group}”}}.',
  },
  invitationDeclined: {
    title: 'Invitație refuzată',
    body: '{name, select, null {Cineva} other {{name}}} ți-a refuzat invitația în {group, select, null {grupul tău} other {grupul „{group}”}}.',
  },
  roleChanged: {
    title: 'Rolul tău în grup s-a schimbat',
    body: 'Ești acum {role, select, OWNER {administrator} MODERATOR {moderator} other {membru obișnuit}} în {group, select, null {grup} other {grupul „{group}”}}.',
  },
};
