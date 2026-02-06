# 钉钉渠道配置指南

<div align="center">

  <p>
    <strong>⭐ 如果这个项目对你有帮助，请给我们一个Star！⭐</strong><br>
    <em>您的支持是我们持续改进的动力</em>
  </p>

</div>

## 一、获取钉钉凭证

### 1. 创建企业

不需要任何材料，手机、电脑端操作类似：

1. 钉钉右上角点击「创建或加入企业」

   <img src="../../images/dingtalk_create_enterprise_button.png" alt="Create Enterprise Button" style="zoom:50%;" />

2. 选择「企业」

3. 选择「创建企业/团队」

4. 填写企业信息

   <img src="../../images/dingtalk_enterprise_info_form.png" alt="Enterprise Info Form" style="zoom:50%;" />

### 2. 登录开发者平台

访问 [钉钉开放平台](https://open-dev.dingtalk.com/)，点击右上角头像切换到刚创建的企业。

<img src="../../images/dingtalk_switch_enterprise.png" alt="Switch Enterprise" style="zoom:50%;" />

### 3. 创建应用

点击主页的「创建应用」：

![Create App Button](../../images/dingtalk_create_app_button.png)

![App Type Selection](../../images/dingtalk_app_type_selection.png)

![App Creation Form](../../images/dingtalk_app_creation_form.png)

填写应用信息后点击发布：

![App Publish](../../images/dingtalk_app_publish.png)

### 4. 获取 clientId / clientSecret

在应用详情页获取凭证：

![Credentials](../../images/dingtalk_credentials.png)

### 5. 发布版本

> 只有发布版本后，才能在钉钉中搜索到机器人。

![Version Create](../../images/dingtalk_version_create.png)

![Version Info](../../images/dingtalk_version_info.png)

![Version Publish](../../images/dingtalk_version_publish.png)

### 6. 启用 AI Card 流式输出（可选）

如需使用 AI Card 流式输出，需要在钉钉应用权限中开通：
- `Card.Instance.Write`
- `Card.Streaming.Write`

![Permission Search](../../images/dingtalk_permission_search.png)

![Permission Apply](../../images/dingtalk_permission_apply.png)

> 如果未开启权限或不启用 AI Card，也不影响正常对话；系统会回退到普通消息，并在日志中给出权限申请指引链接。

---

## 二、安装 OpenClaw

### 1. 安装 OpenClaw

```bash
npm install -g openclaw@latest
```

### 2. 安装钉钉插件

```bash
openclaw plugins install @openclaw-china/channels
```

---

## 三、配置与启动

### 1. 配置钉钉渠道

```bash
openclaw config set channels.dingtalk '{
  "enabled": true,
  "clientId": "dingxxxxxx",
  "clientSecret": "your-app-secret",
  "enableAICard": true,
  "maxFileSizeMB": 100,
  "inboundMedia": {
    "dir": "~/.openclaw/media/dingtalk/inbound",
    "keepDays": 7
  }
}' --json
```

配置项说明：
| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| enabled | boolean | true | 是否启用钉钉渠道 |
| clientId | string | - | 钉钉应用 AppKey |
| clientSecret | string | - | 钉钉应用 AppSecret |
| dmPolicy | string | "open" | 单聊策略: open/pairing/allowlist |
| groupPolicy | string | "open" | 群聊策略: open/allowlist/disabled |
| requireMention | boolean | true | 群聊是否需要 @机器人 |
| enableAICard | boolean | true | 是否启用 AI Card 流式响应 |
| maxFileSizeMB | number | 100 | 媒体文件大小限制 (MB) |
| inboundMedia.dir | string | `~/.openclaw/media/dingtalk/inbound` | 入站媒体归档根目录 |
| inboundMedia.keepDays | number | 7 | 入站媒体保留天数（按过期清理） |

入站媒体保留策略（dingtalk）：
- 先下载到临时目录，再归档到 `inboundMedia.dir/YYYY-MM-DD/`
- 每次消息处理结束后，按 `keepDays` 清理过期文件（不递归删子目录，不强删目录）

### 2. OpenClaw初始化
```
openclaw onboard --install-daemon
```
如果已经执行了3.1，那么可以在channel时选忽略。

### 3. 启动服务

**调试模式**（推荐先用这个，方便查看日志）：

```bash
openclaw gateway --port 18789 --verbose
```

**后台运行**（调试成功后）：

```bash
openclaw daemon start
```

