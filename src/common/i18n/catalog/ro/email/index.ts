import type { Catalog } from '../..';
import { account } from './account';
import { auth } from './auth';
import { client } from './client';
import { feedback } from './feedback';
import { group } from './group';
import { invoice } from './invoice';
import { layout } from './layout';
import { social } from './social';
import { subscription } from './subscription';
import { waitlist } from './waitlist';

export const email: Catalog['email'] = {
  account,
  auth,
  client,
  feedback,
  group,
  invoice,
  layout,
  social,
  subscription,
  waitlist,
};
