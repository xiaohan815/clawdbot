import { resolveEnvApiKey } from "../agents/model-auth.js";
import type { ClawdbotConfig } from "../config/config.js";
import { formatApiKeyPreview, normalizeApiKeyInput } from "./auth-choice.api-key.js";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyAuthProfileConfig } from "./onboard-auth.js";
import { setOllamaApiKey } from "./onboard-auth.credentials.js";

// Ollama 的默认 API key（Ollama 不需要真正的 key，任意值即可）
const OLLAMA_DEFAULT_API_KEY = "ollama-local";
// Ollama 默认本地地址
const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
// 默认模型（用户可以在模型选择器中更改）
const OLLAMA_DEFAULT_MODEL_REF = "ollama/llama3.3";

/**
 * 验证 Ollama base URL 格式
 */
function validateOllamaBaseUrl(value: string): string | undefined {
  if (!value?.trim()) return undefined; // 允许空值（使用默认）
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "URL must start with http:// or https://";
    }
    return undefined;
  } catch {
    return "Invalid URL format (e.g., http://192.168.1.100:11434/v1)";
  }
}

/**
 * 将 Ollama 配置应用到配置对象
 */
function applyOllamaProviderConfig(config: ClawdbotConfig, baseUrl?: string): ClawdbotConfig {
  // 如果没有指定 baseUrl，不需要设置 provider（自动发现会生效）
  if (!baseUrl) {
    return config;
  }

  // 设置显式的 provider 配置（远程 Ollama）
  const existingOllama = config.models?.providers?.ollama;
  return {
    ...config,
    models: {
      ...config.models,
      providers: {
        ...config.models?.providers,
        ollama: {
          baseUrl,
          api: "openai-completions",
          // 保留现有的 models，如果没有则设置为空数组
          // 远程 Ollama 需要显式配置 models，或者稍后通过 model discovery 填充
          models: existingOllama?.models ?? [],
        },
      },
    },
  };
}

/**
 * 设置 Ollama 为默认模型
 */
function applyOllamaDefaultModel(config: ClawdbotConfig, model: string): ClawdbotConfig {
  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: {
        ...config.agents?.defaults,
        model: {
          ...(typeof config.agents?.defaults?.model === "object"
            ? config.agents?.defaults?.model
            : {}),
          primary: model,
        },
        models: {
          ...config.agents?.defaults?.models,
          [model]: config.agents?.defaults?.models?.[model] ?? {},
        },
      },
    },
  };
}

/**
 * 处理 Ollama 认证选择
 */
export async function applyAuthChoiceOllama(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "ollama-api-key") {
    return null;
  }

  let nextConfig = params.config;
  let hasCredential = false;

  // 显示 Ollama 说明
  await params.prompter.note(
    [
      "Ollama is a local LLM runtime for running open-source models.",
      "It can run locally or on a remote server.",
      "",
      "Install: https://ollama.ai",
      "Pull a model: ollama pull llama3.3",
      "",
      "Ollama doesn't require a real API key - any value works.",
    ].join("\n"),
    "Ollama",
  );

  // 检查是否存在环境变量中的 key
  const envKey = resolveEnvApiKey("ollama");
  if (envKey) {
    const useExisting = await params.prompter.confirm({
      message: `Use existing OLLAMA_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
      initialValue: true,
    });
    if (useExisting) {
      await setOllamaApiKey(envKey.apiKey, params.agentDir);
      hasCredential = true;
    }
  }

  // 如果没有凭据，提示用户输入
  if (!hasCredential) {
    const key = await params.prompter.text({
      message: "Enter Ollama API key (any value works, e.g., ollama-local)",
      initialValue: OLLAMA_DEFAULT_API_KEY,
      placeholder: OLLAMA_DEFAULT_API_KEY,
    });
    const normalizedKey = normalizeApiKeyInput(String(key)) || OLLAMA_DEFAULT_API_KEY;
    await setOllamaApiKey(normalizedKey, params.agentDir);
  }

  // 设置 auth profile 配置
  nextConfig = applyAuthProfileConfig(nextConfig, {
    profileId: "ollama:default",
    provider: "ollama",
    mode: "api_key",
  });

  // 询问是否使用远程 Ollama
  const isRemote = await params.prompter.confirm({
    message: "Is Ollama running on a remote server?",
    initialValue: false,
  });

  let customBaseUrl: string | undefined;

  if (isRemote) {
    const baseUrlInput = await params.prompter.text({
      message: "Enter Ollama server URL (include port and /v1)",
      initialValue: OLLAMA_DEFAULT_BASE_URL,
      placeholder: "http://192.168.1.100:11434/v1",
      validate: validateOllamaBaseUrl,
    });
    const trimmedUrl = String(baseUrlInput ?? "").trim();
    if (trimmedUrl && trimmedUrl !== OLLAMA_DEFAULT_BASE_URL) {
      customBaseUrl = trimmedUrl;
    }
  }

  // 应用 provider 配置（如果有自定义 URL）
  if (customBaseUrl) {
    nextConfig = applyOllamaProviderConfig(nextConfig, customBaseUrl);
  }

  // 设置默认模型
  if (params.setDefaultModel) {
    // 提示用户输入默认模型
    const modelInput = await params.prompter.text({
      message: "Default Ollama model (you can change this later)",
      initialValue: OLLAMA_DEFAULT_MODEL_REF,
      placeholder: "ollama/llama3.3",
      validate: (value) => {
        if (!value?.trim()) return "Model name is required";
        const trimmed = value.trim();
        // 如果用户没有输入 provider 前缀，自动添加
        if (!trimmed.includes("/")) return undefined;
        if (!trimmed.startsWith("ollama/")) {
          return "Model should start with ollama/ or just the model name";
        }
        return undefined;
      },
    });

    let model = String(modelInput ?? OLLAMA_DEFAULT_MODEL_REF).trim();
    // 如果用户只输入了模型名，自动添加 ollama/ 前缀
    if (!model.includes("/")) {
      model = `ollama/${model}`;
    }

    nextConfig = applyOllamaDefaultModel(nextConfig, model);
    await params.prompter.note(`Default model set to ${model}`, "Model configured");
  }

  return { config: nextConfig };
}
