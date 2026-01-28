---
title: Voice Call - 阿里云语音服务
description: 使用阿里云语音服务进行语音通话
---

# Voice Call - 阿里云语音服务配置

本文档介绍如何配置 Moltbot Voice Call 插件使用阿里云语音服务 (Aliyun VMS) 进行语音通话。

## 前置条件

1. **阿里云账号** - 需要完成企业实名认证
2. **开通语音服务** - 在阿里云控制台开通语音服务
3. **申请话术报备** - 语音通知内容需要提前报备审核
4. **购买号码** - 在阿里云购买用于外呼的真实号码
5. **配置回调地址** - 需要一个公网可访问的 webhook URL

## 阿里云控制台配置

### 1. 获取 AccessKey

1. 登录 [阿里云控制台](https://console.aliyun.com/)
2. 进入 **AccessKey 管理**（右上角头像 -> AccessKey 管理）
3. 创建 AccessKey，保存 `AccessKey ID` 和 `AccessKey Secret`

> ⚠️ 建议使用 RAM 子账号的 AccessKey，并只授予语音服务相关权限

### 2. 开通语音服务

1. 进入 [语音服务控制台](https://dyvms.console.aliyun.com/)
2. 完成企业资质认证
3. 申请并审核话术模板

### 3. 购买号码

1. 在语音服务控制台 -> 号码管理 -> 购买号码
2. 选择外显号码类型（固话/手机）
3. 记录购买的号码

## Moltbot 配置

### 方式一：使用配置命令（推荐）

```bash
# 1. 从本地源码安装插件（开发模式）
pnpm moltbot plugins install ./extensions/voice-call
cd ./extensions/voice-call && pnpm install

# 2. 启用插件
pnpm moltbot config set plugins.entries.voice-call.enabled true

# 3. 设置 provider 为阿里云
pnpm moltbot config set plugins.entries.voice-call.config.provider aliyun

# 4. 配置阿里云凭证
pnpm moltbot config set plugins.entries.voice-call.config.aliyun.accessKeyId "你的AccessKeyId"
pnpm moltbot config set plugins.entries.voice-call.config.aliyun.accessKeySecret "你的AccessKeySecret"

# 5. 设置区域（可选，默认 cn-hangzhou）
pnpm moltbot config set plugins.entries.voice-call.config.aliyun.regionId "cn-hangzhou"

# 6. 设置外呼号码（在阿里云购买的号码）
pnpm moltbot config set plugins.entries.voice-call.config.fromNumber "+8612345678901"

# 7. 设置默认被叫号码（可选）
pnpm moltbot config set plugins.entries.voice-call.config.toNumber "+8613800138000"

# 8. 配置 webhook 服务
pnpm moltbot config set plugins.entries.voice-call.config.serve.port 3334
pnpm moltbot config set plugins.entries.voice-call.config.serve.path "/voice/webhook"

# 9. 设置公网回调 URL（必须是阿里云可访问的公网地址）
pnpm moltbot config set plugins.entries.voice-call.config.publicUrl "https://你的域名/voice/webhook"

# 10. 重启 Gateway 使配置生效
systemctl --user restart moltbot-gateway
```

### 方式二：使用环境变量

```bash
# 在 ~/.bashrc 或 ~/.profile 中添加
export ALIYUN_ACCESS_KEY_ID="你的AccessKeyId"
export ALIYUN_ACCESS_KEY_SECRET="你的AccessKeySecret"
export ALIYUN_REGION_ID="cn-hangzhou"
```

### 方式三：直接编辑配置文件

编辑 `~/.clawdbot/config.json`:

```json5
{
  "plugins": {
    "entries": {
      "voice-call": {
        "enabled": true,
        "config": {
          "provider": "aliyun",
          
          // 阿里云凭证
          "aliyun": {
            "accessKeyId": "你的AccessKeyId",
            "accessKeySecret": "你的AccessKeySecret",
            "regionId": "cn-hangzhou"
          },
          
          // 号码配置
          "fromNumber": "+8612345678901",
          "toNumber": "+8613800138000",
          
          // Webhook 服务配置
          "serve": {
            "port": 3334,
            "bind": "0.0.0.0",
            "path": "/voice/webhook"
          },
          
          // 公网 URL（阿里云回调地址）
          "publicUrl": "https://你的域名/voice/webhook",
          
          // 通话设置
          "maxDurationSeconds": 300,
          "outbound": {
            "defaultMode": "conversation"
          }
        }
      }
    }
  }
}
```

## 公网暴露方案

阿里云语音服务需要能够回调到你的服务器，以下是几种常见方案：

### 方案一：使用 ngrok（开发测试）

```bash
# 安装 ngrok
npm install -g ngrok

# 启动隧道
ngrok http 3334

# 将 ngrok 提供的 URL 设置为 publicUrl
pnpm moltbot config set plugins.entries.voice-call.config.publicUrl "https://xxxx.ngrok.io/voice/webhook"
```

### 方案二：使用 Tailscale Funnel

```bash
# 配置 Tailscale funnel
pnpm moltbot config set plugins.entries.voice-call.config.tunnel.provider "tailscale-funnel"
```

### 方案三：直接公网部署

如果服务器有公网 IP，直接配置 nginx 反向代理：

```nginx
server {
    listen 443 ssl;
    server_name 你的域名;
    
    location /voice/webhook {
        proxy_pass http://127.0.0.1:3334;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 使用方法

### CLI 命令

```bash
# 发起语音通话
pnpm moltbot voicecall call --to "+8613800138000" --message "你好，这是一条测试消息"

# 查看通话状态
pnpm moltbot voicecall status --call-id <call-id>

# 继续对话
pnpm moltbot voicecall continue --call-id <call-id> --message "还有什么需要帮助的吗？"

# 挂断通话
pnpm moltbot voicecall end --call-id <call-id>
```

### Agent Tool

在 agent 对话中使用 `voice_call` 工具：

```
用户: 帮我打电话给 13800138000，告诉他明天的会议改到下午3点

Agent: [调用 voice_call 工具]
{
  "action": "initiate_call",
  "to": "+8613800138000",
  "message": "您好，这里是会议通知。明天的会议时间已调整为下午3点，请您知悉。"
}
```

## 通话模式

### notify 模式（单向通知）

播放消息后自动挂断，适用于通知、提醒场景：

```bash
pnpm moltbot config set plugins.entries.voice-call.config.outbound.defaultMode "notify"
pnpm moltbot config set plugins.entries.voice-call.config.outbound.notifyHangupDelaySec 3
```

### conversation 模式（双向对话）

保持通话等待用户回复，适用于交互场景：

```bash
pnpm moltbot config set plugins.entries.voice-call.config.outbound.defaultMode "conversation"
```

## 注意事项

1. **号码格式** - 阿里云使用中国号码时不需要 +86 前缀，但 Moltbot 统一使用 E.164 格式（+86...），provider 会自动转换

2. **话术报备** - 所有语音通知内容需要在阿里云控制台提前报备审核，未报备的内容可能被拦截

3. **费用** - 语音通话按分钟计费，具体价格参考[阿里云语音服务定价](https://help.aliyun.com/zh/vms/product-overview/voice-services-pricing-in-china)

4. **并发限制** - 默认最大并发通话数为 1，可通过配置调整：
   ```bash
   pnpm moltbot config set plugins.entries.voice-call.config.maxConcurrentCalls 5
   ```

5. **区域选择** - 建议使用 `cn-hangzhou`（杭州），这是阿里云语音服务的主区域

## 故障排查

### 检查配置

```bash
pnpm moltbot config get plugins.entries.voice-call
```

### 查看 Gateway 日志

```bash
journalctl --user -u moltbot-gateway -f
```

### 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| `AccessKey ID 是必需的` | 未配置 accessKeyId | 检查配置或环境变量 |
| `签名验证失败` | AccessKey 错误或过期 | 重新生成 AccessKey |
| `号码格式错误` | fromNumber 格式不正确 | 使用 E.164 格式 (+86...) |
| `回调地址不可达` | publicUrl 配置错误 | 确保 URL 公网可访问 |

## 参考链接

- [阿里云语音服务文档](https://help.aliyun.com/zh/vms/)
- [智能外呼 API 文档](https://help.aliyun.com/zh/vms/developer-reference/api-dyvmsapi-2017-05-25-smartcall)
- [语音服务定价](https://help.aliyun.com/zh/vms/product-overview/voice-services-pricing-in-china)
