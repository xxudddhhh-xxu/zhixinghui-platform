import { Injectable, NotFoundException } from '@nestjs/common';
import {
  createClient,
  loadModelProviders,
  ModelProviderConfig,
} from './providers';

@Injectable()
export class LlmService {
  private providers: ModelProviderConfig[];

  constructor() {
    this.providers = loadModelProviders();
  }

  listModels() {
    return this.providers.map((p) => ({
      id: p.id,
      label: p.label,
      supportsTools: p.supportsTools,
    }));
  }

  getProvider(modelId: string): ModelProviderConfig {
    const p = this.providers.find((x) => x.id === modelId);
    if (!p)
      throw new NotFoundException(
        `模型 ${modelId} 未配置,可选: ${this.providers.map((x) => x.id).join(', ')}`,
      );
    return p;
  }

  client(modelId: string) {
    return createClient(this.getProvider(modelId));
  }

  /** 连通性测试 */
  async testModel(modelId: string): Promise<{ ok: boolean; message: string }> {
    try {
      const client = this.client(modelId);
      const res = await client.chat.completions.create({
        model: this.getProvider(modelId).model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8,
      });
      return { ok: true, message: res.choices?.[0]?.message?.content || 'ok' };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }
}
