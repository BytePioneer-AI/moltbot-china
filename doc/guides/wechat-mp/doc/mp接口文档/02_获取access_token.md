# 获取 access_token

access_token是公众号的全局唯一接口调用凭据，公众号调用各接口时都需使用access_token。开发者需要进行妥善保存。access_token的存储至少要保留512个字符空间。access_token的有效期目前为2个小时，需定时刷新，重复获取将导致上次获取的access_token失效。

## 使用说明

公众平台的API调用所需的access_token的使用及生成方式说明：

1. 建议公众号开发者使用中控服务器统一获取和刷新access_token，其他业务逻辑服务器所使用的access_token均来自于该中控服务器，不应该各自去刷新，否则容易造成冲突，导致access_token覆盖而影响业务；

2. 目前access_token的有效期通过返回的expires_in来传达，目前是7200秒之内的值。中控服务器需要根据这个有效时间提前去刷新新access_token。在刷新过程中，中控服务器可对外继续输出的老access_token，此时公众平台后台会保证在5分钟内，新老access_token都可用，这保证了第三方业务的平滑过渡；

3. access_token的有效时间可能会在未来有调整，所以中控服务器不仅需要内部定时主动刷新，还需要提供被动刷新access_token的接口，这样便于业务服务器在API调用获知access_token已超时的情况下，可以触发access_token的刷新流程。

4. 对于可能存在风险的调用，在开发者进行获取 access_token调用时进入风险调用确认流程，需要用户管理员确认后才可以成功获取。具体流程为：

开发者通过某IP发起调用->平台返回错误码[89503]并同时下发模板消息给公众号管理员->公众号管理员确认该IP可以调用->开发者使用该IP再次发起调用->调用成功。

如公众号管理员第一次拒绝该IP调用，用户在1个小时内将无法使用该IP再次发起调用，如公众号管理员多次拒绝该IP调用，该IP将可能长期无法发起调用。平台建议开发者在发起调用前主动与管理员沟通确认调用需求，或请求管理员开启IP白名单功能并将该IP加入IP白名单列表。

## 前提条件

公众号和小程序均可以使用AppID和AppSecret调用本接口来获取access_token。AppID和AppSecret可在"微信公众平台-设置与开发--基本配置"页中获得（需要已经成为开发者，且账号没有异常状态）。**调用接口时，请登录"微信公众平台-开发-基本配置"提前将服务器IP地址添加到IP白名单中，否则将无法调用成功。**小程序无需配置IP白名单。

如长期无AppSecret的使用需求，开发者可以使用管理员账号登录公众平台，在"设置与开发-基本配置"中对AppSeceret进行冻结，提高账号的安全性。AppSecret冻结后，开发者无法使用AppSecret获取Access token（接口返回错误码40243），不影响账号基本功能的正常使用，不影响通过第三方授权调用后台接口，不影响云开发调用后台接口。开发者可以随时使用管理员账号登录公众平台，在"设置与开发-基本配置"中对AppSecret进行解冻。

## 接口调用请求说明

**https请求方式**: GET

```
https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=APPID&secret=APPSECRET
```

## 参数说明

| 参数 | 是否必须 | 说明 |
| --- | --- | --- |
| grant_type | 是 | 获取access_token填写client_credential |
| appid | 是 | 第三方用户唯一凭证 |
| secret | 是 | 第三方用户唯一凭证密钥，即appsecret |

## 返回说明

### 正常返回

```json
{
  "access_token": "ACCESS_TOKEN",
  "expires_in": 7200
}
```

| 参数 | 说明 |
| --- | --- |
| access_token | 获取到的凭证 |
| expires_in | 凭证有效时间，单位：秒 |

### 错误返回

```json
{
  "errcode": 40001,
  "errmsg": "invalid appid"
}
```

## 返回码说明

| 返回码 | 说明 |
| --- | --- |
| -1 | 系统繁忙，此时请开发者稍候再试 |
| 0 | 请求成功 |
| 40001 | AppSecret错误或者AppSecret不属于这个公众号，请开发者确认AppSecret的正确性 |
| 40002 | 请确保grant_type字段值为client_credential |
| 40164 | 调用接口的IP地址不在白名单中，请在接口IP白名单中进行设置。 |
| 40243 | AppSecret已被冻结，请登录MP解冻后再次调用。 |
| 89503 | 此IP调用需要管理员确认,请联系管理员 |
| 89501 | 此IP正在等待管理员确认,请联系管理员 |
| 89506 | 24小时内该IP被管理员拒绝调用两次，24小时内不可再使用该IP调用 |
| 89507 | 1小时内该IP被管理员拒绝调用一次，1小时内不可再使用该IP调用 |
