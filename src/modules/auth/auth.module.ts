import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserModule } from '../user/user.module';
import { getJwtConfig } from '../../config/jwt.config';
import { RoleModule } from '../role/role.module';
import { ProfileModule } from '../profile/profile.module';
import { EmailService } from '../../common/services/email.service';
import { CryptoService } from '../../common/services/crypto.service';

@Module({
  imports: [
    UserModule,
    PassportModule,
    RoleModule,
    ProfileModule,
    SequelizeModule.forFeature([RefreshToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getJwtConfig,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, EmailService, CryptoService],
  exports: [AuthService],
})
export class AuthModule {}
