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
  const databaseUrl = configService.get<string>('DATABASE_URL');
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

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
      acquire: 30000,
      idle: 10000,
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
    database:
      configService.get<string>('PGDATABASE') ||
      configService.get<string>('DB_DATABASE'),
  };
};
