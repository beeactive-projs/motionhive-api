/**
 * ISO 3166-1 alpha-2 country codes supported by Stripe Connect Express.
 *
 * Source: https://docs.stripe.com/connect/cross-border-payouts
 *
 * Used for:
 *   - Validating `user.countryCode` before Stripe Connect onboarding.
 *   - Validating `venue.countryCode` for physical venues.
 *
 * Keep as a frozen Set for O(1) membership checks. If Stripe adds new
 * countries, update here — this is the single source of truth across
 * the API. A country NOT in this list cannot onboard, period.
 */
export const STRIPE_CONNECT_COUNTRY_CODES: ReadonlySet<string> = new Set([
  // EU / EEA
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
  // Non-EU Europe
  'CH',
  'GB',
  'GI',
  'LI',
  'NO',
  // Americas
  'BR',
  'CA',
  'MX',
  'US',
  // APAC
  'AU',
  'HK',
  'JP',
  'MY',
  'NZ',
  'SG',
  'TH',
  // Middle East
  'AE',
]);

/**
 * Loose validator used by DTOs when we accept a country code but don't
 * require Stripe support (e.g. venue address outside a supported
 * country — possible if a Romanian instructor travels to a client
 * abroad). Strict validation against the Connect whitelist happens at
 * the service layer for `user.countryCode`.
 */
export function isValidIsoCountryCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value);
}

/**
 * Strict check for user-level country code (pre-Stripe onboarding).
 */
export function isStripeSupportedCountry(value: string): boolean {
  return STRIPE_CONNECT_COUNTRY_CODES.has(value);
}

/**
 * Stripe's default settlement currency for each Connect country.
 * Used only as a last-resort fallback when `stripe_account.default_currency`
 * is null (e.g. onboarding just started, webhook hasn't synced yet).
 *
 * Lowercase to match Stripe's SDK convention. Keep in sync with
 * Stripe's country→currency table:
 * https://docs.stripe.com/connect/cross-border-payouts
 */
const COUNTRY_DEFAULT_CURRENCY: Record<string, string> = {
  AE: 'aed',
  AT: 'eur',
  AU: 'aud',
  BE: 'eur',
  BG: 'bgn',
  BR: 'brl',
  CA: 'cad',
  CH: 'chf',
  CY: 'eur',
  CZ: 'czk',
  DE: 'eur',
  DK: 'dkk',
  EE: 'eur',
  ES: 'eur',
  FI: 'eur',
  FR: 'eur',
  GB: 'gbp',
  GI: 'gbp',
  GR: 'eur',
  HK: 'hkd',
  HR: 'eur',
  HU: 'huf',
  IE: 'eur',
  IT: 'eur',
  JP: 'jpy',
  LI: 'chf',
  LT: 'eur',
  LU: 'eur',
  LV: 'eur',
  MT: 'eur',
  MX: 'mxn',
  MY: 'myr',
  NL: 'eur',
  NO: 'nok',
  NZ: 'nzd',
  PL: 'pln',
  PT: 'eur',
  RO: 'ron',
  SE: 'sek',
  SG: 'sgd',
  SI: 'eur',
  SK: 'eur',
  TH: 'thb',
  US: 'usd',
};

/**
 * Resolve a default currency code (lowercase ISO 4217) given an
 * instructor's country. Returns `'usd'` if the country is unknown
 * — a defensive fallback, but onboarding already rejects unknown
 * countries so this should never fire in practice.
 */
export function defaultCurrencyForCountry(
  countryCode: string | null | undefined,
): string {
  if (!countryCode) return 'usd';
  return COUNTRY_DEFAULT_CURRENCY[countryCode.toUpperCase()] ?? 'usd';
}
