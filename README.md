# dsh-eyes —— 给 DeepSeek 外置视觉模型，鲸鱼开眼 👁️

<p align="center">
  <img src="https://img.shields.io/badge/DSH-插件-blue" alt="DSH 插件">
  <img src="https://img.shields.io/badge/图片识别-视觉桥-brightgreen" alt="图片识别">
  <img src="https://img.shields.io/badge/OpenAI%20兼容-API-orange" alt="OpenAI 兼容">
  <img src="https://img.shields.io/badge/多模型-OpenCode%2FModelScope-purple" alt="多模型">
  <img src="https://img.shields.io/badge/开源-MIT-green" alt="MIT License">
</p>

<p align="center">
  <img src="demo/00-main-interface.png" alt="dsh-eyes 在 DeepSeek Harness 中的集成界面" width="820">
  <br>
  <em>在 DeepSeek Harness 中：同时上传 6 张图片，回车即可识别并自动发送进对话</em>
</p>

DeepSeek Harness 的网页聊天用的是纯文本模型，看不了图。这个插件给 DSH 装上一双外置"眼睛"：你粘贴、拖入或导入的图片会被它截下来，交给一个支持图片的 OpenAI 兼容模型（GLM-4.6V、Qwen-VL 这类）识别成文字，再自动发进对话——纯文本模型也能看图了。

识别结果不理想时，主模型会通过 `vision_ask` 工具自己判断要不要追问、追问什么，一轮轮把细节问清楚，不用你盯着。输入框里写了要求的话，识别完会把【我的要求 + 识别结果】一起发给主模型。

除了你发的图，Agent 自己生成的图片也能识别：PDF 里渲染出来的图表、网页截图、本地文件，调用 `vision_ask` 时传 `paths` 指个路径就行。读过的图插件会记住，后面几轮追问不用再传。

项目最早是动态插件原型，现在转正为随 DSH 启动自动加载的静态插件（bundle），配置、图片、历史都落盘持久化。

## 功能

- **图片不进输入框**：粘贴 / 拖入 / 导入后弹窗显示缩略图，按 Enter 识别并自动发送
- **一次最多 9 张图**，多张一起识别
- **带着要求一起发**：输入框写了要求时，把【我的要求 + 识别结果】一起发给主模型
- **看不清就追问**：主模型用 `vision_ask` 工具自己判断要不要再问，视觉模型会结合之前的回答逐轮修正
- **能读本地文件**：Agent 自己生成的图片（PDF 渲染的图表、网页截图等）也能识别，`vision_ask` 传 `paths` 指个路径就行（绝对或相对路径，相对路径基于 DSH 进程工作目录；支持 png/jpg/gif/webp/bmp/avif，单文件 20MB 以内）；读过的图会被插件记住，后续追问不用重复传
- **多套模型随便换**：内置 OpenCode（3 个模型）和 ModelScope（3 个模型）预设，也可以自己加任意 OpenAI 兼容模型（比如 GLM-4.6V），保存前会先测一下通不通
- **配置不丢**：每个服务商的 Key 分开记，重启插件也还在

## 文件

| 文件 | 内容 |
| --- | --- |
| `index.js` | Host 半体（图片落盘、配置持久化、HTTP 路由、`vision_ask` 工具注册（含 `paths` 本地文件直读）、系统提示词段） |
| `client.js` | 浏览器 bundle（`window.__ModuleLoader__.load` closure-factory 格式，手构建，无外部依赖） |
| `cordis.patch.yml` | 插入一行 `vision-bridge`（name: dsh-vision-bridge） |

## 安装

**从 GitHub 一键安装（推荐，公开仓库）：**

```sh
# 方式一：npx 直接跑（本机没装 DSH 也行，自动从 npm 拉取 CLI）
npx @deepseek-ai/dsh plugin --profile web add github:qing9835/dsh-eyes#v0.1.0

# 方式二：本机已装 DSH（全局命令，或在 DSH 源码目录里用 pnpm dsh）
dsh plugin --profile web add github:qing9835/dsh-eyes#v0.1.0
```

两种写法是同一个 CLI，任选其一即可。

> 💡 **Windows PowerShell 用户注意**：若 `npx` 报 `npx.ps1 cannot be loaded ... not digitally signed`，是系统执行策略拦截脚本。二选一解决：
> 1. 用 `npx.cmd` 代替 `npx`（如 `npx.cmd @deepseek-ai/dsh plugin --profile web add github:qing9835/dsh-eyes#v0.1.0`）；
> 2. 执行一次 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`（Node 官方推荐，之后 `npx` 即可正常使用）。

- 本包无构建步骤（index.js / client.js 均为成品），Git 安装无需 `allowBuilds` 授权；
- 建议钉住 tag/SHA（如上 `#v0.1.0`），不要裸 `#main`；
- 装完**重启 DSH** 自动生效，然后刷新浏览器页面；
- 插件行由 bundle 自带（`cordis.patch.yml`），**不要**再往 `$DSH_HOME/cordis.patch.yml` 加同名行，否则冷启动报 `duplicate loader entry id: vision-bridge`；
- 首次使用请在配置弹窗填写自己的 API Key（默认无密钥）。

**卸载：**

```sh
# 方式一：npx；方式二：已装 DSH 的本机命令（同一个 CLI）
npx @deepseek-ai/dsh plugin --profile web remove dsh-vision-bridge
dsh plugin --profile web remove dsh-vision-bridge
```

> 注意：包名是 `dsh-vision-bridge`（GitHub 仓库名才是 `dsh-eyes`），卸载/安装都使用包名。卸载后重启 DSH 生效。

**本地安装（开发）：**

```sh
npx @deepseek-ai/dsh plugin --profile web add ./dsh-vision-bridge
dsh plugin --profile web add ./dsh-vision-bridge
```

装完后该 bundle 进入 web profile 的 `dsh.profile.bundles`，重启 DSH 自动生效（bundle 列表变更不会热重放，必须重启进程），浏览器侧再刷新页面（`window.__DSH_BOOT__` 由 host 重新注入）。

## 数据都存哪

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
  <em>③ 配置弹窗：选模型、填 Key，保存前会自动测一下通不通</em>
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
