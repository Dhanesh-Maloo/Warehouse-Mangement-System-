import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EndUsersService } from './end-users.service';
import { EndUsersController } from './end-users.controller';

@Module({
  imports: [PrismaModule],
  providers: [EndUsersService],
  controllers: [EndUsersController],
  exports: [EndUsersService],
})
export class EndUsersModule {}
