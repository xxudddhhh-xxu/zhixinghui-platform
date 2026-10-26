import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = '服务器内部错误';
    let code = status * 10;
    if (isHttp) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as any;
        message = Array.isArray(b.message) ? b.message.join(';') : b.message || message;
        code = b.code ?? code;
      }
    } else if (exception?.message) {
      message = exception.message;
      this.logger.error(
        `${request?.method} ${request?.url} -> ${exception.stack || exception.message}`,
      );
    }

    response.status(status).json({ code, message, data: null });
  }
}
