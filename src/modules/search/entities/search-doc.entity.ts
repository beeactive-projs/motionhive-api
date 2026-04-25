import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';

export type SearchEntityType =
  | 'user'
  | 'instructor'
  | 'group'
  | 'session'
  | 'tag';

/**
 * Denormalized row in the global search index. Owned and refreshed by
 * `SearchIndexService.upsert` — never written to directly from feature
 * services. The `search_vector` and `search_text` columns are
 * GENERATED in the migration; they don't have decorators here because
 * Sequelize never writes them.
 */
@Table({
  tableName: 'search_doc',
  timestamps: true,
  underscored: true,
})
export class SearchDoc extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
  })
  declare entityType: SearchEntityType;

  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare entityId: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare title: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare subtitle: string | null;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare body: string | null;

  @Column({
    type: DataType.ARRAY(DataType.TEXT),
    allowNull: false,
    defaultValue: [],
  })
  declare tags: string[];

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare city: string | null;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  })
  declare isPublic: boolean;

  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare ownerId: string | null;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare avatarUrl: string | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;
}
