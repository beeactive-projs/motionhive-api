import { ConfigService } from '@nestjs/config';
import { SequelizeModuleOptions } from '@nestjs/sequelize';

/**
 * Database Configuration Factory
 *
 * Creates Sequelize configuration for PostgreSQL connection (Neon).
 * Called once when the app starts (see app.module.ts).
 *
 * Key settings:
 * - synchronize: false → We manage schema manually (safer for production)
 * - autoLoadModels: true → Auto-discover @Table() entities
 * - pool → Connection pooling for better performance
 * - dialectOptions → PostgreSQL-specific settings (SSL for Neon)
 */
export const getDatabaseConfig = (
  configService: ConfigService,
): SequelizeModuleOptions => {
  const nodeEnv = configService.get<string>('NODE_ENV');
  const isProduction = nodeEnv === 'production';
  // Integration tests run against a separate test DB to protect dev data.
  // TEST_DATABASE_URL (or TEST_DB_DATABASE) takes precedence when NODE_ENV=test.
  const isTest = nodeEnv === 'test';
  const databaseUrl = isTest
    ? (configService.get<string>('TEST_DATABASE_URL') ??
      configService.get<string>('DATABASE_URL'))
    : configService.get<string>('DATABASE_URL');

  // Enable SSL for Neon (DATABASE_URL) or production; skip for local dev
  const needsSsl = !!databaseUrl || isProduction;

  // Base config shared by both URL and individual-var modes
  const baseConfig: SequelizeModuleOptions = {
    dialect: 'postgres',
    autoLoadModels: true,
    synchronize: false,
    logging:
      configService.get<string>('NODE_ENV') === 'development'
        ? console.log
        : false,
    timezone: '+00:00',
    pool: {
      max: 10,
      min: 0,
      // Wait up to 60s to get a connection from the pool. This MUST be
      // >= `dialectOptions.connectTimeout` below — otherwise the pool
      // gives up before a fresh Neon connection finishes handshaking,
      // and we surface a 500 on the first request after a quiet period
      // (Neon serverless cold-start: 5–30s typical, up to ~60s in the
      // worst case). Symptom of the old 30s setting:
      //   `SequelizeConnectionError: Authentication timed out`
      acquire: 60000,
      // Drop pooled sockets after 60s of idle. Neon only kills
      // connections when it suspends the compute, which happens after
      // 5 minutes without any activity, so anything below that window
      // is safe — and a longer idle means a user clicking around every
      // few seconds reuses a warm socket instead of paying a fresh
      // TCP + TLS + auth handshake (3–4 round trips, ~1 s cross-region)
      // after every 10-second pause. Keep this well under Neon's
      // suspend timeout.
      idle: 60000,
      // Reap idle sockets every 1s. Without this, the eviction only
      // runs on pool acquire; with sparse traffic, a "dead" socket can
      // linger in the pool well past the `idle` threshold and get
      // handed to the next request, producing an opaque ECONNRESET.
      evict: 1000,
    },
    // Disable Sequelize's per-query retry. It is NOT transaction-aware:
    // a retry of a query that already aborted its transaction just hits
    // "current transaction is aborted" and masks the original error in
    // the logs. For transient connection issues, the pool `acquire`
    // timeout handles the reconnect; for genuine query failures we want
    // the real error to surface immediately.
    retry: {
      max: 0,
    },
    dialectOptions: {
      connectTimeout: 60000,
      ...(needsSsl && {
        ssl: {
          rejectUnauthorized: false,
        },
      }),
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
    },
  };

  // If DATABASE_URL is provided (Neon connection string), use it directly
  if (databaseUrl) {
    return {
      ...baseConfig,
      uri: databaseUrl,
    };
  }

  // Fallback to individual environment variables
  return {
    ...baseConfig,
    host:
      configService.get<string>('PGHOST') ||
      configService.get<string>('DB_HOST'),
    port:
      configService.get<number>('PGPORT') ||
      configService.get<number>('DB_PORT'),
    username:
      configService.get<string>('PGUSER') ||
      configService.get<string>('DB_USERNAME'),
    password:
      configService.get<string>('PGPASSWORD') ||
      configService.get<string>('DB_PASSWORD'),
    database: isTest
      ? configService.get<string>('TEST_DB_DATABASE') ||
        configService.get<string>('PGDATABASE') ||
        configService.get<string>('DB_DATABASE')
      : configService.get<string>('PGDATABASE') ||
        configService.get<string>('DB_DATABASE'),
  };
};
