import { col, Op, Order, WhereOptions } from 'sequelize';
import type {
  FilterMetadataDto,
  FilterSettingsDto,
} from '../dto/filter-settings.dto';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Returned by buildFilterResponse — analogous to .NET FilterResponse<T>. */
export interface FilterResponse<T> {
  items: T[];
  totalRecords: number;
  first: number;
  rows: number;
}

/**
 * Shape returned by buildFilterOptions — spread directly into findAndCountAll().
 *
 * `subQuery` is set to false automatically when any filter condition or sort
 * targets a nested association field (dot-notation like "client.firstName").
 * Sequelize's default subquery pagination cannot include the JOIN, so without
 * subQuery:false those conditions would silently produce wrong results.
 *
 * IMPORTANT — use separate count() + findAll() instead of findAndCountAll():
 * findAndCountAll forwards every option, including subQuery:false, to its
 * internal count() call. Sequelize 6's count() with subQuery:false generates
 * a query that mixes COUNT() with column selects, which PostgreSQL rejects
 * without a GROUP BY clause. Pattern:
 *
 *   const [count, rows] = await Promise.all([
 *     Model.count({ where, include }),           // no subQuery here
 *     Model.findAll({ where, include, ...opts }), // subQuery:false only here
 *   ]);
 */
export interface FilterQueryResult {
  where: WhereOptions;
  order: Order;
  limit: number;
  offset: number;
  subQuery: boolean;
}

export interface FilterQueryOptions {
  /**
   * Explicit list of attribute names (camelCase) that are allowed as filter
   * targets. When omitted, all incoming field names are trusted.
   * Always specify this for public endpoints.
   */
  allowedFields?: string[];
  /**
   * Attribute name to sort by when the request omits sortField.
   * Defaults to 'createdAt'.
   */
  defaultSortField?: string;
}

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

export function buildFilterResponse<T>(
  data: T[],
  totalRecords: number,
  filterSettings: FilterSettingsDto,
): FilterResponse<T> {
  return {
    items: data,
    totalRecords,
    first: filterSettings.first ?? 0,
    rows: filterSettings.rows ?? 20,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** camelCase → snake_case, used only for association column names inside col(). */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Build a single Sequelize WhereOptions clause for one filter condition.
 *
 * fieldKey is either a plain attribute name ('status') or a Sequelize
 * association accessor ('$instructor.firstName$') for nested fields.
 *
 * The caller is responsible for including the association in findAndCountAll
 * when dot-notation fields are used.
 */
function buildFieldCondition(
  fieldKey: string,
  matchMode: string,
  value: unknown,
): WhereOptions {
  const strVal = String(value);

  switch (matchMode) {
    case 'startsWith':
      return { [fieldKey]: { [Op.iLike]: `${strVal}%` } };

    case 'endsWith':
      return { [fieldKey]: { [Op.iLike]: `%${strVal}` } };

    case 'contains':
      return { [fieldKey]: { [Op.iLike]: `%${strVal}%` } };

    case 'notContains':
      return { [fieldKey]: { [Op.notILike]: `%${strVal}%` } };

    case 'equals':
      return { [fieldKey]: { [Op.eq]: value } };

    case 'notEquals':
      return { [fieldKey]: { [Op.ne]: value } };

    case 'lt':
    case 'dateBefore':
      return { [fieldKey]: { [Op.lt]: value } };

    case 'lte':
      return { [fieldKey]: { [Op.lte]: value } };

    case 'gt':
    case 'dateAfter':
      return { [fieldKey]: { [Op.gt]: value } };

    case 'gte':
      return { [fieldKey]: { [Op.gte]: value } };

    case 'in': {
      const arr = Array.isArray(value) ? value : [value];
      return { [fieldKey]: { [Op.in]: arr } };
    }

    case 'between': {
      const arr = Array.isArray(value) ? value : [value, value];
      return {
        [fieldKey]: { [Op.between]: [arr[0], arr[1]] as [unknown, unknown] },
      };
    }

    case 'dateIs': {
      const d = new Date(strVal);
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      return { [fieldKey]: { [Op.between]: [start, end] as [Date, Date] } };
    }

    case 'dateIsNot': {
      const d = new Date(strVal);
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      // Cannot express NOT BETWEEN as a single attribute hash — use top-level Op.or.
      return {
        [Op.or]: [
          { [fieldKey]: { [Op.lt]: start } },
          { [fieldKey]: { [Op.gt]: end } },
        ],
      } as WhereOptions;
    }

    default:
      return { [fieldKey]: { [Op.eq]: value } };
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Translate a PrimeNG FilterSettingsDto into Sequelize FindAndCountAll options.
 *
 * @example
 * // In a service method:
 * const opts = buildFilterOptions(dto, { allowedFields: ['name', 'status', 'instructor.firstName'] });
 * const { rows, count } = await this.model.findAndCountAll({
 *   ...opts,
 *   include: [{ model: InstructorProfile, as: 'instructor' }],
 * });
 * return buildFilterResponse(rows, count, dto);
 */
export function buildFilterOptions(
  filterSettings: FilterSettingsDto,
  options: FilterQueryOptions = {},
): FilterQueryResult {
  const {
    first = 0,
    rows = 20,
    sortField,
    sortOrder = 1,
    filters,
  } = filterSettings;
  const { allowedFields, defaultSortField = 'createdAt' } = options;

  // --- WHERE ----------------------------------------------------------------

  const conditions: WhereOptions[] = [];
  let hasNestedConditions = false;

  if (filters) {
    for (const [rawField, filterMeta] of Object.entries(filters)) {
      if (!filterMeta) continue;
      if (allowedFields && !allowedFields.includes(rawField)) continue;

      const metas: FilterMetadataDto[] = Array.isArray(filterMeta)
        ? filterMeta
        : [filterMeta];

      const active = metas.filter((m) => !isEmptyValue(m.value));
      if (active.length === 0) continue;

      // Dot-notation → Sequelize $association.attribute$ accessor
      const isNested = rawField.includes('.');
      const fieldKey = isNested ? `$${rawField}$` : rawField;
      if (isNested) hasNestedConditions = true;

      const fieldConditions = active.map((m) =>
        buildFieldCondition(fieldKey, m.matchMode, m.value),
      );

      if (fieldConditions.length === 1) {
        conditions.push(fieldConditions[0]);
      } else {
        const combineOp = active[0].operator === 'or' ? Op.or : Op.and;
        conditions.push({ [combineOp]: fieldConditions } as WhereOptions);
      }
    }
  }

  const where = (
    conditions.length > 0 ? { [Op.and]: conditions } : {}
  ) as WhereOptions;

  // --- ORDER ----------------------------------------------------------------

  // sortField can be an array in PrimeNG multi-sort mode — use the first element.
  const effectiveSortField =
    (Array.isArray(sortField) ? sortField[0] : sortField) ?? defaultSortField;
  const direction: 'ASC' | 'DESC' = sortOrder === -1 ? 'DESC' : 'ASC';

  let order: Order;

  if (effectiveSortField.includes('.')) {
    // Nested sort: "instructor.firstName" → col('"instructor"."first_name"')
    // col() bypasses Sequelize's attribute→column mapping, so we convert manually.
    const parts = effectiveSortField.split('.');
    const prefix = parts.slice(0, -1).join('.');
    const column = camelToSnake(parts[parts.length - 1]);
    order = [[col(`${prefix}.${column}`), direction]];
    hasNestedConditions = true;
  } else {
    // Flat sort: Sequelize applies the underscored mapping automatically.
    order = [[effectiveSortField, direction]];
  }

  // --- PAGINATION -----------------------------------------------------------

  return {
    where,
    order,
    limit: Math.min(rows, 100),
    offset: first,
    // Sequelize's default subquery pagination wraps the primary key fetch in a
    // subquery that has no JOIN, so $assoc.col$ conditions would fail silently.
    // Disable subquery when any active condition or sort targets an association.
    subQuery: !hasNestedConditions,
  };
}
