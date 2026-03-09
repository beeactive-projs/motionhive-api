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
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService } from './auth.service';

/** Request on JWT-protected routes; user is set by AuthGuard('jwt') */
type AuthenticatedRequest = ExpressRequest & { user: { id: string } };
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
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { AuthDocs } from '../../common/docs/auth.docs';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @ApiEndpoint({ ...AuthDocs.register, body: RegisterDto })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  @ApiEndpoint({ ...AuthDocs.login, body: LoginDto })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 900000 } })
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
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.authService.changePassword(req.user.id, dto);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @ApiEndpoint({ ...AuthDocs.forgotPassword, body: ForgotPasswordDto })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @ApiEndpoint({ ...AuthDocs.resetPassword, body: ResetPasswordDto })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Post('verify-email')
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @ApiEndpoint({ ...AuthDocs.verifyEmail, body: VerifyEmailDto })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto);
  }

  @Get('verify-email')
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  async verifyEmailGet(@Query('token') token: string, @Res() res: Response) {
    const successHtml = `<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#fef3c7;"><div style="text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);"><h1 style="color:#f59e0b;">Email Verified!</h1><p>Your email has been verified successfully. You can close this page.</p></div></body></html>`;
    const errorHtml = `<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#fef2f2;"><div style="text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);"><h1 style="color:#ef4444;">Verification Failed</h1><p>This link is invalid or has expired. Please request a new verification email.</p></div></body></html>`;

    try {
      await this.authService.verifyEmail({ token });
      res.status(200).send(successHtml);
    } catch (_err) {
      res.status(400).send(errorHtml);
    }
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 2, ttl: 3600000 } })
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
    return this.authService.registerWithGoogle(dto.idToken);
  }

  @Post('facebook')
  @Throttle({ default: { limit: 10, ttl: 900000 } })
  @ApiEndpoint({ ...AuthDocs.facebook, body: FacebookAuthDto })
  async facebook(@Body() dto: FacebookAuthDto) {
    return this.authService.registerWithFacebook(dto.accessToken);
  }
}
