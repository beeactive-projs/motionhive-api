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

/**
 * Email copy, one file per template folder under `src/common/email/`:
 * `email.<domain>.<template>.<part>`. `layout` is the frame every email
 * shares.
 *
 * Parts are plain text, ICU MessageFormat, one key per full sentence.
 * The only markup is `**bold**`, which the HTML renderer turns into
 * `<strong>` and the plain-text renderer drops (see `emailCopy` in
 * `src/common/email/_layouts/copy.ts`). Never put HTML in here: the
 * renderer escapes everything, so a tag would be shown as text.
 */
export const email = {
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
