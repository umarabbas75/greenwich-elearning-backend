import { Module } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { JwtModule } from '@nestjs/jwt';
import { JwtAdminStrategy, JwtUserStrategy } from '../strategy';

@Module({
  imports: [JwtModule.register({})],
  providers: [QuizService,JwtUserStrategy,JwtAdminStrategy],
  controllers: [QuizController],
  exports: [QuizService],
})
export class QuizModule {}
