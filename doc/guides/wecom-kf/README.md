# 企业微信「微信客服」插件开发文档清单

本文档汇总实现 OpenClaw China 企业微信微信客服渠道插件时，建议优先阅读的企业微信官方文档。

目标是先打通最小闭环：

1. 获取 `access_token`
2. 搭建回调 URL，完成签名校验与解密
3. 接收微信客服消息和事件
4. 给外部微信用户发送消息
5. 逐步补充客服账号管理、接待人员管理、会话分配和媒体能力

以下官方链接已于 `2026-03-09` 校验，来源均为企业微信开发者中心。

## 1. 微信客服的定位

微信客服和现有的企业微信自建应用、企业微信智能机器人不是一套能力。

| 能力 | 微信客服 | 自建应用 | 智能机器人 |
| --- | --- | --- | --- |
| 主要面向对象 | 外部微信用户 | 企业内部成员 | 企业微信会话中的用户和群 |
| 主要场景 | 售前、售后、在线客服 | OA、审批、通知、业务系统接入 | AI 助手、问答助手、群机器人 |
| 核心对象模型 | `open_kfid`、接待人员、客服会话 | `agentid`、成员、部门、标签 | `BotID`、回调 URL / WebSocket |
| 是否可直接服务外部微信用户 | 是 | 否 | 否 |

如果要做的是“企业对外客服”插件，应优先看微信客服接口，而不是复用 `wecom` 或 `wecom-app` 的接口模型。

## 2. 最小必读文档（P0）

下面这些文档构成插件 MVP 的最小必读集合。

| 文档 | 链接 | 插件里解决的问题 |
| --- | --- | --- |
| 获取 `access_token` | <https://developer.work.weixin.qq.com/document/path/91039> | 用自建应用 `corpsecret` 获取接口调用凭证，后续所有 `cgi-bin/kf/*` 请求都依赖它 |
| 回调配置 | <https://developer.work.weixin.qq.com/document/path/90930> | 实现回调 URL 校验、签名校验、AES 解密、POST 回调接收 |
| 微信客服概述 | <https://developer.work.weixin.qq.com/document/path/94638> | 理解微信客服对象模型、后台开通方式、API 接管方式、接入场景 |
| 接收消息和事件 | <https://developer.work.weixin.qq.com/document/path/94670> | 处理外部微信用户消息、系统事件、客服会话回调 |
| 发送消息 | <https://developer.work.weixin.qq.com/document/path/94677> | 给外部微信用户发送文本、图片、语音、视频、文件、图文、小程序、菜单等消息 |
| 发送欢迎语等事件响应消息 | <https://developer.work.weixin.qq.com/document/path/95122> | 在欢迎语、进入接待、事件型回调中返回响应消息 |

推荐阅读顺序：

1. `91039`
2. `90930`
3. `94638`
4. `94670`
5. `94677`
6. `95122`

## 3. 常用补充文档（P1）

这些文档通常会在插件第二阶段用到。

| 文档 | 链接 | 适用场景 |
| --- | --- | --- |
| 获取客服账号列表 | <https://developer.work.weixin.qq.com/document/path/94661> | 启动时同步可管理的客服账号，或做配置校验 |
| 获取客服账号链接 | <https://developer.work.weixin.qq.com/document/path/94665> | 需要把客服入口挂到网页、App、公众号、小程序等场景时使用 |
| 回调通知 | <https://developer.work.weixin.qq.com/document/path/97712> | 处理客服账号授权变化等平台级事件 |
| 获取客户基础信息 | <https://developer.work.weixin.qq.com/document/path/95159> | 补充外部用户资料、构建用户画像或会话元数据 |
| 上传临时素材 | <https://developer.work.weixin.qq.com/document/path/90253> | 发送图片、语音、视频、文件前，先上传素材获取 `media_id` |

## 4. 完整管理能力文档（P2）

如果插件后续要覆盖完整客服管理能力，还需要这些文档：

| 文档 | 链接 | 作用 |
| --- | --- | --- |
| 添加客服账号 | <https://developer.work.weixin.qq.com/document/path/94662> | 创建客服账号 |
| 删除客服账号 | <https://developer.work.weixin.qq.com/document/path/94663> | 删除客服账号 |
| 修改客服账号 | <https://developer.work.weixin.qq.com/document/path/94664> | 更新客服账号资料 |
| 获取接待人员列表 | <https://developer.work.weixin.qq.com/document/path/94645> | 查询客服账号下的接待人员 |
| 添加接待人员 | <https://developer.work.weixin.qq.com/document/path/94646> | 维护客服接待成员 |
| 删除接待人员 | <https://developer.work.weixin.qq.com/document/path/94647> | 移除接待成员 |
| 分配客服会话 | <https://developer.work.weixin.qq.com/document/path/94669> | 插件自己实现会话路由和分配策略 |

## 5. 容易漏掉的后台前置条件

这些点如果漏掉，接口通常会调不通，或者表面成功但没有实际效果。

1. 需要先在企业微信管理后台的“微信客服应用 -> API”中，把一个自建应用配置到“可调用接口的应用”。
2. 需要在“通过 API 管理微信客服账号 -> 企业内部开发”中，把具体客服账号授权给该应用，否则插件不能真正接管会话和消息。
3. 客服账号对应的接待人员必须处于该应用的可见范围内，否则部分接口会报错，官方文档中明确提到可能返回 `60030`。
4. 回调服务必须同时支持 `HTTP GET` 和 `HTTP POST`。
5. 回调参数需要使用 `Token` 做签名校验，使用 `EncodingAESKey` 做消息解密。
6. `access_token` 需要按应用维度缓存，不能频繁调用 `gettoken`。

## 6. 推荐 MVP 范围

结合本仓库“先聚焦消息收发、额外能力后置”的约定，微信客服插件建议先做下面这些能力：

1. 单账号配置
2. 单个 `open_kfid` 或少量手工配置的 `open_kfid`
3. 回调验签与解密
4. 文本消息接收
5. 文本消息发送
6. 欢迎语 / 事件响应消息

建议先不要在第一版就做：

- 客服账号的全量 CRUD
- 接待人员自动同步
- 自定义会话分配策略
- 统计接口
- 知识库 / 机器人管理
- 全媒体消息支持

## 7. 对应到本仓库的插件设计建议

如果后续在本仓库落地插件，建议按现有目录和配置习惯处理：

- 插件目录建议：`extensions/wecom-kf/`
- 配置入口建议：`channels.wecom-kf`
- 多账号配置建议：`channels.wecom-kf.accounts.<accountId>`

第一版配置字段建议至少包含：

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

其中：

- `corpId` / `corpSecret` 用于获取 `access_token`
- `token` / `encodingAESKey` 用于回调签名与解密
- `webhookPath` 用于接收企业微信回调
- `agentId` 即客服账号 ID（`open_kfid`），格式如 `wkAJ_XXXXX`

## 8. 建议的开发落地顺序

1. 先读完 P0 文档，把鉴权、回调、文本收发打通
2. 再补 P1 文档，把 `open_kfid` 管理和外部入口能力补齐
3. 最后再做 P2 能力，把账号、接待人员、会话分配、媒体和统计扩展完整

如果只追求“渠道先可用”，看到 P0 就可以开始写插件代码了。
