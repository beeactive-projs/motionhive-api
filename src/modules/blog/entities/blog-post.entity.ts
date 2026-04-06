import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
} from 'sequelize-typescript';

@Table({
  tableName: 'blog_post',
  paranoid: true,
  timestamps: true,
  underscored: true,
})
export class BlogPost extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
    unique: true,
  })
  declare slug: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare title: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare excerpt: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare content: string;

  @Column({
    type: DataType.STRING(50),
    allowNull: false,
  })
  declare category: string;

  @Column({
    type: DataType.STRING(500),
    allowNull: true,
  })
  declare coverImage: string | null;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  declare authorName: string;

  @Column({
    type: DataType.STRING(10),
    allowNull: false,
  })
  declare authorInitials: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  declare authorRole: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 5,
  })
  declare readTime: number;

  @Column({
    type: DataType.JSON,
    allowNull: true,
  })
  declare tags: string[] | null;

  @Column({
    type: DataType.CHAR(2),
    allowNull: false,
    defaultValue: 'en',
  })
  declare language: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isPublished: boolean;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare publishedAt: Date | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @DeletedAt
  declare deletedAt: Date;
}
