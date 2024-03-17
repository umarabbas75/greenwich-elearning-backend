import { Role } from '@prisma/client';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsArray,
} from 'class-validator';

export class BodyDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsEmail()
  @IsNotEmpty()
  @IsOptional()
  email: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  password: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  role: Role;

  @IsString()
  @IsOptional()
  photo?: string;

  timestamp: number;
}
export class BodyUpdateDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  photo?: string;
}
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  password: string;
}
export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
export class CourseDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  assessment: string;
  @IsString()
  @IsNotEmpty()
  image: string;
  @IsString()
  @IsNotEmpty()
  overview: string;
}
export class QuizDto {
  @IsNotEmpty()
  @IsString()
  question: string;

  @IsArray()
  @IsNotEmpty()
  options: string[];

  @IsNotEmpty()
  @IsString()
  answer: string;
}
export class UpdateQuizDto {
  @IsString()
  @IsOptional()
  question: string;

  @IsArray()
  @IsOptional()
  options: string[];

  @IsOptional()
  @IsString()
  answer: string;
}
export class AssignQuizDto {
  @IsString()
  @IsNotEmpty()
  chapterId: string;

  @IsString()
  @IsNotEmpty()
  quizId: string;
}
export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
export class UpdateCourseProgress {
  @IsString()
  @IsNotEmpty()
  courseId: string;
  @IsString()
  @IsNotEmpty()
  chapterId: string;
  @IsString()
  @IsNotEmpty()
  sectionId: string;
}
export class AssignCourseDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  courseId: string;
}
export class ModuleDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  id: string;
}
export class ParamsDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class CheckQuiz {
  @IsString()
  @IsNotEmpty()
  quizId: string;
  @IsString()
  @IsNotEmpty()
  answer: string;
}

export class GetUpdateLastSeen {
  @IsString()
  @IsNotEmpty()
  userId: string;
  @IsString()
  @IsNotEmpty()
  chapterId: string;
}
export class UpdateLastSeen {
  @IsString()
  @IsNotEmpty()
  userId: string;
  @IsString()
  @IsNotEmpty()
  chapterId: string;
  @IsString()
  @IsNotEmpty()
  sectionId: string;
}
export interface ResponseDto {
  message: string;
  statusCode: number;
  data: object | object[];
}
