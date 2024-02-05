import { Controller, Get,Post,Body,Param,Query } from '@nestjs/common';
import { AppService } from './app.service';


@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/')
  index(): string {
    return "server running"
  }


}
