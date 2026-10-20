import { baseLayout, websiteUrl } from './base-layout';

describe('email footer links', () => {
  const original = process.env.PUBLIC_SITE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = original;
  });

  it('points at the production site when nothing says otherwise', () => {
    delete process.env.PUBLIC_SITE_URL;
    expect(websiteUrl()).toBe('https://www.motionhive.fit');
  });

  it('follows PUBLIC_SITE_URL, so a dev email links to the dev site', () => {
    process.env.PUBLIC_SITE_URL = 'https://dev.motionhive.fit/';

    const html = baseLayout('<p>hi</p>', { locale: 'en' });

    expect(html).toContain('https://dev.motionhive.fit/legal/terms-of-service');
    expect(html).toContain('https://dev.motionhive.fit/legal/privacy-policy');
    expect(html).not.toContain('https://www.motionhive.fit');
  });

  it('puts the reader language in the legal links', () => {
    process.env.PUBLIC_SITE_URL = 'https://dev.motionhive.fit';

    const html = baseLayout('<p>salut</p>', { locale: 'ro' });

    expect(html).toContain('https://dev.motionhive.fit/ro/legal/cookie-policy');
  });
});
