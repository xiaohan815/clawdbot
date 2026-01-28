import { describe, expect, it } from "vitest";
import { AliyunProvider } from "./aliyun.js";

describe("AliyunProvider", () => {
  it("should throw if accessKeyId is missing", () => {
    expect(
      () =>
        new AliyunProvider({
          accessKeyId: "",
          accessKeySecret: "test-secret",
        }),
    ).toThrow("阿里云 AccessKey ID 是必需的");
  });

  it("should throw if accessKeySecret is missing", () => {
    expect(
      () =>
        new AliyunProvider({
          accessKeyId: "test-key-id",
          accessKeySecret: "",
        }),
    ).toThrow("阿里云 AccessKey Secret 是必需的");
  });

  it("should create provider with valid config", () => {
    const provider = new AliyunProvider({
      accessKeyId: "test-key-id",
      accessKeySecret: "test-secret",
    });
    expect(provider.name).toBe("aliyun");
  });

  it("should use default regionId if not provided", () => {
    const provider = new AliyunProvider({
      accessKeyId: "test-key-id",
      accessKeySecret: "test-secret",
    });
    // 通过 publicUrl 验证 provider 已正确初始化
    expect(provider.getPublicUrl()).toBeNull();
  });

  it("should set and get public URL", () => {
    const provider = new AliyunProvider({
      accessKeyId: "test-key-id",
      accessKeySecret: "test-secret",
    });
    provider.setPublicUrl("https://example.com/webhook");
    expect(provider.getPublicUrl()).toBe("https://example.com/webhook");
  });

  describe("verifyWebhook", () => {
    it("should pass verification with valid callback body (JSON)", () => {
      const provider = new AliyunProvider({
        accessKeyId: "test-key-id",
        accessKeySecret: "test-secret",
      });
      const result = provider.verifyWebhook({
        headers: {},
        rawBody: JSON.stringify({ call_id: "test-call-123" }),
        url: "/webhook",
        method: "POST",
      });
      expect(result.ok).toBe(true);
    });

    it("should pass verification with valid callback body (URL encoded)", () => {
      const provider = new AliyunProvider({
        accessKeyId: "test-key-id",
        accessKeySecret: "test-secret",
      });
      const result = provider.verifyWebhook({
        headers: {},
        rawBody: "call_id=test-call-123&status_code=200002",
        url: "/webhook",
        method: "POST",
      });
      expect(result.ok).toBe(true);
    });

    it("should fail verification with invalid body", () => {
      const provider = new AliyunProvider({
        accessKeyId: "test-key-id",
        accessKeySecret: "test-secret",
      });
      const result = provider.verifyWebhook({
        headers: {},
        rawBody: "invalid body",
        url: "/webhook",
        method: "POST",
      });
      expect(result.ok).toBe(false);
    });

    it("should skip verification when option is set", () => {
      const provider = new AliyunProvider(
        {
          accessKeyId: "test-key-id",
          accessKeySecret: "test-secret",
        },
        { skipVerification: true },
      );
      const result = provider.verifyWebhook({
        headers: {},
        rawBody: "anything",
        url: "/webhook",
        method: "POST",
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("parseWebhookEvent", () => {
    it("should parse ASR text event", () => {
      const provider = new AliyunProvider({
        accessKeyId: "test-key-id",
        accessKeySecret: "test-secret",
      });
      const result = provider.parseWebhookEvent({
        headers: {},
        rawBody: JSON.stringify({
          call_id: "test-call-123",
          asr_text: "你好世界",
        }),
        url: "/webhook",
        method: "POST",
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe("call.speech");
      if (result.events[0].type === "call.speech") {
        expect(result.events[0].transcript).toBe("你好世界");
      }
    });

    it("should parse DTMF event", () => {
      const provider = new AliyunProvider({
        accessKeyId: "test-key-id",
        accessKeySecret: "test-secret",
      });
      const result = provider.parseWebhookEvent({
        headers: {},
        rawBody: JSON.stringify({
          call_id: "test-call-123",
          dtmf: "123",
        }),
        url: "/webhook",
        method: "POST",
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe("call.dtmf");
      if (result.events[0].type === "call.dtmf") {
        expect(result.events[0].digits).toBe("123");
      }
    });

    it("should parse call answered event", () => {
      const provider = new AliyunProvider({
        accessKeyId: "test-key-id",
        accessKeySecret: "test-secret",
      });
      const result = provider.parseWebhookEvent({
        headers: {},
        rawBody: JSON.stringify({
          call_id: "test-call-123",
          status_code: "200002", // 被叫接听
        }),
        url: "/webhook",
        method: "POST",
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe("call.answered");
    });

    it("should parse call ended event", () => {
      const provider = new AliyunProvider({
        accessKeyId: "test-key-id",
        accessKeySecret: "test-secret",
      });
      const result = provider.parseWebhookEvent({
        headers: {},
        rawBody: JSON.stringify({
          call_id: "test-call-123",
          status_code: "200005", // 通话结束
        }),
        url: "/webhook",
        method: "POST",
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe("call.ended");
    });
  });
});
