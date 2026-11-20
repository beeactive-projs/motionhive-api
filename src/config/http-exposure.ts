/**
 * What the API shows to the outside world beyond its routes: the Swagger
 * page and the browser origins CORS lets read its answers. Kept out of
 * main.ts so the rules can be tested.
 */

type Env = Record<string, string | undefined>;

/**
 * The apps' own addresses (web, marketing site, admin, each with its dev
 * deploy) and the Capacitor WebView origins of the phone apps.
 */
const PRODUCTION_ORIGINS: readonly string[] = [
  'https://motionhive.fit',
  'https://www.motionhive.fit',
  'https://app.motionhive.fit',
  'https://dev.motionhive.fit',
  'https://dev.app.motionhive.fit',
  'https://app-dev.motionhive.fit',
  'https://admin.motionhive.fit',
  'https://admin-dev.motionhive.fit',
  'https://dev.admin.motionhive.fit',
  // Capacitor WebView origins (mobile app): iOS / Android
  'capacitor://localhost',
  'https://localhost',
];

/**
 * Vercel preview deploys of the apps. The web app sends a preview to the
 * production API unless its host names the develop branch (core
 * `environment.ts`, `isDevHost`), so dropping this would break previews.
 * One https label only: `https://evil.vercel.app.example.com` and plain
 * http do not match. Anyone can still own a `*.vercel.app` host, which is
 * why CORS sends no credentials: the apps authenticate with a bearer token
 * the page itself holds, so another site's page can read only what an
 * anonymous request could.
 */
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

const DEVELOPMENT_ORIGINS: readonly string[] = [
  'http://localhost:4200',
  'http://localhost:4203', // admin app
  'http://localhost:3000',
  'http://localhost:8100',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1:4200',
  'http://127.0.0.1:4203', // admin app
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8100',
  // The Capacitor app is not served over http — its WebView has its own
  // origin, and without these the browser discards every reply as
  // cross-origin. The symptom is not a network error: the request
  // succeeds, the response is thrown away, and a login looks like wrong
  // credentials.
  'capacitor://localhost', // iOS
  'https://localhost', // Android, Capacitor 6+ default androidScheme
  'http://localhost', // Android, androidScheme 'http'
  'ionic://localhost', // iOS, Capacitor 2 and earlier
];

/**
 * Variables Railway puts on every deploy (docs.railway.com/reference/variables).
 * Any of them means the API is hosted, whatever NODE_ENV says: NODE_ENV
 * falls back to 'development' when a service forgets to set it.
 */
const RAILWAY_DEPLOY_VARIABLES = [
  'RAILWAY_PROJECT_ID',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_DEPLOYMENT_ID',
] as const;

/**
 * Whether /api/docs is served: on a local run only. Never in production
 * and never on a Railway deploy (dev included), since the page lists every
 * route, the admin ones too. Deliberately no switch to turn it on there.
 */
export function swaggerEnabled(env: Env): boolean {
  if (env.NODE_ENV === 'production') {
    return false;
  }
  for (const name of RAILWAY_DEPLOY_VARIABLES) {
    if (env[name]) {
      return false;
    }
  }
  return true;
}

/**
 * The origins CORS allows. Production: the apps, `FRONTEND_URL`, Vercel
 * previews and the comma-separated `DEV_ORIGINS` (tunnel hosts during a
 * demo, e.g. `DEV_ORIGINS=http://192.168.1.100:4200`). Elsewhere: the
 * local dev servers and WebViews.
 */
export function corsOrigins(env: Env): (string | RegExp)[] {
  if (env.NODE_ENV !== 'production') {
    return [...DEVELOPMENT_ORIGINS];
  }

  const origins: (string | RegExp)[] = [];
  if (env.FRONTEND_URL) {
    origins.push(env.FRONTEND_URL);
  }
  origins.push(...PRODUCTION_ORIGINS, VERCEL_PREVIEW_ORIGIN);

  const extra = env.DEV_ORIGINS;
  if (extra) {
    for (const origin of extra.split(',')) {
      const trimmed = origin.trim();
      if (trimmed) {
        origins.push(trimmed);
      }
    }
  }
  return origins;
}
