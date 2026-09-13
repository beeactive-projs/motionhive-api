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
import { PaymentModule } from '../payment/payment.module';
import { CryptoService } from '../../common/services/crypto.service';
import { EmailVerifierService } from '../../common/services/email-verifier.service';

@Module({
  imports: [
    UserModule,
    PassportModule,
    RoleModule,
    ProfileModule,
    // PaymentModule exports CustomerService — used by AuthService to
    // link any guest stripe_customer rows to a newly-registered user
    // on every signup path (email/password, Google, Facebook).
    PaymentModule,
    SequelizeModule.forFeature([RefreshToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getJwtConfig,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, CryptoService, EmailVerifierService],
  // JwtModule is exported for the rate-limit guard, which keys buckets by the
  // token's subject and needs to verify it with the same secret.
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
