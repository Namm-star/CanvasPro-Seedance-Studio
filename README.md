# CanvasPro 视频工作室

Windows 10/11 x64 便携客户端，使用 **CanvasPro API 站点自己的 New API Key** 调用算力 AI Seedance 模型。无需另装 Node.js 或 Python，不需要上游密钥。

## 下载与更新

[下载最新便携版](https://github.com/Namm-star/CanvasPro-Seedance-Studio/releases/latest)

打开 Releases 页，在 Assets 中下载 `CanvasPro-Seedance-Studio-版本号-windows-x64.zip`。不要下载 GitHub 自动生成的 `Source code` 作为可执行客户端。最新版 0.1.3 内置 114 款已售型号；登录后按 Key 权限同步实际可用型号。

1. 旧版用户先在客户端右上角点击「退出」；仅关浏览器不等于退出。
2. 将整个 ZIP 解压到新的文件夹，不覆盖正在运行的旧版。
3. 双击「CanvasPro 视频工作室.exe」，窗口版本应为 0.1.3。
4. 填本站 Key，点击「连接并同步模型」，然后选择型号、参数与素材。

旧版目录可以保留以供回退。任务历史位置和格式不变：`%LOCALAPPDATA%\CanvasProSeedanceStudio\history.json`；使用原 Key 继续查询，不需要重新生成。

模型目录会在连接、刷新和提交前检查；客户端程序不会自动安装更新，新的功能或协议适配请到上述固定下载页获取。目录不兼容或价格不匹配时停止新提交，不猜参数。

## 安全与费用

- 发布页提供 ZIP 的 SHA256 和 `SHA256SUMS.txt`。PowerShell 校验：`Get-FileHash -Algorithm SHA256 -LiteralPath '下载的 ZIP 路径'`。
- Key 仅存在本地运行内存，不写入任务历史；退出后重新连接。不要向他人提供 Key。
- 仅监听本机，固定连接 `https://api.canvasproai.com`，不向其他站点转发 Key。
- 仅显示各型号的实际开放参数、媒体组合和数量限制；部分型号音频只接受随图的本地 MP3。本地文件合计最多 12 MiB，大素材可用该型号允许的公网链接。
- 提交确认会创建付费任务。报价为标准组预计积分，最终以本站有效分组和账务记录为准。结果未知时不自动重发或退款；先查原任务号。
- 当前启动器未商业签名。请核对发布来源和 SHA256，不要关闭系统防护。无费合同测试不等于每款型号都做过付费出片验收。

[完整使用说明](clients/seedance-studio/README.md) · [版本记录](clients/seedance-studio/CHANGELOG.md) · [本站模型文档](https://api.canvasproai.com/docs)

## 开发与复现

本仓库只包含客户端与公开售价测试数据，不包含 Canvas 主项目、私有渠道配置、数据库或服务端密钥。

使用 Node.js 24.14.1：

```powershell
npm ci --ignore-scripts
npm test
node clients/seedance-studio/server.mjs
```

最后一条命令输出本机浏览器地址；地址中的本机会话片段不要公开。浏览器连接需要用户自行提供本站 Key。

Windows 便携打包：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/seedance-client-package.ps1 -OutputRoot '.codex/releases/local-build'
```

打包器核对官方 Node.js 24.14.1 x64 SHA，下载完整 Node LICENSE；输出位置已存在会拒绝覆盖。Node.js 第三方许可随便携包的 `runtime/LICENSE` 提供。`-ExecutionPolicy Bypass` 仅用于该开发命令的进程，不要求更改机器的持久策略；普通用户直接启动 EXE。
