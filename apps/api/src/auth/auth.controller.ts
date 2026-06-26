import { Controller, Post, Get, UseGuards, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // LocalAuthGuard runs LocalStrategy.validate() before this handler
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @CurrentUser() user: JwtPayload,
    // LoginDto is declared for OpenAPI/docs; actual validation is in LocalStrategy
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _dto: LoginDto,
  ): { accessToken: string; user: JwtPayload } {
    return this.authService.login(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: JwtPayload): Promise<{
    id: string;
    email: string;
    fullName: string;
    role: string;
    clientId: string | null;
  }> {
    return this.authService.me(user.sub);
  }
}
