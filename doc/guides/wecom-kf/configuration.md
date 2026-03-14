# 微信客服渠道配置指南

本文档用于配置 OpenClaw China 的微信客服渠道（`wecom-kf`）。

对应的企业微信官方文档：

- 微信客服概述：<https://developer.work.weixin.qq.com/document/path/94638>
- 接收消息和事件：<https://developer.work.weixin.qq.com/document/path/94670>
- 发送消息：<https://developer.work.weixin.qq.com/document/path/94677>
- 回调配置：<https://developer.work.weixin.qq.com/document/path/90930>
- 获取 `access_token`：<https://developer.work.weixin.qq.com/document/path/91039>

## 一、前置条件

在企业微信管理后台完成下面几项，否则接口通常无法正常收发消息：

1. 在“微信客服 -> API”中，把一个自建应用配置为“可调用接口的应用”。
2. 在“通过 API 管理微信客服账号”里，把目标客服账号授权给该应用。
3. 记录以下配置项：
   - `corpId`
   - `corpSecret`
   - `agentId`
   - 回调 `Token`
   - 回调 `EncodingAESKey`

说明：

- `corpSecret` 是“可调用接口的应用”的 Secret，不是系统应用 Secret。
- `agentId` 为客服账号 ID（即 `open_kfid`），格式如 `wkAJ_XXXXX`，不是应用的 agentid。
- 回调服务需要同时支持 `GET` 和 `POST`。

## 二、安装插件

推荐安装聚合包：

```bash
openclaw plugins install @openclaw-china/channels
openclaw china setup
```

只安装微信客服渠道：

```bash
openclaw plugins install @openclaw-china/wecom-kf
openclaw china setup
```

## 三、配置

推荐直接使用交互式向导：

```bash
openclaw china setup
```

在向导里选择 `WeCom KF（企业微信-微信客服）`，按提示填写：

- `corpId`
- `corpSecret`
- `agentId`（客服账号 ID，即 `open_kfid`，格式如 `wkAJ_XXXXX`）
- `webhookPath`
- `token`
- `encodingAESKey`

### 手动配置

```bash
openclaw config set channels.wecom-kf.enabled true
openclaw config set channels.wecom-kf.webhookPath /wecom-kf
openclaw config set channels.wecom-kf.token your-token
openclaw config set channels.wecom-kf.encodingAESKey your-43-char-encoding-aes-key
openclaw config set channels.wecom-kf.corpId your-corp-id
openclaw config set channels.wecom-kf.corpSecret your-app-secret
openclaw config set channels.wecom-kf.agentId wkAJ_XXXXX
```

也可以直接编辑 `~/.openclaw/openclaw.json`：

```json
{
  "channels": {
    "wecom-kf": {
      "enabled": true,
      "webhookPath": "/wecom-kf",
      "token": "your-token",
      "encodingAESKey": "your-43-char-encoding-aes-key",
      "corpId": "your-corp-id",
      "corpSecret": "your-app-secret",
      "agentId": "wkAJ_XXXXX"
    }
  }
}
```

## 四、启动与验证

```bash
openclaw gateway --port 18789 --verbose
```

验证顺序：

1. 在企业微信后台完成回调 URL 校验。
2. 用微信侧客户给客服账号发一条消息。
3. 观察网关日志，确认回调到达并成功拉取 `sync_msg`。
4. 让 Agent 回复，确认消息能回发到客户侧。

## 五、当前实现范围

`wecom-kf` 当前优先覆盖最小闭环：

- 回调验签与解密
- `sync_msg` 拉取消息
- 文本消息接收
- 文本 / 图片 / 文件消息发送
- `enter_session` 事件欢迎语
- `openclaw china setup` 交互式配置

注意事项：

- 根据官方 `send_msg` 文档，用户主动发消息后的 48 小时内，最多可下发 5 条消息。
- `send_msg` 接口返回成功，不代表最终送达成功；仍需关注失败事件回调。
- 默认回调路径是 `/wecom-kf`。
