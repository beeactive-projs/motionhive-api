import { account } from './account';
import { analytics } from './analytics';
import { auth } from './auth';
import { blog } from './blog';
import { client } from './client';
import { common } from './common';
import { exercise } from './exercise';
import { group } from './group';
import { invitation } from './invitation';
import { messaging } from './messaging';
import { notification } from './notification';
import { payment } from './payment';
import { post } from './post';
import { profile } from './profile';
import { progress } from './progress';
import { review } from './review';
import { role } from './role';
import { session } from './session';
import { user } from './user';
import { validation } from './validation';
import { venue } from './venue';
import { workout } from './workout';

/**
 * Error messages the API sends back, one file per module that raises
 * them: `errors.<module>.<name>`. Thrown as
 * `new XxxException(apiError('<module>.<name>', params))`; the global
 * exception filter writes the message in the caller's language.
 * `common` holds the generic ones, `validation` the form messages DTOs
 * name.
 */
export const errors = {
  account,
  analytics,
  auth,
  blog,
  client,
  common,
  exercise,
  group,
  invitation,
  messaging,
  notification,
  payment,
  post,
  profile,
  progress,
  review,
  role,
  session,
  user,
  validation,
  venue,
  workout,
};
