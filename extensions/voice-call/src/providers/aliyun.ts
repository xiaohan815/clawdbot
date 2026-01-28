import crypto from "node:crypto";

import type { AliyunConfig } from "../config.js";
import type { MediaStreamHandler } from "../media-stream.js";
import type {
  HangupCallInput,
  InitiateCallInput,
  InitiateCallResult,
  NormalizedEvent,
  PlayTtsInput,
  ProviderWebhookParseResult,
  StartListeningInput,
  StopListeningInput,
  WebhookContext,
  WebhookVerificationResult,
} from "../types.js";
import type { TelephonyTtsProvider } from "../telephony-tts.js";
import type { VoiceCallProvider } from "./base.js";

/**
 * 阿里云语音服务 Provider 实现
 *
 * 支持两种模式:
 * 1. 智能外呼 (SmartCall) - 支持双向语音对话，实时 ASR/TTS
 * 2. 语音 IVR (IvrCall) - 支持按键交互
 *
 * @see https://help.aliyun.com/zh/vms/developer-reference/api-dyvmsapi-2017-05-25-overview
 */
export interface AliyunProviderOptions {
  /** 公网回调 URL */
  publicUrl?: string;
  /** 跳过签名验证（仅开发环境） */
  skipVerification?: boolean;
  /** WebSocket 流路径 */
  streamPath?: string;
}

export class AliyunProvider implements VoiceCallProvider {
  readonly name = "aliyun" as const;

  private readonly accessKeyId: string;
  private readonly accessKeySecret: string;
  private readonly regionId: string;
  private readonly endpoint: string;
  private readonly options: AliyunProviderOptions;

  /** 当前公网 webhook URL */
  private currentPublicUrl: string | null = null;

  /** TTS provider（用于流式 TTS） */
  private ttsProvider: TelephonyTtsProvider | null = null;

  /** 媒体流处理器 */
  private mediaStreamHandler: MediaStreamHandler | null = null;

  /** 通话 ID 映射 (callId -> providerCallId) */
  private callIdMap = new Map<string, string>();

  /** 通话状态存储 */
  private callStates = new Map<
    string,
    {
      state: string;
      from: string;
      to: string;
      startedAt: number;
    }
  >();

  constructor(config: AliyunConfig, options: AliyunProviderOptions = {}) {
    if (!config.accessKeyId) {
      throw new Error("阿里云 AccessKey ID 是必需的");
    }
    if (!config.accessKeySecret) {
      throw new Error("阿里云 AccessKey Secret 是必需的");
    }

    this.accessKeyId = config.accessKeyId;
    this.accessKeySecret = config.accessKeySecret;
    this.regionId = config.regionId ?? "cn-hangzhou";
    this.endpoint =
      config.endpoint ?? `dyvmsapi.${this.regionId}.aliyuncs.com`;
    this.options = options;

    if (options.publicUrl) {
      this.currentPublicUrl = options.publicUrl;
    }
  }

  setPublicUrl(url: string): void {
    this.currentPublicUrl = url;
  }

  getPublicUrl(): string | null {
    return this.currentPublicUrl;
  }

  setTTSProvider(provider: TelephonyTtsProvider): void {
    this.ttsProvider = provider;
  }

  setMediaStreamHandler(handler: MediaStreamHandler): void {
    this.mediaStreamHandler = handler;
  }

  // ---------------------------------------------------------------------------
  // 阿里云 API 签名
  // ---------------------------------------------------------------------------

  /**
   * 生成阿里云 API 签名
   * @see https://help.aliyun.com/zh/sdk/product-overview/rpc-mechanism
   */
  private sign(params: Record<string, string>): string {
    // 1. 按参数名排序
    const sortedKeys = Object.keys(params).sort();
    const canonicalizedQueryString = sortedKeys
      .map(
        (key) =>
          `${this.percentEncode(key)}=${this.percentEncode(params[key])}`,
      )
      .join("&");

    // 2. 构造待签名字符串
    const stringToSign = `POST&${this.percentEncode("/")}&${this.percentEncode(canonicalizedQueryString)}`;

    // 3. 计算 HMAC-SHA1 签名
    const hmac = crypto.createHmac("sha1", `${this.accessKeySecret}&`);
    hmac.update(stringToSign);
    return hmac.digest("base64");
  }

  /**
   * 阿里云特殊的 URL 编码
   */
  private percentEncode(str: string): string {
    return encodeURIComponent(str)
      .replace(/!/g, "%21")
      .replace(/'/g, "%27")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/\*/g, "%2A");
  }

  /**
   * 生成公共请求参数
   */
  private getCommonParams(action: string): Record<string, string> {
    return {
      Format: "JSON",
      Version: "2017-05-25",
      AccessKeyId: this.accessKeyId,
      SignatureMethod: "HMAC-SHA1",
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      SignatureVersion: "1.0",
      SignatureNonce: crypto.randomUUID(),
      Action: action,
      RegionId: this.regionId,
    };
  }

  /**
   * 发起 API 请求
   */
  private async apiRequest<T = unknown>(
    action: string,
    params: Record<string, string>,
  ): Promise<T> {
    const allParams = {
      ...this.getCommonParams(action),
      ...params,
    };

    // 计算签名
    const signature = this.sign(allParams);
    allParams.Signature = signature;

    // 发起请求
    const url = `https://${this.endpoint}/`;
    const body = new URLSearchParams(allParams).toString();

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`阿里云 API 请求失败 (${response.status}): ${text}`);
    }

    const result = (await response.json()) as T;
    return result;
  }

  // ---------------------------------------------------------------------------
  // VoiceCallProvider 接口实现
  // ---------------------------------------------------------------------------

  /**
   * 验证阿里云回调签名
   *
   * 阿里云回调使用 HTTP Basic Auth 或签名验证
   * @see https://help.aliyun.com/zh/vms/developer-reference/callback-http-interface
   */
  verifyWebhook(ctx: WebhookContext): WebhookVerificationResult {
    if (this.options.skipVerification) {
      return { ok: true };
    }

    // 阿里云回调验证方式：
    // 1. 检查请求来源 IP（可选）
    // 2. 验证回调中的签名参数（如果配置了）

    // 简单实现：检查是否包含必要的回调参数
    try {
      const body = JSON.parse(ctx.rawBody);
      if (body.call_id || body.CallId) {
        return { ok: true };
      }
    } catch {
      // 尝试解析为 URL 编码格式
      const params = new URLSearchParams(ctx.rawBody);
      if (params.get("call_id") || params.get("CallId")) {
        return { ok: true };
      }
    }

    return { ok: false, reason: "无效的回调请求" };
  }

  /**
   * 解析阿里云回调事件
   */
  parseWebhookEvent(ctx: WebhookContext): ProviderWebhookParseResult {
    try {
      let body: Record<string, unknown>;

      // 尝试解析 JSON
      try {
        body = JSON.parse(ctx.rawBody);
      } catch {
        // 尝试解析 URL 编码
        const params = new URLSearchParams(ctx.rawBody);
        body = Object.fromEntries(params.entries());
      }

      const event = this.normalizeEvent(body);

      return {
        events: event ? [event] : [],
        providerResponseBody: JSON.stringify({ code: "OK" }),
        providerResponseHeaders: { "Content-Type": "application/json" },
        statusCode: 200,
      };
    } catch {
      return { events: [], statusCode: 400 };
    }
  }

  /**
   * 将阿里云回调转换为标准化事件
   */
  private normalizeEvent(
    body: Record<string, unknown>,
  ): NormalizedEvent | null {
    // 获取通话 ID
    const callId =
      (body.call_id as string) ||
      (body.CallId as string) ||
      (body.callId as string) ||
      "";
    if (!callId) return null;

    const baseEvent = {
      id: crypto.randomUUID(),
      callId,
      providerCallId: callId,
      timestamp: Date.now(),
      from: (body.caller as string) || (body.CallerNumber as string),
      to: (body.callee as string) || (body.CalledNumber as string),
    };

    // 处理 DTMF 按键（优先处理，因为 DTMF 是明确的按键输入）
    const digits = (body.dtmf as string) || (body.Dtmf as string);
    if (digits) {
      return { ...baseEvent, type: "call.dtmf", digits };
    }

    // 处理智能外呼 ASR 结果
    const asrText = (body.asr_text as string) || (body.AsrText as string);
    if (asrText) {
      return {
        ...baseEvent,
        type: "call.speech",
        transcript: asrText,
        isFinal: true,
        confidence: 0.9,
      };
    }


    // 处理通话状态
    const status =
      (body.status_code as string) ||
      (body.StatusCode as string) ||
      (body.call_status as string) ||
      (body.CallStatus as string);

    switch (status) {
      case "200000": // 正在通话
      case "in-progress":
        return { ...baseEvent, type: "call.answered" };
      case "200001": // 被叫振铃
      case "ringing":
        return { ...baseEvent, type: "call.ringing" };
      case "200002": // 被叫接听
      case "answered":
        return { ...baseEvent, type: "call.answered" };
      case "200003": // 用户挂机
      case "hangup":
        return { ...baseEvent, type: "call.ended", reason: "hangup-user" };
      case "200004": // 主叫挂机
        return { ...baseEvent, type: "call.ended", reason: "hangup-bot" };
      case "200005": // 通话结束
      case "completed":
        return { ...baseEvent, type: "call.ended", reason: "completed" };
      case "400001": // 被叫关机
      case "400002": // 被叫停机
      case "400003": // 被叫无法接通
      case "failed":
        return { ...baseEvent, type: "call.ended", reason: "failed" };
      case "400004": // 被叫无应答
      case "no-answer":
        return { ...baseEvent, type: "call.ended", reason: "no-answer" };
      case "400005": // 被叫占线
      case "busy":
        return { ...baseEvent, type: "call.ended", reason: "busy" };
      default:
        return null;
    }
  }

  /**
   * 发起外呼
   *
   * 使用 SmartCall API 进行智能外呼（支持双向对话）
   */
  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    // 构建回调 URL
    const webhookUrl = new URL(input.webhookUrl);
    webhookUrl.searchParams.set("callId", input.callId);

    // 使用 SmartCall API（智能外呼，支持双向对话）
    const params: Record<string, string> = {
      CalledShowNumber: input.from.replace(/^\+/, ""), // 阿里云不需要 + 前缀
      CalledNumber: input.to.replace(/^\+86/, ""), // 中国号码去掉 +86
      ActionCodeBreak: "true", // 允许用户打断
      SessionTimeout: "120", // 会话超时（秒）
      ActionCodeTimeBreak: "120", // 静默超时（秒）
      OutId: input.callId, // 外部 ID
    };

    // 如果有初始消息，设置 TTS 文本
    if (input.inlineTwiml) {
      // 从 TwiML 中提取文本（简单解析）
      const textMatch = input.inlineTwiml.match(/<Say[^>]*>([^<]+)<\/Say>/);
      if (textMatch) {
        params.TtsParam = JSON.stringify({ text: textMatch[1] });
        params.TtsCode = "TTS_SMART_CALL"; // 需要在阿里云控制台配置
      }
    }

    // 设置回调地址
    if (this.currentPublicUrl) {
      params.VoiceCodeParam = JSON.stringify({
        asr_callback_url: webhookUrl.toString(),
        status_callback_url: webhookUrl.toString(),
      });
    }

    interface SmartCallResponse {
      Code: string;
      Message: string;
      RequestId: string;
      CallId: string;
    }

    const result = await this.apiRequest<SmartCallResponse>(
      "SmartCall",
      params,
    );

    if (result.Code !== "OK") {
      throw new Error(`发起呼叫失败: ${result.Message}`);
    }

    // 保存映射
    this.callIdMap.set(input.callId, result.CallId);
    this.callStates.set(input.callId, {
      state: "initiated",
      from: input.from,
      to: input.to,
      startedAt: Date.now(),
    });

    return {
      providerCallId: result.CallId,
      status: "initiated",
    };
  }

  /**
   * 挂断通话
   */
  async hangupCall(input: HangupCallInput): Promise<void> {
    // 使用 SmartCallOperate API 发送挂机指令
    const params: Record<string, string> = {
      CallId: input.providerCallId,
      Command: "hangup", // 挂机指令
    };

    interface SmartCallOperateResponse {
      Code: string;
      Message: string;
      RequestId: string;
    }

    await this.apiRequest<SmartCallOperateResponse>(
      "SmartCallOperate",
      params,
    );

    // 清理状态
    this.callIdMap.delete(input.callId);
    this.callStates.delete(input.callId);
  }

  /**
   * 播放 TTS
   *
   * 使用 SmartCallOperate API 发送 TTS 指令
   */
  async playTts(input: PlayTtsInput): Promise<void> {
    // 尝试使用自定义 TTS provider（通过媒体流）
    if (this.ttsProvider && this.mediaStreamHandler) {
      // TODO: 实现媒体流 TTS
      console.warn(
        "[voice-call/aliyun] 媒体流 TTS 暂未实现，使用阿里云原生 TTS",
      );
    }

    // 使用阿里云原生 TTS
    const params: Record<string, string> = {
      CallId: input.providerCallId,
      Command: "tts", // TTS 指令
      Param: JSON.stringify({
        text: input.text,
        // voice: input.voice, // 阿里云使用不同的声音配置
      }),
    };

    interface SmartCallOperateResponse {
      Code: string;
      Message: string;
      RequestId: string;
    }

    await this.apiRequest<SmartCallOperateResponse>(
      "SmartCallOperate",
      params,
    );
  }

  /**
   * 开始监听用户语音
   *
   * 智能外呼模式下，ASR 是自动启用的
   */
  async startListening(_input: StartListeningInput): Promise<void> {
    // 阿里云智能外呼的 ASR 是自动开启的
    // 这里不需要额外操作
  }

  /**
   * 停止监听
   */
  async stopListening(_input: StopListeningInput): Promise<void> {
    // 阿里云智能外呼的 ASR 是自动的
    // 这里不需要额外操作
  }
}

// -----------------------------------------------------------------------------
// 阿里云特定类型
// -----------------------------------------------------------------------------

// API 响应类型在方法内部定义，避免导出不必要的类型
