import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { KnowledgeService, SearchHit } from '../knowledge/knowledge.service';
import { AssistantsService } from '../assistants/assistants.service';
import { Assistant } from '../assistants/entities/assistant.entity';
import { LlmService } from '../llm/llm.service';
import { ToolExecutor, AVAILABLE_TOOLS } from '../llm/tools';
import { buildChatMessages } from './message-builder';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';

export interface StreamChatDto {
  sessionId?: string;
  content: string;
  modelId: string;
  assistantId?: string | null;
  kbIds?: string[];
  tools?: string[];
}

export type SseSend = (event: Record<string, any>) => void;

const MAX_TOOL_ROUNDS = 3;
const HISTORY_WINDOW = 10;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatSession) private sessionRepo: Repository<ChatSession>,
    @InjectRepository(ChatMessage) private messageRepo: Repository<ChatMessage>,
    private knowledgeService: KnowledgeService,
    private assistantsService: AssistantsService,
    private llmService: LlmService,
  ) {}

  async listSessions(userId: string) {
    return this.sessionRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
  }

  async createSession(user: CurrentUserData, dto: { title?: string; assistantId?: string | null; defaultKbIds?: string[] }) {
    return this.sessionRepo.save(
      this.sessionRepo.create({
        userId: user.id,
        title: dto.title?.slice(0, 200) || '新对话',
        assistantId: dto.assistantId || null,
        defaultKbIds: dto.defaultKbIds ?? null,
      }),
    );
  }

  async removeSession(user: CurrentUserData, id: string) {
    const s = await this.sessionRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('会话不存在');
    if (s.userId !== user.id && user.globalRole !== 'admin')
      throw new ForbiddenException('无权删除该会话');
    await this.messageRepo.delete({ sessionId: id });
    await this.sessionRepo.delete({ id });
    return true;
  }

  async listMessages(user: CurrentUserData, sessionId: string) {
    const s = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('会话不存在');
    if (s.userId !== user.id && user.globalRole !== 'admin')
      throw new ForbiddenException('无权访问该会话');
    return this.messageRepo.find({ where: { sessionId }, order: { createdAt: 'ASC' } });
  }

  /**
   * 流式问答主链路:
   * 检索增强(可选) → LLM 流式生成 → 工具调用循环 → 落库
   * 全程通过 SSE 事件推送前端。
   */
  async streamChat(user: CurrentUserData, dto: StreamChatDto, send: SseSend, signal?: AbortSignal) {
    const startedAt = Date.now();

    // 1. 会话定位 / 创建
    let session: ChatSession | null = null;
    if (dto.sessionId) {
      session = await this.sessionRepo.findOne({ where: { id: dto.sessionId } });
      if (!session) throw new NotFoundException('会话不存在');
      if (session.userId !== user.id) throw new ForbiddenException('无权访问该会话');
    }
    if (!session) {
      session = await this.createSession(user, {
        title: dto.content.slice(0, 40),
        assistantId: dto.assistantId ?? null,
        defaultKbIds: dto.kbIds,
      });
    }

    // 2. 保存用户消息
    const userMsg = await this.messageRepo.save(
      this.messageRepo.create({ sessionId: session.id, role: 'user', content: dto.content }),
    );
    send({ type: 'meta', sessionId: session.id, userMessageId: userMsg.id, model: dto.modelId });

    // 3. 助手配置
    let assistant: Assistant | null = null;
    if (dto.assistantId) {
      assistant = await this.assistantsService.findOne(dto.assistantId).catch(() => null);
    }

    // 4. 知识检索(异常兜底: 检索失败不阻断问答)
    const kbIds = (dto.kbIds?.length ? dto.kbIds : assistant?.kbIds) || [];
    let retrieved: SearchHit[] = [];
    if (kbIds.length) {
      try {
        retrieved = await this.knowledgeService.search(user, kbIds, dto.content, 5);
        send({
          type: 'sources',
          sources: retrieved.map((r) => ({
            id: r.id,
            source: r.source,
            score: Number(r.score.toFixed(4)),
            snippet: r.text.slice(0, 120),
            documentId: r.documentId ?? null,
            teamId: r.teamId ?? null,
            text: r.text,
          })),
        });
      } catch (e) {
        this.logger.warn(`检索失败(降级为纯模型回答): ${e.message}`);
        send({ type: 'notice', message: '知识库检索暂不可用,本次由模型直接回答' });
      }
    }

    // 5. 组装消息
    const history = await this.messageRepo.find({
      where: { sessionId: session.id },
      order: { createdAt: 'DESC' },
      take: HISTORY_WINDOW,
    });
    history.reverse();
    const { messages } = buildChatMessages({
      assistant,
      history: history.filter((m) => m.id !== userMsg.id),
      question: dto.content,
      retrieved,
    });

    // 6. 工具装配
    const validTools = (dto.tools || []).filter((t) =>
      AVAILABLE_TOOLS.some((a) => a.key === t),
    );
    const executor = new ToolExecutor({
      knowledgeSearch: async (q, topK) => {
        if (!kbIds.length) return [];
        const hits = await this.knowledgeService.search(user, kbIds, q, topK ?? 5);
        return hits.map((h) => ({ source: h.source, text: h.text.slice(0, 500) }));
      },
    });

    // 7. 流式生成 + 工具调用循环
    let answer = '';
    const toolTrace: any[] = [];

    try {
      // provider/client 解析放在 try 内: 无效 modelId 走兜底话术而非裸 error 事件
      const provider = this.llmService.getProvider(dto.modelId);
      const client = this.llmService.client(dto.modelId);
      let round = 0;
      let useTools = validTools.length > 0 && provider.supportsTools;
      while (true) {
        let finishReason: string | null = null;
        let pendingToolCalls: any[] = [];

        const stream = await client.chat.completions.create(
          {
            model: provider.model,
            messages: messages as any,
            stream: true,
            temperature: 0.4,
            ...(useTools ? { tools: executor.getDefinitions(validTools) } : {}),
          },
          { signal },
        );

        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta || {};
          if (delta.content) {
            answer += delta.content;
            send({ type: 'delta', text: delta.content });
          }
          if (delta.tool_calls?.length) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              pendingToolCalls[idx] = pendingToolCalls[idx] || {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
              if (tc.id) pendingToolCalls[idx].id = tc.id;
              if (tc.function?.name)
                pendingToolCalls[idx].function.name += tc.function.name;
              if (tc.function?.arguments)
                pendingToolCalls[idx].function.arguments += tc.function.arguments;
            }
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }

        pendingToolCalls = pendingToolCalls.filter(Boolean);
        if (finishReason !== 'tool_calls' || !pendingToolCalls.length || round >= MAX_TOOL_ROUNDS) {
          break;
        }

        // 执行工具并继续下一轮
        round++;
        messages.push({
          role: 'assistant',
          content: answer || null,
          tool_calls: pendingToolCalls,
        });
        for (const call of pendingToolCalls) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            args = {};
          }
          send({ type: 'tool_start', name: call.function.name, arguments: args });
          const result = await executor.execute(call.function.name, args);
          toolTrace.push({ name: call.function.name, arguments: args, result: result.slice(0, 2000) });
          send({ type: 'tool_result', name: call.function.name, result: result.slice(0, 800) });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: result,
          });
        }
        answer = ''; // 累积新一轮的正文
      }
    } catch (e) {
      if (signal?.aborted) {
        // 用户主动停止: 保留已生成内容
        await this.persist(session.id, user, dto, answer || '(已停止生成)', retrieved, toolTrace, startedAt, send);
        send({ type: 'done', stopped: true, latencyMs: Date.now() - startedAt });
        return;
      }
      this.logger.error(`LLM 流式调用失败: ${e.message}`);
      // 兜底: 模型不可用时给出可读错误而非中断连接
      if (!answer) {
        const fallback = `抱歉,模型服务暂时不可用(${e.message.slice(0, 120)})。请稍后重试或切换其他模型。`;
        send({ type: 'delta', text: fallback });
        answer = fallback;
      }
    }

    const savedMsg = await this.persist(session.id, user, dto, answer, retrieved, toolTrace, startedAt, send);
    send({
      type: 'done',
      assistantMessageId: savedMsg?.id,
      latencyMs: Date.now() - startedAt,
    });
  }

  private async persist(
    sessionId: string,
    user: CurrentUserData,
    dto: StreamChatDto,
    answer: string,
    retrieved: SearchHit[],
    toolTrace: any[],
    startedAt: number,
    send: SseSend,
  ) {
    try {
      return await this.messageRepo.save(
        this.messageRepo.create({
          sessionId,
          role: 'assistant',
          content: answer,
          modelId: dto.modelId,
          sources: retrieved.map((r) => ({
            source: r.source,
            score: r.score,
            snippet: r.text.slice(0, 200),
            documentId: r.documentId ?? null,
            teamId: r.teamId ?? null,
            text: r.text,
          })),
          toolCalls: toolTrace,
          latencyMs: Date.now() - startedAt,
        }),
      );
    } catch (e) {
      this.logger.error(`消息落库失败: ${e.message}`);
      send({ type: 'notice', message: '消息保存失败,但不影响本次回答' });
      return null;
    }
  }
}
