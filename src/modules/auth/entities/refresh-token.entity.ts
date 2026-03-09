import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  CreatedAt,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';

@Table({
  tableName: 'refresh_token',
  timestamps: false,
  underscored: true,
})
export class RefreshToken extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare userId: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare tokenHash: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare deviceInfo: string | null;

  @Column({
    type: DataType.STRING(45),
    allowNull: true,
  })
  declare ipAddress: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare expiresAt: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare revokedAt: Date | null;

  @CreatedAt
  declare createdAt: Date;

  @BelongsTo(() => User)
  declare user: User;
}
