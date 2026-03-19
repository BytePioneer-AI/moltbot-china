# 微信公众号接口文档索引

本目录包含微信公众号（订阅号）开发的核心接口文档，用于快速查阅和参考。

## 文档来源

官方文档地址：https://developers.weixin.qq.com/doc/offiaccount/

## 文档列表

| 序号 | 文档名称 | 说明 | 关键接口 |
| --- | --- | --- | --- |
| 01 | [开发概述](./01_开发概述.md) | 微信公众平台开发基础介绍 | - |
| 02 | [获取access_token](./02_获取access_token.md) | 全局唯一接口调用凭据 | `/cgi-bin/token` |
| 03 | [接收普通消息](./03_接收普通消息.md) | 接收用户发送的各类消息 | POST到开发者URL |
| 04 | [网页授权](./04_网页授权.md) | OAuth2.0网页授权获取用户信息 | `/connect/oauth2/authorize`, `/sns/oauth2/access_token` |
| 05 | [用户管理](./05_用户管理.md) | 用户标签、黑名单、用户信息管理 | `/cgi-bin/user/*`, `/cgi-bin/tags/*` |
| 06 | [素材管理-临时素材](./06_素材管理-临时素材.md) | 上传下载临时多媒体素材 | `/cgi-bin/media/upload`, `/cgi-bin/media/get` |
| 07 | [自定义菜单](./07_自定义菜单.md) | 创建、查询、删除自定义菜单 | `/cgi-bin/menu/create`, `/cgi-bin/menu/get`, `/cgi-bin/menu/delete` |
| 08 | [模板消息](./08_模板消息.md) | 发送服务通知模板消息 | `/cgi-bin/message/template/send` |
| 09 | [带参数二维码](./09_带参数二维码.md) | 生成临时/永久带参数二维码 | `/cgi-bin/qrcode/create`, `/cgi-bin/showqrcode` |
| 10 | [JS-SDK](./10_JS-SDK.md) | 微信网页开发工具包 | `wx.config`, `wx.ready`, 各类JS接口 |

## 核心概念

### OpenID vs UnionID

- **OpenID**：用户对单个公众号的唯一标识，不同公众号的OpenID不同
- **UnionID**：用户对同一开放平台下所有应用的唯一标识，用于多应用统一用户身份

### access_token vs 网页授权access_token

- **普通access_token**：调用大部分API的全局凭据，有效期2小时
- **网页授权access_token**：OAuth2.0授权获取的凭据，用于获取用户信息

### 消息类型

- **被动回复消息**：5秒内响应用户消息
- **客服消息**：用户交互后48小时内可发送
- **模板消息**：服务通知，需用户关注
- **群发消息**：订阅号每天1次，服务号每月4次

## API基础URL

```
# 普通API
https://api.weixin.qq.com/cgi-bin/

# 网页授权
https://open.weixin.qq.com/connect/

# 素材下载
https://mp.weixin.qq.com/cgi-bin/
```

## 开发流程建议

1. **准备阶段**
   - 注册公众号/申请测试号
   - 配置服务器URL和Token
   - 配置JS接口安全域名

2. **基础开发**
   - 实现access_token中控服务器
   - 实现消息接收和被动回复
   - 实现JS-SDK签名服务

3. **业务开发**
   - 根据需求选择相应接口
   - 注意接口权限和调用频次限制
   - 做好错误处理和日志记录

## 常见问题

### 签名错误
1. 检查jsapi_ticket是否正确获取和缓存
2. 确认签名URL与当前页面URL完全一致（不含#hash）
3. 使用官方签名校验工具验证

### 授权失败
1. 检查网页授权域名配置
2. 确认scope参数正确
3. 检查redirect_uri是否urlEncode

### 消息接收失败
1. 确认服务器URL可访问
2. 检查消息体签名验证
3. 确认5秒内响应

## 参考链接

- [微信公众平台](https://mp.weixin.qq.com/)
- [微信开放平台](https://open.weixin.qq.com/)
- [接口调试工具](https://mp.weixin.qq.com/debug/)
- [签名校验工具](https://mp.weixin.qq.com/debug/cgi-bin/sandbox?t=jsapisign)
