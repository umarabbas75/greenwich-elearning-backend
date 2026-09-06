import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class CreateScormPackageDto {
  /** Existing catalogue course. Omit to create one from the fields below. */
  @IsOptional()
  @IsString()
  courseId?: string;

  /**
   * Durable public HTTPS URL Cloud can GET. Mapped to CreateFetchAndImportCourseJob
   * body `{ url }` — never uploaded through this API.
   */
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  contentUrl: string;

  @IsOptional()
  @IsString()
  zipSha256?: string;

  @IsIn(['completed', 'passed'])
  completeOn: 'completed' | 'passed';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  passingScore?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  overview?: string;

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @IsString()
  assessment?: string;

  @IsOptional()
  @IsString()
  syllabusOverview?: string;

  @IsOptional()
  @IsString()
  resourcesOverview?: string;
}

export class LaunchScormDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  /** Consistency check only — launch resolves the package from the pinned curriculum. */
  @IsOptional()
  @IsString()
  packageId?: string;
}
