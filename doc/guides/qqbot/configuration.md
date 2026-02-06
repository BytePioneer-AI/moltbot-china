# QQ 渠道配置指南

本文档用于 QQ 开放平台机器人在 OpenClaw China 中的部署与配置。

仓库地址：<https://github.com/BytePioneer-AI/openclaw-china>  

<div align="center">

  <p>
    <strong>⭐ 如果这个项目对你有帮助，请给我们一个Star！⭐</strong><br>
    <em>您的支持是我们持续改进的动力</em>
  </p>

</div>

## 一、获取 QQ 机器人凭证

### 1. 注册并登录 QQ 开放平台

访问 [QQ 开放平台](https://q.qq.com/#/register)，按提示完成注册并登录。

<p align="center"><img src="../../images/qq-register.png" alt="QQ 注册入口" width="60%" /></p>

注册完成后进入控制台，按页面指引继续。

<p align="center"><img src="../../images/qq-console.png" alt="QQ 控制台" width="60%" /></p>
<p align="center"><img src="../../images/qq-console-steps.png" alt="QQ 控制台步骤" width="60%" /></p>

### 2. 创建机器人应用

进入 [应用管理](https://q.qq.com/#/apps)，选择“机器人”类型创建应用。

<p align="center"><img src="../../images/qq-bot-entry.png" alt="机器人入口" width="60%" /></p>

创建完成后点击进入应用详情页。

### 3. 获取 AppID / AppSecret

在应用详情页获取 `AppID` 与 `AppSecret`，用于配置 OpenClaw。

<p align="center"><img src="../../images/qq-app-credentials.png" alt="AppID 与 AppSecret" width="60%" /></p>

### 4. 开通权限与添加成员

确保机器人具备需要的消息权限，例如：
- C2C 私聊
- 群聊 @
- 频道 @
- 频道私信

<p align="center"><img src="../../images/qq-permissions.png" alt="权限配置" width="60%" /></p>

可选：将机器人加入测试群，便于在 QQ 群中调试。

<p align="center"><img src="../../images/qq-add-to-group.png" alt="添加到群聊" width="60%" /></p>

---

## 二、安装 OpenClaw

### 1. 安装 OpenClaw

```bash
npm install -g openclaw@latest
```

### 2. 安装 OpenClaw China 全渠道插件（方式一：npm）

```bash
openclaw plugins install @openclaw-china/channels
```

### 3. 安装 OpenClaw China 全渠道插件（方式二：从源码安装，全平台通用）

⚠️ Windows 用户注意：由于 OpenClaw 存在 Windows 兼容性问题（spawn npm ENOENT），npm 安装方式暂不可用，请使用方式二。

```bash
git clone https://github.com/BytePioneer-AI/openclaw-china.git
cd openclaw-china
pnpm install
pnpm build
openclaw plugins install -l ./packages/channels
```

更新源码（用于后续升级）：

```bash
git pull origin main
pnpm install
pnpm build
```

---

## 三、配置与启动

### 1. 配置 QQ 渠道

```bash
openclaw config set channels.qqbot.enabled true
openclaw config set channels.qqbot.appId your-app-id
openclaw config set channels.qqbot.clientSecret your-app-secret
openclaw config set channels.qqbot.markdownSupport false
openclaw config set channels.qqbot.dmPolicy open
openclaw config set channels.qqbot.groupPolicy open
openclaw config set channels.qqbot.requireMention true
openclaw config set channels.qqbot.textChunkLimit 1500
openclaw config set channels.qqbot.replyFinalOnly false
openclaw config set gateway.http.endpoints.chatCompletions.enabled true
```

### 2. 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| enabled | boolean | true | 是否启用 QQ 渠道 |
| appId | string | - | QQ 机器人 AppID |
| clientSecret | string | - | QQ 机器人 AppSecret |
| markdownSupport | boolean | false | 是否使用 markdown 消息格式 |
| dmPolicy | string | "open" | 私聊策略：open/pairing/allowlist |
| groupPolicy | string | "open" | 群聊策略：open/allowlist/disabled |
| requireMention | boolean | true | 群聊是否必须 @ 机器人 |
| allowFrom | string[] | [] | 私聊白名单 |
| groupAllowFrom | string[] | [] | 群聊白名单 |
| textChunkLimit | number | 1500 | 文本分块长度 |
| replyFinalOnly | boolean | false | 是否仅发送最终回复 |

---

## 四、能力与限制

- 当前实现支持文本消息收发与图片发送（C2C/群聊）
- QQ C2C/群聊富媒体接口暂不支持通用文件（`file_type=4`，例如 PDF），这是官方接口限制而非插件缺陷，会降级为文本提示
- 频道内暂不支持媒体发送（会降级为文本 + URL）
- 语音/视频媒体能力依赖平台权限与格式限制，需按官方接口开通与验证
- 不支持平台级流式输出
- 定时提醒通过 OpenClaw cron 触发（无需额外配置）

### 3. 启动服务

调试模式（建议先使用，便于查看日志）：

```bash
openclaw gateway --port 18789 --verbose
```

后台运行：

```bash
openclaw daemon start
```
