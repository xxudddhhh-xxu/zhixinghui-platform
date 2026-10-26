import OpenAI from 'openai';

export interface ModelProviderConfig {
  id: string;
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
  supportsTools: boolean;
}

/** 从环境变量装配多模型(GLM / JPT),均走 OpenAI 兼容协议 */
export function loadModelProviders(): ModelProviderConfig[] {
  const providers: ModelProviderConfig[] = [];
  if (process.env.GLM_BASE_URL && process.env.GLM_API_KEY) {
    providers.push({
      id: process.env.GLM_MODEL_ID || 'glm-5.3',
      label: `GLM (${process.env.GLM_MODEL_ID || 'glm-5.3'})`,
      baseURL: normalizeBaseURL(process.env.GLM_BASE_URL),
      apiKey: process.env.GLM_API_KEY,
      model: process.env.GLM_MODEL_ID || 'glm-5.3',
      supportsTools: true,
    });
  }
  if (process.env.JPT_BASE_URL && process.env.JPT_API_KEY) {
    providers.push({
      id: process.env.JPT_MODEL_ID || 'gpt-5.6-sol',
      label: `JPT (${process.env.JPT_MODEL_ID || 'gpt-5.6-sol'})`,
      baseURL: normalizeBaseURL(process.env.JPT_BASE_URL),
      apiKey: process.env.JPT_API_KEY,
      model: process.env.JPT_MODEL_ID || 'gpt-5.6-sol',
      supportsTools: true,
    });
  }
  return providers;
}

function normalizeBaseURL(url: string): string {
  return /\/v\d+$/.test(url) ? url : `${url.replace(/\/$/, '')}/v1`;
}

export function createClient(cfg: ModelProviderConfig): OpenAI {
  return new OpenAI({
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    timeout: 120_000,
    maxRetries: 1,
  });
}
