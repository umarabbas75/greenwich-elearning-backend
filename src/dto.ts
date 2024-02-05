export class BodyDto {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone: string;
  role: string;
  photo?: string;
  timestamp: number;
}

export class LoginDto {
  email: string;
  password: string;
}

export class CourseDto {
  title: string;
  description: string;
  id?: string;
}

export class ParamsDto {
  email: string;
}

export class ResponseDto {
  message: string;
  statusCode: number;
  data:object | object[];
}