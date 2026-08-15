# dsh-eyes —— 给 DeepSeek 外置视觉模型，鲸鱼开眼 👁️

<p align="center">
  <img src="demo/00-main-interface.png" alt="dsh-eyes 在 DeepSeek Harness 中的集成界面" width="820">
  <br>
  <em>在 DeepSeek Harness 中：同时上传 6 张图片，回车即可识别并自动发送进对话</em>
</p>

DSH 静态插件（bundle）：为无视觉能力的文本模型提供图片识别。粘贴/拖入/导入的图片被插件拦截 → 保存到 `<DSH 进程目录>/.vision-images/` → 交给 OpenAI 兼容视觉模型识别为文字 → 自动发送进对话；主模型可通过 `vision_ask` 工具复核追问（多轮）。输入框里的要求会随【我的要求 + 图片识别结果】一起发给主模型（方案 B）。

由动态插件 vision-bridge（visex-1）转正：Host 半体逻辑一致，Client→Host RPC 改用 HTTP 路由（`/vision-bridge/*`），模型工具改用 `ctx.tools.register`。

## 文件

| 文件 | 内容 |
| --- | --- |
| `index.js` | Host 半体（图片落盘、配置持久化、HTTP 路由、`vision_ask` 工具注册、系统提示词段） |
| `client.js` | 浏览器 bundle（`window.__ModuleLoader__.load` closure-factory 格式，手构建，无外部依赖） |
| `cordis.patch.yml` | 插入一行 `vision-bridge`（name: dsh-vision-bridge） |

## 安装

**从 GitHub 一键安装（推荐，公开仓库）：**

```sh
dsh plugin --profile web add github:qing9835/dsh-eyes#v0.1.0
```

- 本包无构建步骤（index.js / client.js 均为成品），Git 安装无需 `allowBuilds` 授权；
- 建议钉住 tag/SHA（如上 `#v0.1.0`），不要裸 `#main`；
- 装完重启 DSH 自动生效（或把 `cordis.patch.yml` 里的行加入 `$DSH_HOME/cordis.patch.yml` 热激活）；
- 首次使用请在配置弹窗填写自己的 API Key（默认无密钥）。

**本地安装（开发）：**

```sh
dsh plugin --profile web add ./dsh-vision-bridge
```

装完后该 bundle 进入 web profile 的 `dsh.profile.bundles`，下次启动自动生效。运行时热激活：把以下行加入 `$DSH_HOME/cordis.patch.yml`（home 层会被监听并事务性重放）：

```yaml
- insert:
    - id: vision-bridge
      name: dsh-vision-bridge
```

浏览器侧生效需刷新页面（`window.__DSH_BOOT__` 由 host 重新注入）。

## 数据（磁盘持久化，与动态版共用）

```
<DSH 进程目录>\.vision-images\
├── vis-*.png            ← 图片（文件名即图片 ID）
├── .meta-<会话ID>.json  ← 各会话识别历史
└── .config.json         ← 配置 + 每个提供商的 Key 记忆
```

## 预设服务商（全部 OpenAI 兼容）

- OpenCode（Go 套餐）：`https://opencode.ai/zen/go/v1` — kimi-k3 / mimo-v2.5 / mimo-v2.5-pro
- ModelScope：`https://api-inference.modelscope.cn/v1` — Qwen/Qwen3.5-397B-A17B、Qwen/Qwen3-VL-235B-A22B-Instruct、Qwen/Qwen3.5-122B-A10B（Key `ms-` 前缀自动去除）
- 自定义：任意 OpenAI 兼容端点

## 演示

完整演示流程：

<p align="center">
  <img src="demo/01-source-photo.jpg" alt="演示原图：古风女子雪景摄影" width="820">
  <br>
  <em>① 演示原图（古风女子雪景摄影）</em>
</p>

<p align="center">
  <img src="demo/02-upload-interface.png" alt="上传图片到 DSH 输入区" width="820">
  <br>
  <em>② 图片被插件拦截，出现在输入框上方的弹窗中（不进输入框），左下角为「导入图片」「配置」按钮</em>
</p>

<p align="center">
  <img src="demo/03-config-dialog.png" alt="视觉识别配置弹窗" width="820">
  <br>
  <em>③ 配置弹窗：多提供商预设（OpenCode / ModelScope），均为 OpenAI 兼容接口，保存前自动校验</em>
</p>

<p align="center">
  <img src="demo/04-recognition-result.png" alt="识别结果自动发送进对话" width="820">
  <br>
  <em>④ 回车后视觉模型识别为文字，自动发送进对话（主模型可直接基于它继续工作）</em>
</p>

<p align="center">
  <img src="demo/05-vision-ask-followup.png" alt="vision_ask 多轮追问" width="820">
  <br>
  <em>⑤ 主模型通过 vision_ask 工具对局部细节（护额、额饰、耳饰等）多轮追问，视觉模型逐项精确回答</em>
</p>

## 重建 client.js

client.js 为手构建产物（无构建链）。修改客户端代码后，保持文件结构：
首行 `var module = { exports: {} }; var exports = module.exports;`，随后 `window.__ModuleLoader__.load({ id: 'dsh-vision-bridge', factory: (require) => { ... } })`，`require('react')` 解析 shell 平台模块，末尾 `return module.exports; } });`。
Host 半体修改后无需构建（Node 直接加载）。

## 注意

- 默认无 API Key（公开仓库不带密钥）：首次使用在配置弹窗填写，配置会持久化到 `<DSH 进程目录>/.vision-images/.config.json`
- 工具为进程级注册（所有会话可见）；与动态版同存时会重名冲突，转正后应 `cordis_stop` 旧动态插件
