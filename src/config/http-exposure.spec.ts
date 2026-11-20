import { corsOrigins, swaggerEnabled } from './http-exposure';

/** The way the `cors` package reads an origin list: equal string or a matching pattern. */
function allows(origins: (string | RegExp)[], origin: string): boolean {
  return origins.some((allowed) => {
    if (allowed instanceof RegExp) {
      return allowed.test(origin);
    }
    return allowed === origin;
  });
}

describe('swaggerEnabled', () => {
  it('serves the docs on a local run', () => {
    expect(swaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'test' })).toBe(true);
    expect(swaggerEnabled({})).toBe(true);
  });

  it('never serves them in production', () => {
    expect(swaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('never serves them on a Railway deploy, even one left on development', () => {
    expect(
      swaggerEnabled({ NODE_ENV: 'development', RAILWAY_PROJECT_ID: 'p' }),
    ).toBe(false);
    expect(swaggerEnabled({ RAILWAY_ENVIRONMENT_ID: 'e' })).toBe(false);
    expect(swaggerEnabled({ RAILWAY_DEPLOYMENT_ID: 'd' })).toBe(false);
  });

  it('has no switch that turns them on in production', () => {
    expect(
      swaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }),
    ).toBe(false);
  });
});

describe('corsOrigins', () => {
  const production = { NODE_ENV: 'production' };

  it('lets the apps and the phone WebViews in, in production', () => {
    const origins = corsOrigins(production);
    expect(allows(origins, 'https://app.motionhive.fit')).toBe(true);
    expect(allows(origins, 'https://www.motionhive.fit')).toBe(true);
    expect(allows(origins, 'https://admin.motionhive.fit')).toBe(true);
    expect(allows(origins, 'https://dev.app.motionhive.fit')).toBe(true);
    expect(allows(origins, 'capacitor://localhost')).toBe(true);
    expect(allows(origins, 'https://localhost')).toBe(true);
  });

  it('keeps Vercel previews, over https and one label only', () => {
    const origins = corsOrigins(production);
    expect(
      allows(origins, 'https://motionhive-ui-git-feature-x-team.vercel.app'),
    ).toBe(true);
    expect(allows(origins, 'http://motionhive-ui.vercel.app')).toBe(false);
    expect(allows(origins, 'https://evil.vercel.app.example.com')).toBe(false);
    expect(allows(origins, 'https://a.b.vercel.app')).toBe(false);
  });

  it('no longer lets any Railway or Netlify site in', () => {
    const origins = corsOrigins(production);
    expect(allows(origins, 'https://anything.up.railway.app')).toBe(false);
    expect(allows(origins, 'https://anything.netlify.app')).toBe(false);
  });

  it('adds FRONTEND_URL and the DEV_ORIGINS list', () => {
    const origins = corsOrigins({
      ...production,
      FRONTEND_URL: 'https://preview.example.com',
      DEV_ORIGINS: ' http://192.168.1.100:4200 , ,http://localhost:4200',
    });
    expect(allows(origins, 'https://preview.example.com')).toBe(true);
    expect(allows(origins, 'http://192.168.1.100:4200')).toBe(true);
    expect(allows(origins, 'http://localhost:4200')).toBe(true);
    expect(origins).not.toContain('');
  });

  it('keeps localhost out of production unless listed', () => {
    expect(allows(corsOrigins(production), 'http://localhost:4200')).toBe(
      false,
    );
  });

  it('uses the local dev servers elsewhere, ignoring DEV_ORIGINS', () => {
    const origins = corsOrigins({
      NODE_ENV: 'development',
      DEV_ORIGINS: 'https://tunnel.example.com',
    });
    expect(allows(origins, 'http://localhost:4200')).toBe(true);
    expect(allows(origins, 'http://localhost:8100')).toBe(true);
    expect(allows(origins, 'capacitor://localhost')).toBe(true);
    expect(allows(origins, 'https://tunnel.example.com')).toBe(false);
    expect(allows(origins, 'https://app.motionhive.fit')).toBe(false);
  });
});
