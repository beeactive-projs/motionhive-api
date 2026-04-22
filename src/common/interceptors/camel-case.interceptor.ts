import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * CamelCase Response Interceptor
 *
 * Transforms all response keys from snake_case to camelCase.
 *
 * Convention:
 * - Database columns use snake_case (e.g., first_name, created_at)
 * - API responses use camelCase (e.g., firstName, createdAt)
 *
 * Sequelize's `underscored: true` handles the DB ↔ model mapping.
 * This interceptor acts as a safety net to guarantee all API responses
 * are consistently camelCase, even for manually constructed objects.
 *
 * Applied globally in AppModule.
 */
@Injectable()
export class CamelCaseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data: unknown) => this.transformKeys(data)));
  }

  /**
   * Recursively transform all object keys to camelCase. Accepts
   * anything: nulls, primitives, arrays, plain objects, Dates, and
   * Sequelize model instances (detected via a duck-typed `toJSON`
   * method).
   */
  private transformKeys(data: unknown): unknown {
    if (data === null || data === undefined) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.transformKeys(item));
    }

    if (data instanceof Date) {
      return data;
    }

    if (typeof data !== 'object') {
      return data;
    }

    // Plain object: transform keys.
    if (data.constructor === Object) {
      const source = data as Record<string, unknown>;
      const transformed: Record<string, unknown> = {};

      for (const key of Object.keys(source)) {
        const camelKey = this.toCamelCase(key);
        transformed[camelKey] = this.transformKeys(source[key]);
      }

      return transformed;
    }

    // Sequelize model instance (or anything else exposing `toJSON`).
    const maybeToJSON = (data as { toJSON?: unknown }).toJSON;
    if (typeof maybeToJSON === 'function') {
      return this.transformKeys((maybeToJSON as () => unknown).call(data));
    }

    return data;
  }

  /**
   * Convert a snake_case string to camelCase
   *
   * Examples:
   * - "first_name" → "firstName"
   * - "created_at" → "createdAt"
   * - "firstName" → "firstName" (already camelCase, no change)
   * - "id" → "id" (single word, no change)
   */
  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }
}
