---
name: wecom-kh-ops
description: 企业微信客户（wecom-kh）渠道运维与使用技能包。用于：指导如何向微信客服的外部用户发消息、定位与发送图片；规范 target 格式（user:<externalUserId> / wecom-kh:user:<externalUserId>）；排查发送失败等常见问题。
---

# wecom-kh 运维/使用规范（本地技能）

本技能针对 OpenClaw + 企业微信客户（wecom-kh，即微信客服通道）环境提供操作规范。

## 1) Target 与 回复机制

### 1.1 target 格式是什么
向外部微信客户进行主动或被动回复，必须提使用正确的 `target` 格式：

推荐格式：
- `target: "user:<externalUserId>"` 
- `target: "wecom-kh:user:<externalUserId>"`
- `target: "<externalUserId>"`（裸 ID，例如微信客服产生的随机外联 ID）

多账号情况：
- `target: "user:<externalUserId>@<accountId>"`

> **注意：** `externalUserId` 是一串由字母、数字及横线组成的内部 ID，绝不是用户的微信昵称。请务必使用通过事件上报（`bot.ts` / `monitor.ts`）抓取到的真实用户 ID。

### 1.2 主动发送时间窗口
企业微信客服 API 有严格的时间窗口限制：
- **通常在用户主动发消息后的 48 小时内才允许主动回复。** 
- 如果超出窗口，企微会返回特定的系统错误，此时无法强行推送。

### 1.3 `replyTo` 支持
- 由于微信客服的特定机制，通常无需指定 `replyTo` 也能回复；
- 我们依然建议带上原始 `message_id` 用于打通追踪链路，但这不改变企微单流会话的展现。

---

## 2) 如何发送图片或文件

`wecom-kh` 支持调用企业微信官方临时素材上传（`uploadMedia`）然后根据返回的 `media_id` 下发消息。

### 2.1 通过 `message` 工具发图片

你要通过这套框架发送媒体给用户时，依然使用统一格式：

- `channel: "wecom-kh"`
- `target: "user:<externalUserId>"`
- `path: "<本地文件路径>"`
- `replyTo: "<message_id>"`（可选但推荐）

内部的 `sendMedia` API 会自动读取该本地文件，调用微信客服 API 换取 `media_id` 并投递给外联用户。

> **踩坑预警：**
> 1. 请保证文件路径可被 OpenClaw 进城读取。
> 2. 支持 `image` (PNG/JPG)、`voice` (AMR)、`video` (MP4) 以及标准文件。

---

## 3) 发送失败常见排障

### 3.1 `Action send requires a target.` 
- 缺少 Target：检查参数中是否传了 `target: "user:xxx"`。

### 3.2 `Unsupported target for WeCom KH`
- Target 格式完全无效，例如混入了不合法的特殊字符或格式，务必使用 `user:<externalUserId>`。

### 3.3 `Account not configured for sending`
- 表明企微配置缺失：请确认该环境（或配置文件中）是否配置了对应的 `corpId`、`khSecret` 以及 `openKfId`，这三者缺一不可。
- 旧字段 `agentId` 仍兼容，但建议统一迁移到 `openKfId`。

### 3.4 API 反馈 45015 / 45047 等企微业务报错
- 极其常见：超过 48 小时互动窗口、向不存在的用户发送，或者微信客服账号由于未认证/超限额被封锁。
- 此类问题为业务硬性规定，系统/Agent 无法突破。
