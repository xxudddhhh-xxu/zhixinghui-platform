import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ToolContext {
  /** 知识检索回调(指向 RAG 服务) */
  knowledgeSearch: (query: string, topK?: number) => Promise<any[]>;
}

export interface ToolResult {
  name: string;
  arguments: Record<string, any>;
  result: string;
}

/** 面板可选工具 */
export const AVAILABLE_TOOLS: (ToolDefinition & { key: string; hint: string })[] = [
  {
    key: 'knowledge_search',
    type: 'function',
    hint: '从私有知识库检索相关资料',
    function: {
      name: 'knowledge_search',
      description:
        '在团队私有知识库中检索与问题相关的资料。当用户的问题可能涉及内部文档、合同、流程规范时调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或问题' },
          top_k: { type: 'integer', description: '返回条数,默认5' },
        },
        required: ['query'],
      },
    },
  },
  {
    key: 'calculator',
    type: 'function',
    hint: '精确计算数学表达式',
    function: {
      name: 'calculator',
      description: '计算四则运算表达式,支持 + - * / 括号与小数,如 (1+2)*3.5',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: '数学表达式' } },
        required: ['expression'],
      },
    },
  },
  {
    key: 'current_time',
    type: 'function',
    hint: '获取当前时间',
    function: {
      name: 'current_time',
      description: '获取当前日期时间(北京时间)',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** 工具执行器:白名单分派,不使用 eval */
export class ToolExecutor {
  private readonly logger = new Logger(ToolExecutor.name);

  constructor(private ctx: ToolContext) {}

  getDefinitions(keys: string[]): ChatCompletionTool[] {
    return AVAILABLE_TOOLS.filter((t) => keys.includes(t.key)).map(
      ({ key, hint, ...def }) => ({ type: 'function' as const, function: def.function }),
    );
  }

  async execute(name: string, args: Record<string, any>): Promise<string> {
    try {
      switch (name) {
        case 'knowledge_search': {
          const results = await this.ctx.knowledgeSearch(
            String(args.query || ''),
            Number(args.top_k) || 5,
          );
          return JSON.stringify(results);
        }
        case 'calculator':
          return JSON.stringify({ value: safeEvalExpression(String(args.expression || '')) });
        case 'current_time':
          return JSON.stringify({
            now: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
          });
        default:
          return JSON.stringify({ error: `未知工具: ${name}` });
      }
    } catch (e) {
      this.logger.warn(`工具执行失败 ${name}: ${e.message}`);
      return JSON.stringify({ error: e.message });
    }
  }
}

/**
 * 安全的四则运算求值(递归下降解析,支持 + - * / 括号与一元负号)。
 */
export function safeEvalExpression(expr: string): number {
  const tokens = expr.match(/(\d+\.?\d*|[+\-*/()])/g);
  if (!tokens) throw new Error('表达式无法解析');
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  function parseTerm(): number {
    let v = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const r = parseFactor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }

  function parseFactor(): number {
    if (peek() === '-') {
      next();
      return -parseFactor();
    }
    if (peek() === '(') {
      next();
      const v = parseExpr();
      if (next() !== ')') throw new Error('括号不匹配');
      return v;
    }
    const t = next();
    if (!t || !/^\d/.test(t)) throw new Error(`非法 token: ${t ?? 'EOF'}`);
    return parseFloat(t);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('表达式有多余字符');
  return result;
}

export type ChatMessage = ChatCompletionMessageParam;
