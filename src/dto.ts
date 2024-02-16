import { IsEmail, IsNotEmpty, IsString, IsOptional } from 'class-validator';

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
  role: string;

  @IsString()
  @IsOptional()
  photo?: string;

  timestamp: number;
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

  @IsOptional()
  id?: string;
}

export class ParamsDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class CourseParamDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export interface ResponseDto {
  message: string;
  statusCode: number;
  data: object | object[];
}
