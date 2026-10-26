import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AssistantsService } from './assistants.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('assistants')
export class AssistantsController {
  constructor(private assistantsService: AssistantsService) {}

  @Get()
  list(@CurrentUser() user) {
    return this.assistantsService.list(user);
  }

  @Post()
  create(@CurrentUser() user, @Body() dto: any) {
    return this.assistantsService.create(user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user, @Param('id') id: string, @Body() dto: any) {
    return this.assistantsService.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user, @Param('id') id: string) {
    return this.assistantsService.remove(user, id);
  }
}
