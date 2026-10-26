import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { UseInterceptors } from '@nestjs/common';
import { ChatService, StreamChatDto } from './chat.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';

@Controller('chat')
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Get('sessions')
  sessions(@CurrentUser('id') userId: string) {
    return this.chatService.listSessions(userId);
  }

  @Post('sessions')
  createSession(@CurrentUser() user, @Body() dto: { title?: string; assistantId?: string; defaultKbIds?: string[] }) {
    return this.chatService.createSession(user, dto || {});
  }

  @Delete('sessions/:id')
  removeSession(@CurrentUser() user, @Param('id') id: string) {
    return this.chatService.removeSession(user, id);
  }

  @Get('sessions/:id/messages')
  messages(@CurrentUser() user, @Param('id') id: string) {
    return this.chatService.listMessages(user, id);
  }

  /**
   * 流式问答(SSE): 事件类型
   * meta / sources / delta / tool_start / tool_result / notice / done / error
   */
  @Post('stream')
  @RateLimit({ name: 'chat:stream', limit: 30, windowSec: 60 })
  async stream(
    @CurrentUser() user,
    @Body() dto: StreamChatDto,
    @Res() res: Response,
  ) {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15000);

    const controller = new AbortController();
    res.req.on('close', () => controller.abort());

    const send = (event: Record<string, any>) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await this.chatService.streamChat(user, dto, send, controller.signal);
    } catch (e) {
      // 异常兜底: 以 error 事件返回可读信息,保证前端连接正常关闭
      const filter = new HttpExceptionFilter();
      send({ type: 'error', message: e.message || '服务异常,请稍后重试' });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }
}
