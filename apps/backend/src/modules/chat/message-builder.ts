import { buildAssistantPrompt } from '../../modules/assistants/prompt-builder';
import { Assistant } from '../../modules/assistants/entities/assistant.entity';

/** 组装 RAG 问答的完整消息序列 */
export function buildChatMessages(opts: {
  assistant: Assistant | null;
  history: { role: 'user' | 'assistant' | 'tool'; content: string }[];
  question: string;
  retrieved: { text: string; source: string; score: number }[];
}): { messages: any[]; systemPrompt: string } {
  const { assistant, history, question, retrieved } = opts;

  const basePrompt =
    assistant
      ? buildAssistantPrompt(assistant)
      : '你是"智星惠"企业知识助手,基于企业内部文档准确、简洁地回答员工问题。若资料不足以回答,请如实说明,不要编造。';

  // 输出格式要求: 引导模型以规范 Markdown 结构化输出,前端按 Markdown 渲染
  const formatPrompt =
    '\n\n=== 输出格式要求 ===\n' +
    '回答必须使用规范的 Markdown 排版:结论先行,关键结论与数值适度**加粗**;' +
    '分点说明使用列表(步骤类内容用有序列表并保留编号);' +
    '涉及职级标准、对比、多字段数据时优先用 Markdown 表格呈现;' +
    '代码、命令、接口字段使用行内代码或代码块;' +
    '补充提示或引用原文可用 > 引用块;' +
    '禁止输出大段无结构的纯文字,禁止使用 Markdown 以外的自定义标记。';

  const contextBlock = retrieved.length
    ? `\n\n=== 参考资料(来自企业知识库,回答时优先依据这些资料并注明来源) ===\n${retrieved
        .map((r, i) => `【${i + 1}】来源: ${r.source}(相关度 ${(r.score * 100).toFixed(0)}%)\n${r.text}`)
        .join('\n\n')}`
    : '';

  const systemPrompt = basePrompt + formatPrompt + contextBlock;

  const messages: any[] = [{ role: 'system', content: systemPrompt }];
  for (const h of history.slice(-10)) {
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role, content: h.content });
    }
  }
  messages.push({ role: 'user', content: question });
  return { messages, systemPrompt };
}
