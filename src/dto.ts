import { Role, QuestionType, QuestionDifficulty, AssessmentMode } from '@prisma/client';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsEnum,
  IsBoolean,
  ValidateNested,
  ArrayMinSize,
  IsObject,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

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

  @IsString()
  @IsOptional()
  tutorInfo?: string;

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
  feedbackForm?: {
    isRequired: boolean;
    formName: string;
    formStructure: any; // The actual form questions/structure
  };

  @IsOptional()
  @IsArray()
  policies?: Array<any>;
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
  @IsString()
  tutorInfo?: string;

  @IsOptional()
  @IsArray()
  courseForms?: Array<{
    value: string;
    label: string;
    isRequired?: boolean; // default true
  }>;

  @IsOptional()
  feedbackForm?: {
    isRequired: boolean;
    formName: string;
    formStructure: any; // The actual form questions/structure
  };

  @IsOptional()
  @IsArray()
  policies?: Array<any>;
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

/** Body for `POST /courses/markFormComplete` (student course requirement forms). */
export class MarkFormCompleteDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  formId: string;

  @IsString()
  @IsNotEmpty()
  courseFormId: string;

  @IsOptional()
  @IsObject()
  metaData?: Record<string, unknown>;
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

// Section DTOs
export enum SectionType {
  DEFAULT = 'DEFAULT',
  MATCH_AND_LEARN = 'MATCH_AND_LEARN',
  VISUAL_ACTIVITY = 'VISUAL_ACTIVITY',
  ORDERING = 'ORDERING',
  MATCHING = 'MATCHING',
}

export class CreateSectionDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  shortDescription?: string;

  @IsEnum(SectionType)
  @IsOptional()
  type?: SectionType = SectionType.DEFAULT;

  @IsString()
  @IsNotEmpty()
  chapterId: string;

  @IsString()
  @IsOptional()
  moduleId?: string;

  @IsNumber()
  @IsOptional()
  orderIndex?: number; // Order within chapter (1, 2, 3, etc.)
}

export class MatchAndLearnItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  correctCategory: string;
}

export class CreateMatchAndLearnSectionDto extends CreateSectionDto {
  @IsString()
  @IsNotEmpty()
  itemLabel: string;

  @IsString()
  @IsNotEmpty()
  categoryLabel: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchAndLearnItemDto)
  @IsNotEmpty()
  items: MatchAndLearnItemDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  categories?: string[];

  @IsNumber()
  @IsOptional()
  maxPerCategory?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateSectionDto {
  @IsEnum(SectionType)
  @IsOptional()
  type?: SectionType;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  shortDescription?: string;

  @IsString()
  @IsOptional()
  chapterId?: string;

  @IsString()
  @IsOptional()
  moduleId?: string;

  @IsNumber()
  @IsOptional()
  orderIndex?: number; // Order within chapter (1, 2, 3, etc.)
}

export class UpdateMatchAndLearnSectionDto extends UpdateSectionDto {
  @IsString()
  @IsOptional()
  itemLabel?: string;

  @IsString()
  @IsOptional()
  categoryLabel?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchAndLearnItemDto)
  @IsOptional()
  items?: MatchAndLearnItemDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  categories?: string[];

  @IsNumber()
  @IsOptional()
  maxPerCategory?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

// Visual Activity DTOs
export class VisualActivityOptionDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  text: string;

  @IsBoolean()
  @IsNotEmpty()
  isCorrect: boolean;
}

export class CreateVisualActivitySectionDto extends CreateSectionDto {
  @IsString()
  @IsNotEmpty()
  questionText: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsBoolean()
  @IsOptional()
  allowMultipleSelection?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisualActivityOptionDto)
  @IsNotEmpty()
  @ArrayMinSize(2, { message: 'At least 2 options are required' })
  options: VisualActivityOptionDto[];
}

export class UpdateVisualActivitySectionDto extends UpdateSectionDto {
  @IsString()
  @IsOptional()
  questionText?: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsBoolean()
  @IsOptional()
  allowMultipleSelection?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisualActivityOptionDto)
  @IsOptional()
  @ArrayMinSize(2, { message: 'At least 2 options are required' })
  options?: VisualActivityOptionDto[];
}

export class OrderingItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  text: string;
}

export class CreateOrderingSectionDto extends CreateSectionDto {
  @IsEnum(SectionType)
  type: SectionType.ORDERING;

  @IsString()
  @IsOptional()
  questionText?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderingItemDto)
  @ArrayMinSize(2, { message: 'At least 2 items are required' })
  items: OrderingItemDto[];

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(2)
  correctOrder: string[];
}

export class UpdateOrderingSectionDto extends UpdateSectionDto {
  @IsString()
  @IsOptional()
  questionText?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderingItemDto)
  @IsOptional()
  items?: OrderingItemDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  correctOrder?: string[];
}

export class MatchingPairDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  left: string;

  @IsString()
  @IsNotEmpty()
  right: string;
}

export class CreateMatchingSectionDto extends CreateSectionDto {
  @IsEnum(SectionType)
  type: SectionType.MATCHING;

  @IsString()
  @IsOptional()
  questionText?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchingPairDto)
  @ArrayMinSize(2, { message: 'At least 2 pairs are required' })
  pairs: MatchingPairDto[];
}

export class UpdateMatchingSectionDto extends UpdateSectionDto {
  @IsString()
  @IsOptional()
  questionText?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchingPairDto)
  @IsOptional()
  @ArrayMinSize(2)
  pairs?: MatchingPairDto[];
}

// Bulk update orderIndex DTO
export class SectionOrderItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsNumber()
  @IsNotEmpty()
  orderIndex: number;
}

export class UpdateSectionOrderDto {
  @IsString()
  @IsNotEmpty()
  chapterId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SectionOrderItemDto)
  @IsNotEmpty()
  sections: SectionOrderItemDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSESSMENT FEATURE DTOs
// ─────────────────────────────────────────────────────────────────────────────

// --- Question Bank ---

export class CreateQuestionCategoryDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateQuestionCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CreateQuestionDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsEnum(QuestionType)
  type: QuestionType;

  @IsEnum(QuestionDifficulty)
  difficulty: QuestionDifficulty;

  @IsString()
  @IsNotEmpty()
  text: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsObject()
  @IsNotEmpty()
  content: Record<string, any>;

  @IsNumber()
  @Min(0)
  maxMarks: number;
}

export class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @IsOptional()
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  text?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsObject()
  content?: Record<string, any>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxMarks?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// --- Assessment Management ---

export class AutoConfigCategoryDto {
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsNumber()
  @Min(1)
  count: number;
}

export class AutoConfigDifficultyDto {
  @IsEnum(QuestionDifficulty)
  difficulty: QuestionDifficulty;

  @IsNumber()
  @Min(1)
  count: number;
}

export class AssessmentAutoConfigDto {
  @IsNumber()
  @Min(1)
  totalQuestions: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutoConfigCategoryDto)
  byCategory: AutoConfigCategoryDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutoConfigDifficultyDto)
  byDifficulty: AutoConfigDifficultyDto[];
}

export class CreateAssessmentDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(AssessmentMode)
  mode: AssessmentMode;

  @IsNumber()
  @Min(1)
  @Max(100)
  passingPercentage: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  timeLimitMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxAttempts?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => AssessmentAutoConfigDto)
  autoConfig?: AssessmentAutoConfigDto;
}

export class UpdateAssessmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  passingPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  timeLimitMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxAttempts?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => AssessmentAutoConfigDto)
  autoConfig?: AssessmentAutoConfigDto;
}

// --- Manual Assessment Question Roster ---

export class AddAssessmentQuestionDto {
  @IsString()
  @IsNotEmpty()
  questionId: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  orderIndex?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  marksOverride?: number;
}

export class ReorderQuestionItemDto {
  @IsString()
  @IsNotEmpty()
  questionId: string;

  @IsNumber()
  @Min(0)
  orderIndex: number;
}

export class ReorderAssessmentQuestionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderQuestionItemDto)
  @ArrayMinSize(1)
  questions: ReorderQuestionItemDto[];
}

// --- Student Flow ---

export class StartAttemptDto {
  @IsString()
  @IsNotEmpty()
  assessmentId: string;
}

export class AnswerItemDto {
  @IsString()
  @IsNotEmpty()
  snapshotId: string;

  @IsNotEmpty()
  studentAnswer: Record<string, any>;
}

export class SubmitAttemptDto {
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => AnswerItemDto)
  answers: AnswerItemDto[];
}

// --- Admin Grading ---

export class QuestionScoreDto {
  @IsString()
  @IsNotEmpty()
  snapshotId: string;

  @IsNumber()
  @Min(0)
  adminScore: number;

  @IsOptional()
  @IsString()
  adminFeedback?: string;
}

export class GradeAttemptDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionScoreDto)
  @ArrayMinSize(1)
  scores: QuestionScoreDto[];
}

export class SetCertificateDto {
  @IsString()
  @IsNotEmpty()
  certificateUrl: string;
}
