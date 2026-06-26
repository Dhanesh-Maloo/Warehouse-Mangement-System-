import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '../../common/types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET', 'fallback-dev-secret');
    const nodeEnv = config.get<string>('NODE_ENV', 'development');
    if (secret === 'fallback-dev-secret' && nodeEnv !== 'development') {
      throw new Error(
        'JWT_SECRET must be set to a non-default value in non-development environments',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // Passport attaches the return value as request.user
  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
