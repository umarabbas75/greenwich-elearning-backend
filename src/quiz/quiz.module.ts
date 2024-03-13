import { Module } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from '../strategy';

@Module({
  imports: [JwtModule.register({})],
  providers: [QuizService,JwtStrategy],
  controllers: [QuizController],
  exports: [QuizService],
})
export class QuizModule {}
