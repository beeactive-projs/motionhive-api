import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';

@Table({
  tableName: 'waitlist',
  timestamps: true,
  underscored: true,
})
export class Waitlist extends Model {
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
  declare email: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: true,
  })
  declare name: string | null;

  @Column({
    type: DataType.STRING(50),
    allowNull: true,
  })
  declare role: string | null;

  @Column({
    type: DataType.STRING(500),
    allowNull: true,
  })
  declare source: string | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;
}
