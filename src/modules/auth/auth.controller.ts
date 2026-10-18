import {
  Controller,
  Post,
  Patch,
  Get,
  Delete,
  Body,
  Query,
  Res,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { FacebookAuthDto } from './dto/facebook-auth.dto';
import { RestoreAccountDto } from './dto/restore-account.dto';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { AuthDocs } from '../../common/docs/auth.docs';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 7, ttl: 900_000 } })
  @ApiEndpoint({ ...AuthDocs.register, body: RegisterDto })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  // Paired with account-level lockout (5 failed attempts → 15-min lock in
  // UserService.incrementFailedAttempts). This throttle is the IP-level
  // cap: stops a single IP hammering login across many accounts.
  //
  // Keyed by IP, because a login carries no token yet — so everyone behind
  // one egress shares the budget. A gym's wifi, an office or carrier NAT can
  // put dozens of members on a single address, and at 10 the eleventh person
  // to arrive was refused. The account lockout is what actually stops a
  // brute force against one account; this only has to stop a flood.
  @Throttle({ default: { limit: 40, ttl: 900_000 } })
  @ApiEndpoint({ ...AuthDocs.login, body: LoginDto })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  /**
   * Keep an account scheduled for deletion, with the ticket a sign-in
   * answered. Signs the person in on success.
   */
  @Post('restore-account')
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @ApiEndpoint({ ...AuthDocs.restoreAccount, body: RestoreAccountDto })
  async restoreAccount(@Body() dto: RestoreAccountDto) {
    return this.authService.restoreAccount(dto.ticket);
  }

  @Post('refresh')
  // Also IP-keyed — the refresh token is in the body, not a bearer header.
  // Every session refreshes on its own schedule, so a shared address burns
  // this faster than login does.
  @Throttle({ default: { limit: 60, ttl: 900_000 } })
  @ApiEndpoint({ ...AuthDocs.refreshToken, body: RefreshTokenDto })
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshAccessToken(refreshTokenDto.refreshToken);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 10, ttl: 900000 } })
  @ApiEndpoint({ ...AuthDocs.logout, body: RefreshTokenDto })
  async logout(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.authService.logout(refreshTokenDto.refreshToken, req.user.id);
  }

  /**
   * Logout from all devices — revoke all refresh tokens
   */
  @Delete('logout-all')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  async logoutAll(@Request() req: AuthenticatedRequest) {
    return this.authService.logoutAll(req.user.id);
  }

  /**
   * Change password (authenticated)
   */
  @Patch('change-password')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.authService.changePassword(req.user.id, dto);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 7, ttl: 900_000 } })
  @ApiEndpoint({ ...AuthDocs.forgotPassword, body: ForgotPasswordDto })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 7, ttl: 900_000 } })
  @ApiEndpoint({ ...AuthDocs.resetPassword, body: ResetPasswordDto })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Post('verify-email')
  @Throttle({ default: { limit: 7, ttl: 900_000 } })
  @ApiEndpoint({ ...AuthDocs.verifyEmail, body: VerifyEmailDto })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto);
  }

  @Get('verify-email')
  @Throttle({ default: { limit: 7, ttl: 900_000 } })
  async verifyEmailGet(@Query('token') token: string, @Res() res: Response) {
    const { status, html } = await this.authService.verifyEmailHtml(token);
    res.status(status).send(html);
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 7, ttl: 900_000 } })
  @ApiEndpoint({
    ...AuthDocs.resendVerification,
    body: ResendVerificationDto,
  })
  async resendVerification(
    @Body() resendVerificationDto: ResendVerificationDto,
  ) {
    return this.authService.resendVerification(resendVerificationDto);
  }

  @Post('google')
  @Throttle({ default: { limit: 10, ttl: 900000 } })
  @ApiEndpoint({ ...AuthDocs.google, body: GoogleAuthDto })
  async google(@Body() dto: GoogleAuthDto) {
    return this.authService.registerWithGoogle(dto.idToken, dto.language);
  }

  @Post('facebook')
  @Throttle({ default: { limit: 10, ttl: 900000 } })
  @ApiEndpoint({ ...AuthDocs.facebook, body: FacebookAuthDto })
  async facebook(@Body() dto: FacebookAuthDto) {
    return this.authService.registerWithFacebook(dto.accessToken, dto.language);
  }
}
