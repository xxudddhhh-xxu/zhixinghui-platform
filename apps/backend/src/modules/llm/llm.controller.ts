import { Controller, Get, Param, Post } from '@nestjs/common';
import { LlmService } from './llm.service';

@Controller('llm')
export class LlmController {
  constructor(private llmService: LlmService) {}

  /** 可用模型列表(前端模型切换面板) */
  @Get('models')
  list() {
    return this.llmService.listModels();
  }

  @Post('models/:id/test')
  test(@Param('id') id: string) {
    return this.llmService.testModel(id);
  }
}
