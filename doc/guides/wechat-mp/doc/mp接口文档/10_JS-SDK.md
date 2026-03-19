# 微信 JS-SDK

## 概述

微信JS-SDK是微信公众平台面向网页开发者提供的基于微信内的网页开发工具包。

通过使用微信JS-SDK，网页开发者可借助微信高效地使用拍照、选图、语音、位置等手机系统的能力，同时可以直接使用微信分享、扫一扫、卡券、支付等微信特有的能力，为微信用户提供更优质的网页体验。

## JSSDK使用步骤

### 步骤一：绑定域名

- 可登录微信公众平台进入"公众号设置"的"功能设置"里填写"JS接口安全域名"。
- 或者前往微信开发者平台 - 公众号或服务号 - 基本信息 - 开发信息 进行修改

> 备注：登录后可在"开发者中心"查看对应的接口权限。

### 步骤二：引入JS文件

在需要调用JS接口的页面引入如下JS文件，（支持https）：

```html
<script src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js"></script>
```

如需进一步提升服务稳定性，当上述资源不可访问时，可改访问：

```html
<script src="https://res2.wx.qq.com/open/js/jweixin-1.6.0.js"></script>
```

> 备注：支持使用 AMD/CMD 标准模块加载方法加载

### 步骤三：通过config接口注入权限验证配置

所有需要使用JS-SDK的页面必须先注入配置信息，否则将无法调用（同一个url仅需调用一次，对于变化url的SPA的web app可在每次url变化时进行调用,目前Android微信客户端不支持pushState的H5新特性，所以使用pushState来实现web app的页面会导致签名失败，此问题会在Android6.2中修复）。

```javascript
wx.config({
  debug: true, // 开启调试模式,调用的所有api的返回值会在客户端alert出来，若要查看传入的参数，可以在pc端打开，参数信息会通过log打出，仅在pc端时才会打印。
  appId: '', // 必填，公众号的唯一标识
  timestamp: '', // 必填，生成签名的时间戳
  nonceStr: '', // 必填，生成签名的随机串
  signature: '',// 必填，签名
  jsApiList: [] // 必填，需要使用的JS接口列表
});
```

签名算法见文末的附录1，所有JS接口列表见文末的附录2

**注意**：如果使用的是小程序云开发静态网站托管的域名的网页，可以免鉴权直接跳任意合法合规小程序，调用 wx.config 时 appId 需填入非个人主体的已认证小程序，不需计算签名，timestamp、nonceStr、signature 填入非空任意值即可。

### 步骤四：通过ready接口处理成功验证

```javascript
wx.ready(function(){
  // config信息验证后会执行ready方法，所有接口调用都必须在config接口获得结果之后，config是一个客户端的异步操作，所以如果需要在页面加载时就调用相关接口，则须把相关接口放在ready函数中调用来确保正确执行。对于用户触发时才调用的接口，则可以直接调用，不需要放在ready函数中。
});
```

### 步骤五：通过error接口处理失败验证

```javascript
wx.error(function(res){
  // config信息验证失败会执行error函数，如签名过期导致验证失败，具体错误信息可以打开config的debug模式查看，也可以在返回的res参数中查看，对于SPA可以在这里更新签名。
});
```

## 接口调用说明

所有接口通过wx对象(也可使用jWeixin对象)来调用，参数是一个对象，除了每个接口本身需要传的参数之外，还有以下通用参数：

1. **success**：接口调用成功时执行的回调函数。
2. **fail**：接口调用失败时执行的回调函数。
3. **complete**：接口调用完成时执行的回调函数，无论成功或失败都会执行。
4. **cancel**：用户点击取消时的回调函数，仅部分有用户取消操作的api才会用到。
5. **trigger**: 监听Menu中的按钮点击时触发的方法，该方法仅支持Menu中的相关接口。

> 备注：不要尝试在trigger中使用ajax异步请求修改本次分享的内容，因为客户端分享操作是一个同步操作，这时候使用ajax的回包会还没有返回。

以上几个函数都带有一个参数，类型为对象，其中除了每个接口本身返回的数据之外，还有一个通用属性errMsg，其值格式如下：

- 调用成功时："xxx:ok" ，其中xxx为调用的接口名
- 用户取消时："xxx:cancel"，其中xxx为调用的接口名
- 调用失败时：其值为具体错误信息

## 基础接口

### 判断当前客户端版本是否支持指定JS接口

```javascript
wx.checkJsApi({
  jsApiList: ['chooseImage'], // 需要检测的JS接口列表，所有JS接口列表见附录2,
  success: function(res) {
    // 以键值对的形式返回，可用的api值true，不可用为false
    // 如：{"checkResult":{"chooseImage":true},"errMsg":"checkJsApi:ok"}
  }
});
```

> 备注：checkJsApi接口是客户端6.0.2新引入的一个预留接口，第一期开放的接口均可不使用checkJsApi来检测。

## 分享接口

请注意，不要有诱导分享等违规行为，对于诱导分享行为将永久回收公众号接口权限，详细规则请查看：朋友圈管理常见问题

请注意，原有的 `wx.onMenuShareTimeline`、`wx.onMenuShareAppMessage`、`wx.onMenuShareQQ`、`wx.onMenuShareQZone` 接口，即将废弃。请尽快迁移使用客户端6.7.2及JSSDK 1.4.0以上版本支持的 `wx.updateAppMessageShareData`、`wx.updateTimelineShareData`接口。

### 自定义"分享给朋友"及"分享到QQ"按钮的分享内容（1.4.0）

```javascript
wx.updateAppMessageShareData({
  title: '', // 分享标题
  desc: '', // 分享描述
  link: '', // 分享链接，该链接域名或路径必须与当前页面对应的公众号JS安全域名一致
  imgUrl: '', // 分享图标
  success: function () {
    // 设置成功
  }
});
```

### 自定义"分享到朋友圈"及"分享到QQ空间"按钮的分享内容（1.4.0）

```javascript
wx.updateTimelineShareData({
  title: '', // 分享标题
  link: '', // 分享链接，该链接域名或路径必须与当前页面对应的公众号JS安全域名一致
  imgUrl: '', // 分享图标
  success: function () {
    // 设置成功
  }
});
```

## 图像接口

### 拍照或从手机相册中选图接口

```javascript
wx.chooseImage({
  count: 1, // 默认9
  sizeType: ['original', 'compressed'], // 可以指定是原图还是压缩图，默认二者都有
  sourceType: ['album', 'camera'], // 可以指定来源是相册还是相机，默认二者都有
  success: function (res) {
    var localIds = res.localIds; // 返回选定照片的本地ID列表，localId可以作为img标签的src属性显示图片
  }
});
```

### 预览图片接口

```javascript
wx.previewImage({
  current: '', // 当前显示图片的http链接
  urls: [] // 需要预览的图片http链接列表
});
```

### 上传图片接口

```javascript
wx.uploadImage({
  localId: '', // 需要上传的图片的本地ID，由chooseImage接口获得
  isShowProgressTips: 1, // 默认为1，显示进度提示
  success: function (res) {
    var serverId = res.serverId; // 返回图片的服务器端ID，即mediaId
  }
});
```

> 备注：上传图片有效期3天，可用微信多媒体接口下载图片到自己的服务器，此处获得的 serverId 即 media_id。

### 下载图片接口

```javascript
wx.downloadImage({
  serverId: '', // 需要下载的图片的服务器端ID，由uploadImage接口获得
  isShowProgressTips: 1, // 默认为1，显示进度提示
  success: function (res) {
    var localId = res.localId; // 返回图片下载后的本地ID
  }
});
```

## 音频接口

### 开始录音接口

```javascript
wx.startRecord();
```

### 停止录音接口

```javascript
wx.stopRecord({
  success: function (res) {
    var localId = res.localId;
  }
});
```

### 监听录音自动停止接口

```javascript
wx.onVoiceRecordEnd({
  // 录音时间超过一分钟没有停止的时候会执行 complete 回调
  complete: function (res) {
    var localId = res.localId;
  }
});
```

### 播放语音接口

```javascript
wx.playVoice({
  localId: '' // 需要播放的音频的本地ID，由stopRecord接口获得
});
```

### 暂停播放接口

```javascript
wx.pauseVoice({
  localId: '' // 需要暂停的音频的本地ID，由stopRecord接口获得
});
```

### 停止播放接口

```javascript
wx.stopVoice({
  localId: '' // 需要停止的音频的本地ID，由stopRecord接口获得
});
```

### 监听语音播放完毕接口

```javascript
wx.onVoicePlayEnd({
  success: function (res) {
    var localId = res.localId; // 返回音频的本地ID
  }
});
```

### 上传语音接口

```javascript
wx.uploadVoice({
  localId: '', // 需要上传的音频的本地ID，由stopRecord接口获得
  isShowProgressTips: 1, // 默认为1，显示进度提示
  success: function (res) {
    var serverId = res.serverId; // 返回音频的服务器端ID
  }
});
```

> 备注：上传语音有效期3天，可用微信多媒体接口下载语音到自己的服务器

### 下载语音接口

```javascript
wx.downloadVoice({
  serverId: '', // 需要下载的音频的服务器端ID，由uploadVoice接口获得
  isShowProgressTips: 1, // 默认为1，显示进度提示
  success: function (res) {
    var localId = res.localId; // 返回音频的本地ID
  }
});
```

## 设备信息

### 获取网络状态接口

```javascript
wx.getNetworkType({
  success: function (res) {
    var networkType = res.networkType; // 返回网络类型2g，3g，4g，wifi
  }
});
```

## 地理位置

### 使用微信内置地图查看位置接口

```javascript
wx.openLocation({
  latitude: 0, // 纬度，浮点数，范围为90 ~ -90
  longitude: 0, // 经度，浮点数，范围为180 ~ -180。
  name: '', // 位置名
  address: '', // 地址详情说明
  scale: 1, // 地图缩放级别,整型值,范围从1~28。默认为最大
  infoUrl: '' // 在查看位置界面底部显示的超链接,可点击跳转
});
```

### 获取地理位置接口

```javascript
wx.getLocation({
  type: 'wgs84', // 默认为wgs84的gps坐标，如果要返回直接给openLocation用的火星坐标，可传入'gcj02'
  success: function (res) {
    var latitude = res.latitude; // 纬度，浮点数，范围为90 ~ -90
    var longitude = res.longitude; // 经度，浮点数，范围为180 ~ -180。
    var speed = res.speed; // 速度，以米/每秒计
    var accuracy = res.accuracy; // 位置精度
  }
});
```

## 界面操作

### 关闭当前网页窗口接口

```javascript
wx.closeWindow();
```

### 批量隐藏功能按钮接口

```javascript
wx.hideMenuItems({
  menuList: [] // 要隐藏的菜单项，只能隐藏"传播类"和"保护类"按钮，所有menu项见附录3
});
```

### 批量显示功能按钮接口

```javascript
wx.showMenuItems({
  menuList: [] // 要显示的菜单项，所有menu项见附录3
});
```

### 隐藏所有非基础按钮接口

```javascript
wx.hideAllNonBaseMenuItem();
```

### 显示所有功能按钮接口

```javascript
wx.showAllNonBaseMenuItem();
```

## 微信扫一扫

### 调起微信扫一扫接口

```javascript
wx.scanQRCode({
  needResult: 0, // 默认为0，扫描结果由微信处理，1则直接返回扫描结果，
  scanType: ["qrCode","barCode"], // 可以指定扫二维码还是一维码，默认二者都有
  success: function (res) {
    var result = res.resultStr; // 当needResult 为 1 时，扫码返回的结果
  }
});
```

## 微信支付

### 发起一个微信支付请求

请参考微信支付文档，JSAPI调起支付API：https://pay.weixin.qq.com/doc/v3/merchant/4012791857

## 附录1-JS-SDK使用权限签名算法

### jsapi_ticket

生成签名之前必须先了解一下jsapi_ticket，jsapi_ticket是公众号用于调用微信JS接口的临时票据。正常情况下，jsapi_ticket的有效期为7200秒，通过access_token来获取。由于获取jsapi_ticket的api调用次数非常有限，频繁刷新jsapi_ticket会导致api调用受限，影响自身业务，开发者必须在自己的服务全局缓存jsapi_ticket。

1. 参考以下文档获取access_token（有效期7200秒，开发者必须在自己的服务全局缓存access_token）
2. 用第一步拿到的access_token 采用http GET方式请求获得jsapi_ticket（有效期7200秒，开发者必须在自己的服务全局缓存jsapi_ticket）：

```
https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=ACCESS_TOKEN&type=jsapi
```

成功返回如下JSON：

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "ticket": "bxLdikRXVbTPdHSM05e5u5sUoXNKd8-41ZO3eHx2wOeKBgGCr1Lj4M1J8nGJ",
  "expires_in": 7200
}
```

### 签名算法

签名生成规则如下：参与签名的字段包括noncestr（随机字符串）, 有效的jsapi_ticket, timestamp（时间戳）, url（当前网页的URL，不包含#及其后面部分）。对所有待签名参数按照字段名的ASCII码从小到大排序（字典序）后，使用URL键值对的格式（即key1=value1&key2=value2…）拼接成字符串string1。这里需要注意的是所有参数名均为小写字符。对string1作sha1加密，字段名和字段值都采用原始值，不进行URL转义。

即signature=sha1(string1)。 示例：

步骤1. 对所有待签名参数按照字段名的ASCII码从小到大排序（字典序）后，使用URL键值对的格式（即key1=value1&key2=value2…）拼接成字符串string1：

```
jsapi_ticket=sM4AOVdWfPE4DxkXGEs8VMCPGGVi4C3MmU7A&noncestr=Wm3WZYTPz0wzccnW&timestamp=1414587457&url=http://mp.weixin.qq.com?params=value
```

步骤2. 对string1进行sha1签名，得到signature：

```
0f9de62fce790f9a083d5c99e95740ceb90c27ed
```

### 注意事项

1. 签名用的noncestr和timestamp必须与wx.config中的nonceStr和timestamp相同。
2. 签名用的url必须是调用JS接口页面的完整URL。
3. 出于安全考虑，开发者必须在服务器端实现签名的逻辑。

## 附录2-所有JS接口列表

### 版本 1.6.0 接口

| 接口名 | 说明 |
| --- | --- |
| updateAppMessageShareData | 自定义"分享给朋友"及"分享到QQ"按钮的分享内容 |
| updateTimelineShareData | 自定义"分享到朋友圈"及"分享到QQ空间"按钮的分享内容 |
| onMenuShareTimeline | 获取"分享到朋友圈"按钮点击状态（即将废弃） |
| onMenuShareAppMessage | 获取"分享给朋友"按钮点击状态（即将废弃） |
| onMenuShareQQ | 获取"分享到QQ"按钮点击状态（即将废弃） |
| onMenuShareWeibo | 获取"分享到腾讯微博"按钮点击状态 |
| onMenuShareQZone | 获取"分享到QQ空间"按钮点击状态（即将废弃） |
| startRecord | 开始录音 |
| stopRecord | 停止录音 |
| onVoiceRecordEnd | 监听录音自动停止 |
| playVoice | 播放语音 |
| pauseVoice | 暂停播放 |
| stopVoice | 停止播放 |
| onVoicePlayEnd | 监听语音播放完毕 |
| uploadVoice | 上传语音 |
| downloadVoice | 下载语音 |
| chooseImage | 拍照或从手机相册中选图 |
| previewImage | 预览图片 |
| uploadImage | 上传图片 |
| downloadImage | 下载图片 |
| translateVoice | 识别音频并返回识别结果 |
| getNetworkType | 获取网络状态 |
| openLocation | 使用微信内置地图查看位置 |
| getLocation | 获取地理位置 |
| hideOptionMenu | 隐藏右上角菜单 |
| showOptionMenu | 显示右上角菜单 |
| hideMenuItems | 批量隐藏功能按钮 |
| showMenuItems | 批量显示功能按钮 |
| hideAllNonBaseMenuItem | 隐藏所有非基础按钮 |
| showAllNonBaseMenuItem | 显示所有功能按钮 |
| closeWindow | 关闭当前网页窗口 |
| scanQRCode | 调起微信扫一扫 |
| openProductSpecificView | 跳转微信商品页 |
| addCard | 批量添加卡券 |
| chooseCard | 拉取适用卡券列表 |
| openCard | 查看微信卡包中的卡券 |

## 附录3-所有菜单项列表

### 基本类

- 举报: "menuItem:exposeArticle"
- 调整字体: "menuItem:setFont"
- 日间模式: "menuItem:dayMode"
- 夜间模式: "menuItem:nightMode"
- 刷新: "menuItem:refresh"
- 查看公众号（已添加）: "menuItem:profile"
- 查看公众号（未添加）: "menuItem:addContact"

### 传播类

- 发送给朋友: "menuItem:share:appMessage"
- 分享到朋友圈: "menuItem:share:timeline"
- 分享到QQ: "menuItem:share:qq"
- 分享到Weibo: "menuItem:share:weiboApp"
- 收藏: "menuItem:favorite"
- 分享到FB: "menuItem:share:facebook"
- 分享到 QQ 空间: "menuItem:share:QZone"

### 保护类

- 编辑标签: "menuItem:editTag"
- 删除: "menuItem:delete"
- 复制链接: "menuItem:copyUrl"
- 原网页: "menuItem:originPage"
- 阅读模式: "menuItem:readMode"
- 在QQ浏览器中打开: "menuItem:openWithQQBrowser"
- 在Safari中打开: "menuItem:openWithSafari"
- 邮件: "menuItem:share:email"
- 一些特殊公众号: "menuItem:share:brand"

## 附录5-常见错误及解决方法

调用config接口的时候传入参数 debug: true 可以开启debug模式，页面会alert出错误信息。以下为常见错误及解决方法：

1. **invalid url domain**：当前页面所在域名与使用的appid没有绑定，请确认正确填写绑定的域名，仅支持80（http）和443（https）两个端口

2. **invalid signature**：签名错误。建议按如下顺序检查：
   - 确认签名算法正确，可用 http://mp.weixin.qq.com/debug/cgi-bin/sandbox?t=jsapisign 页面工具进行校验
   - 确认config中nonceStr, timestamp与用以签名中的对应noncestr, timestamp一致
   - 确认url是页面完整的url
   - 确认 config 中的 appid 与用来获取 jsapi_ticket 的 appid 一致
   - 确保一定缓存access_token和jsapi_ticket

3. **the permission value is offline verifying**：这个错误是因为config没有正确执行，或者是调用的JSAPI没有传入config的jsApiList参数中

4. **permission denied**：该公众号没有权限使用这个JSAPI，或者是调用的JSAPI没有传入config的jsApiList参数中（部分接口需要认证之后才能使用）

5. **function not exist**：当前客户端版本不支持该接口，请升级到新版体验
