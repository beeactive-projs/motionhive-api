import type { Catalog } from '../..';

export const admin: Catalog['errors']['admin'] = {
  notOnYourself: 'Nu poți face asta cu propriul cont.',
  superAdminOnly:
    'Doar un super admin poate modifica un cont de administrator.',
};
