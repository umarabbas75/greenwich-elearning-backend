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

  @IsString()
  @IsOptional()
  photoBase64?: string;
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

  @IsOptional()
  @IsString()
  status?: string;
}
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  oldPassword: string;
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
  price: string;

  @IsString()
  @IsOptional()
  duration: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  assessment: string;
  @IsString()
  @IsNotEmpty()
  image: string;

  @IsString()
  @IsOptional()
  overview: string;

  @IsString()
  @IsOptional()
  syllabusOverview: string;

  @IsString()
  @IsOptional()
  resourcesOverview: string;

  // Additional fields
  @IsArray()
  @IsOptional()
  assessments: Array<{ file: string; isSeen: boolean }>;

  @IsArray()
  @IsOptional()
  resources: Array<{ file: string; isSeen: boolean }>;

  @IsArray()
  @IsOptional()
  syllabus: Array<{ file: string; isSeen: boolean }>;

  @IsOptional()
  @IsArray()
  courseForms?: Array<{
    value: string;
    label: string;
    isRequired?: boolean; // default true
  }>;

  @IsOptional()
  @IsArray()
  coursePolicies?: Array<any>;
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
  pdfFile?: string;

  @IsOptional()
  @IsString()
  price?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  assessment?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  overview?: string;

  @IsOptional()
  @IsArray()
  courseForms?: Array<{
    value: string;
    label: string;
    isRequired?: boolean; // default true
  }>;

  @IsOptional()
  @IsArray()
  coursePolicies?: Array<any>;
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

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  chapterId: string;
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

  @IsString()
  @IsOptional()
  pdfFile: string;
}
export class ParamsDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}
export class ParamsDto1 {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  courseId: string;
}

export class CheckQuiz {
  @IsString()
  @IsNotEmpty()
  quizId: string;
  @IsString()
  @IsNotEmpty()
  chapterId: string;
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
