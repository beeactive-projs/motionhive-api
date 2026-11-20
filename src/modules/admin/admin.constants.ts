/**
 * The six system role names (see migration 005). Used by admin DTOs to
 * validate role filters / assignments. Kept as a plain const array so
 * `@IsIn(ADMIN_ROLE_NAMES)` can reference it directly.
 */
export const ADMIN_ROLE_NAMES = [
  'SUPER_ADMIN',
  'ADMIN',
  'SUPPORT',
  'INSTRUCTOR',
  'WRITER',
  'USER',
] as const;

export type AdminRoleName = (typeof ADMIN_ROLE_NAMES)[number];

/**
 * Admin accounts: never impersonated, only a SUPER_ADMIN may change one's
 * status or schedule its deletion, and nobody may revoke their own.
 */
export const PRIVILEGED_ROLE_NAMES: readonly string[] = [
  'SUPER_ADMIN',
  'ADMIN',
];

/**
 * Accounts no one may impersonate: the admins, and SUPPORT too, whose
 * token reaches the admin app's read routes; acting as them would put
 * staff work under someone else's name.
 */
export const NON_IMPERSONABLE_ROLE_NAMES: readonly string[] = [
  ...PRIVILEGED_ROLE_NAMES,
  'SUPPORT',
];

/**
 * Columns redacted from the read-only DB browser regardless of table.
 * Belt-and-braces on top of each table's explicit `redact` list: any
 * column whose snake_case name matches one of these is replaced with
 * '[REDACTED]'. Matched as a whole-word / suffix test in the service.
 */
export const GLOBAL_REDACT_PATTERNS: readonly RegExp[] = [
  /password/i,
  /token_hash$/i,
  /_secret$/i,
  /^secret$/i,
  /access_token/i,
  /refresh_token/i,
  /client_secret/i,
  /_token$/i,
  /verification_token/i,
];
