# 企业微信自建应用配置指南

本指南帮助你在企业微信中创建自建应用，并配置 OpenClaw 接入。

## 自建应用 vs 智能机器人

| 功能            | 智能机器人 (wecom) | 自建应用 (wecom-app) |
| :-------------- | :----------------: | :------------------: |
| 被动回复消息    |         ✅         |          ✅          |
| 主动发送消息    |         ❌         |          ✅          |
| 需要企业认证    |         ❌         |          ❌          |
| 需要 corpSecret |         ❌         |          ✅          |
| 需要 IP 白名单  |         ❌         |          ✅          |
| 配置复杂度      |        简单        |         中等         |

**推荐使用自建应用的场景**：

- 需要主动推送消息给用户
- 需要更灵活的消息发送能力
- 需要调用企业微信 API

## 效果展示

<div align="center">

### 微信入口

<img src="image/configuration/1770106970867.png" width="48%" />
<img src="image/configuration/1770106983366.png" width="48%" />

---

### 对话效果

<img src="image/configuration/1770107297696.png" width="48%" />
<img src="image/configuration/1770273261225.png" width="48%" />

</div>

---

## 前置条件

1. 一个企业微信账号（可使用个人注册的企业）
2. 公网可访问的 HTTPS 服务器（用于接收回调）
3. OpenClaw 已安装并运行
4. Node.js 和 pnpm（用于构建插件）

---

## 步骤零：安装 wecom-app 插件

### 1. 克隆代码仓库

```bash
cd ~/.openclaw/extensions
git clone https://github.com/RainbowRain9/openclaw-china.git
```

### 2. 进入插件目录并安装依赖

```bash
cd ~/.openclaw/extensions/openclaw-china/extensions/wecom-app
pnpm install
```

### 3. 构建插件

```bash
pnpm build
```

### 4. 安装到 OpenClaw

```bash
openclaw plugins install -l ~/.openclaw/extensions/openclaw-china/extensions/wecom-app
```

> **提示**：`-l` 参数表示链接模式安装，修改源码后无需重新安装，只需重启 Gateway 即可生效。

### 5. 验证安装

```bash
openclaw plugins list
```

确认 `@openclaw-china/wecom-app` 出现在插件列表中。

---

## 步骤一：创建自建应用

### 1. 登录企业微信管理后台

访问 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame) 并登录。

### 2. 创建应用

1. 点击左侧菜单「应用管理」
2. 在「自建」区域点击「创建应用」

   <img src="image/configuration/1770105395578.png" />
3. 填写应用信息：

   - **应用名称**：例如 "AI 助手"
   - **应用 logo**：上传一个图标
   - **可见范围**：选择可以使用该应用的部门/成员

<img src="image/configuration/1770105469298.png" />

4. 点击「创建应用」

### 3. 获取应用凭证

创建成功后，进入应用详情页，记录以下信息：

- **AgentId**：应用的唯一标识（如 `1000002`）
- **Secret**：点击查看获取（这就是 `corpSecret`）

<img src="image/configuration/1770105739884.png" />

### 4. 获取企业 ID

1. 点击左侧菜单「我的企业」
2. 在「企业信息」页面底部找到「企业 ID」
3. 记录这个 ID（这就是 `corpId`）

<img src="image/configuration/1770105784942.png" />

---

## 步骤二：配置接收消息服务器

### 1. 进入应用设置

1. 在应用详情页，找到「接收消息」设置
2. 点击「设置 API 接收」

### 2. 填写服务器配置

- **URL**：你的公网回调地址，例如 `https://your.domain/wecom-app`
- **Token**：自定义一个字符串，例如 `your-random-token`
- **EncodingAESKey**：点击「随机获取」生成 43 位字符

<img src="image/configuration/1770106232112.png" />

> ⚠️ **重要**：先配置好 OpenClaw，再点击「保存」，否则验证会失败。

<img src="image/configuration/1770106267509.png" />

### 3. 配置 IP 白名单

在应用详情页的「企业可信 IP」设置中，添加你服务器的公网 IP 地址。

<img src="image/configuration/1770106297408.png" />

> 💡 如果不知道服务器 IP，可以先尝试发送消息，查看错误日志获取 IP。

---

## 步骤三：配置 OpenClaw

### 使用命令行配置

**Linux/macOS**：

```bash
openclaw config set channels.wecom-app '{
  "enabled": true,
  "webhookPath": "/wecom-app",
  "token": "your-random-token",
  "encodingAESKey": "your-43-char-encoding-aes-key",
  "corpId": "your-corp-id",
  "corpSecret": "your-app-secret",
  "agentId": 1000002
}' --json
```

**Windows CMD**：

```cmd
openclaw config set channels.wecom-app.enabled true
openclaw config set channels.wecom-app.webhookPath /wecom-app
openclaw config set channels.wecom-app.token your-random-token
openclaw config set channels.wecom-app.encodingAESKey your-43-char-encoding-aes-key
openclaw config set channels.wecom-app.corpId your-corp-id
openclaw config set channels.wecom-app.corpSecret your-app-secret
openclaw config set channels.wecom-app.agentId 1000002
```

### 或直接编辑配置文件

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "channels": {
    "wecom-app": {
      "enabled": true,
      "webhookPath": "/wecom-app",
      "token": "your-random-token",
      "encodingAESKey": "your-43-char-encoding-aes-key",
      "corpId": "your-corp-id",
      "corpSecret": "your-app-secret",
      "agentId": 1000002,
      "inboundMedia": {
        "enabled": true,
        "maxBytes": 10485760,
        "keepDays": 7
      }
    }
  }
}
```

### 配置说明

| 字段                      | 必填 | 说明                                                                    |
| :------------------------ | :--: | :---------------------------------------------------------------------- |
| `enabled`               |  ✅  | 是否启用该渠道                                                          |
| `webhookPath`           |  ✅  | 回调路径，需与企业微信后台配置一致                                      |
| `token`                 |  ✅  | 消息校验 Token，需与企业微信后台配置一致                                |
| `encodingAESKey`        |  ✅  | 消息加密密钥（43 位），需与企业微信后台配置一致                         |
| `corpId`                |  ✅  | 企业 ID                                                                 |
| `corpSecret`            |  ✅  | 应用的 Secret                                                           |
| `agentId`               |  ✅  | 应用的 AgentId                                                          |
| `welcomeText`           |  ❌  | 用户首次进入时的欢迎语                                                  |
| `inboundMedia.enabled`  |  ❌  | 是否启用入站媒体落盘（默认启用）                                        |
| `inboundMedia.dir`      |  ❌  | 入站媒体归档目录（跨平台默认：`~/.openclaw/media/wecom-app/inbound`） |
| `inboundMedia.maxBytes` |  ❌  | 单个入站媒体最大字节数（默认 10MB）                                     |
| `inboundMedia.keepDays` |  ❌  | 入站媒体保留天数（默认 7 天；用于自动清理）                             |

---

## 步骤四：重启 Gateway

```bash
openclaw gateway restart
```

---

## 步骤五：验证配置

### 1. 回到企业微信后台保存配置

现在 OpenClaw 已启动，回到企业微信后台的「接收消息」设置，点击「保存」。

如果配置正确，会提示保存成功。

### 2. 测试消息收发

1. 在企业微信 App 中打开你创建的应用
2. 发送一条消息
3. 查看 OpenClaw 日志确认消息接收
4. 等待 AI 回复

---

## 步骤六：在个人微信使用

### 1.回到企业微信后台

回到企业微信后台的「我的企业」设置下的微信插件

![微信插件](image/configuration/1770110656555.png)

用个人微信扫码「邀请关注」的二维码就可以在个人微信上打开入口

---

## 入站媒体（图片/语音/文件）落盘说明

为了支持图片 OCR、回发原图、以及排查问题，wecom-app 会把入站媒体文件落盘保存。

- 文件会被归档到：`inboundMedia.dir/YYYY-MM-DD/`
- 消息正文里会显示：`[image] saved:<本地路径>`（该路径为稳定归档路径，便于后续处理）
- 自动清理由 `inboundMedia.keepDays` 控制（默认 7 天）

**为什么还会用 tmp 中转？**

内部会先下载到系统临时目录，再原子移动到归档目录，以避免“半文件/下载失败”污染归档目录。

**跨平台默认路径**

- Linux/macOS：`~/.openclaw/media/wecom-app/inbound`
- Windows：`%USERPROFILE%\.openclaw\media\wecom-app\inbound`

如需自定义，请设置：`channels.wecom-app.inboundMedia.dir`

---

## 常见问题

### Q: 保存配置时提示验证失败？

1. 检查 OpenClaw 是否已启动并监听正确端口
2. 确认 `webhookPath` 与后台 URL 路径一致
3. 确认 `token` 和 `encodingAESKey` 与后台配置完全一致
4. 确认服务器公网可访问（可用 `curl` 测试）

### Q: 消息接收成功但发送失败？

1. 检查 `corpId`、`corpSecret`、`agentId` 是否正确
2. 检查是否已配置 IP 白名单
3. 查看 OpenClaw 日志获取详细错误信息

### Q: 如何获取服务器 IP 地址？

运行以下命令：

```bash
curl ifconfig.me
```

或查看 OpenClaw 发送消息的错误日志，企业微信会返回需要添加白名单的 IP。

### Q: Token 和 EncodingAESKey 可以自己生成吗？

- **Token**：可以是任意字符串
- **EncodingAESKey**：必须是 43 位的 Base64 字符，建议使用企业微信后台的「随机获取」功能

---

## 高级配置

### 访问控制

```json
{
  "channels": {
    "wecom-app": {
      "enabled": true,
      "dmPolicy": "open",
      "groupPolicy": "open",
      "requireMention": false,
      "allowFrom": [],
      "groupAllowFrom": []
    }
  }
}
```

| 字段               | 说明                                                                        |
| :----------------- | :-------------------------------------------------------------------------- |
| `dmPolicy`       | 私聊策略：`open`（任何人）/ `allowlist`（白名单）                       |
| `groupPolicy`    | 群聊策略：`open`（任何群）/ `allowlist`（白名单）/ `disabled`（禁用） |
| `requireMention` | 群聊是否需要 @机器人                                                        |
| `allowFrom`      | 私聊白名单用户 ID 列表                                                      |
| `groupAllowFrom` | 群聊白名单群 ID 列表                                                        |

### 多账户配置

如需配置多个自建应用，可以使用 accounts 对象（键为账户 ID）：

```json
{
  "channels": {
    "wecom-app": {
      "enabled": true,
      "accounts": {
        "app1": {
          "webhookPath": "/wecom-app-1",
          "token": "token-1",
          "encodingAESKey": "key-1",
          "corpId": "corp-id",
          "corpSecret": "secret-1",
          "agentId": 1000002
        },
        "app2": {
          "webhookPath": "/wecom-app-2",
          "token": "token-2",
          "encodingAESKey": "key-2",
          "corpId": "corp-id",
          "corpSecret": "secret-2",
          "agentId": 1000003
        }
      }
    }
  }
}
```

---

## （可选）安装 wecom-app 运维/使用 Skill

本仓库提供本地技能包：`extensions/wecom-app/skills/wecom-app-ops`，用于指导 wecom-app 常见操作（如何获取/规范化 target、如何回发图片/录音/文件、如何使用 saved 路径做 OCR、常见报错排障等）。

**安装到 Workspace（推荐）**

```bash
# 在你的 OpenClaw workspace 目录下执行
mkdir -p ./skills
cp -a /path/to/openclaw-china/extensions/wecom-app/skills/wecom-app-ops ./skills/
```

**安装到全局**

```bash
mkdir -p ~/.openclaw/skills
cp -a /path/to/openclaw-china/extensions/wecom-app/skills/wecom-app-ops ~/.openclaw/skills/
```

复制后一般无需重启网关；**如果你希望立刻出现在“可触发 skills 列表”里**，建议重启一次 Gateway 以刷新 skills 索引。

---

## wecom-app 已实现功能清单（Feature List）

本插件当前已实现/覆盖：

### 入站（接收消息）

- Webhook 接收回调
- 签名校验 + 解密/加密回包
- 支持 **JSON + XML** 两种入站格式
- 长文本分片（企业微信单条约 2048 bytes 限制）
- stream 占位/刷新（为适配企业微信 5 秒响应限制的缓冲式输出）

### 入站媒体（产品级留存）

**Why / 设计动机**

- 产品化目标是“消息里的 `saved:` 路径可长期复用”，而不是依赖 `/tmp` 这类易被清理的短期目录。
- 这样 OCR/MCP、二次回发、归档/审计等流程才不会因为文件丢失而不稳定。
- 支持 `image` / `voice` / `file` / `mixed`
- 优先通过 `MediaId` 下载媒体；必要时回退 URL（如图片 PicUrl）
- 媒体落盘：先 tmp 中转，再归档到 `inboundMedia.dir/YYYY-MM-DD/`
- 消息体注入稳定路径：`[image] saved:/...` / `[voice] saved:/...` / `[file] saved:/...`
- 过期清理：按 `inboundMedia.keepDays` 延迟清理（避免“回复后立刻删”导致 OCR/回发失败）
- 大小限制：按 `inboundMedia.maxBytes` 限制单文件大小

### 出站（主动发送）

- 支持主动发送文本
- 支持主动发送媒体（按 MIME/扩展名识别 image/voice/file）
- Markdown 降级：`stripMarkdown()` 将 Markdown 转为企业微信可显示的纯文本

### 目标解析与路由

- 支持多种 target 输入格式：
  - `wecom-app:user:<id>` / `wecom-app:group:<id>`
  - `user:<id>` / `group:<id>`
  - 裸 id（默认当 user）
  - `xxx@accountId`（带账号选择）

### 多账号与策略

- 支持 `defaultAccount` + `accounts` 多账号
- DM 策略：`dmPolicy`（open/pairing/allowlist/disabled）
- 群策略：`groupPolicy`（open/allowlist/disabled）
- 群 @ 要求：`requireMention`
- allowlist：`allowFrom` / `groupAllowFrom`
- 入站媒体配置：`inboundMedia.enabled/dir/maxBytes/keepDays`

---

## 相关链接

- [企业微信开发文档](https://developer.work.weixin.qq.com/document/)
- [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
- [OpenClaw 文档](https://github.com/OpenClawAI/OpenClaw)
