import { Assistant } from './entities/assistant.entity';

/** 由助手配置动态生成系统提示词 */
export function buildAssistantPrompt(a: Assistant): string {
  const lines: string[] = [];
  lines.push(`你是「${a.name}」,一名${a.role},服务于企业内部员工。`);

  if (a.personality?.trim()) {
    lines.push(`你的性格与表达风格: ${a.personality.trim()}`);
  }
  if (a.allowedTopics?.trim()) {
    lines.push(
      `你的职责范围是回答以下方面的问题: ${a.allowedTopics.trim()}。请尽量围绕这些主题提供专业、准确的解答。`,
    );
  }
  if (a.deniedTopics?.trim()) {
    lines.push(
      `以下问题超出了你的服务范围,必须礼貌拒绝并建议员工咨询对应部门,不得擅自回答: ${a.deniedTopics.trim()}。`,
    );
  }
  if (a.retrievalFirst) {
    lines.push(
      '回答策略: 优先依据"参考资料"中来自企业知识库的内容作答;仅当参考资料确实无法覆盖问题时,才基于你自身知识谨慎回答,并说明"知识库中未找到直接依据"。',
    );
  } else {
    lines.push('回答策略: 以你自身知识为主,参考资料仅作辅助。');
  }
  lines.push('回答要求: 结构清晰、语言简洁,涉及资料时注明来源;不确定的信息不要编造。');
  return lines.join('\n');
}
