// dsh-vision-bridge host half —— 静态插件版
// 由动态插件 vision-bridge（visex-1/pkg-26）转正；逻辑一致：
//   Client→Host RPC 改为 HTTP 路由（/vision-bridge/*，webServer 注册）
//   模型工具改用 ctx.tools.register（手写 ToolDefinition，无外部依赖）
export const name = 'dsh-vision-bridge'
// 硬依赖：等 webServer（HTTP RPC 路由）与 tools（vision_ask 注册）就绪后再 apply。
// 无 inject 时冷启动激活过早，两个服务尚不可用，路由与工具会静默缺失。
export const inject = ['webServer', 'tools']

export function apply(ctx) {
  const config = {
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    model: 'mimo-v2.5',
    apiKey: '', // 默认无密钥：首次使用请在配置弹窗填写（本机配置已持久化在 .vision-images/.config.json）
    systemPrompt: '你是一个专业的图片识别助手。请用中文尽可能完整、准确地描述图片内容：图片中的文字（原样转写）、主体、场景、布局、颜色、数量等细节。请直接给出最终描述，不要复述问题。',
    maxTokens: 16384,
  }
  const COMPAT_NOTE = '所有预设均为 OpenAI 兼容接口：POST {baseUrl}/chat/completions，Authorization: Bearer <Key>，图片以 data URL 内联传输。'
  const PROVIDERS = [
    {
      id: 'opencode-go',
      label: 'OpenCode（Go 套餐）',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      models: ['mimo-v2.5', 'mimo-v2.5-pro', 'kimi-k3'],
      note: 'OpenAI 兼容接口。Go 套餐模型：kimi-k3 / mimo-v2.5 / mimo-v2.5-pro。API Key 请在 OpenCode 账户中获取并自行填写。',
    },
    {
      id: 'modelscope',
      label: 'ModelScope 视觉模型',
      baseUrl: 'https://api-inference.modelscope.cn/v1',
      models: [
        'Qwen/Qwen3.5-397B-A17B',
        'Qwen/Qwen3-VL-235B-A22B-Instruct',
        'Qwen/Qwen3.5-122B-A10B',
      ],
      note: 'OpenAI 兼容接口。可用模型：Qwen/Qwen3.5-397B-A17B、Qwen/Qwen3-VL-235B-A22B-Instruct、Qwen/Qwen3.5-122B-A10B。Key 在 https://modelscope.cn/my/myaccesstoken 免费申请（每日 2000 次）。令牌形如 ms-xxx，填写时去掉 ms- 前缀（插件发送时也会自动处理）。',
    },
  ]
  const MAX_IMAGES = 9
  // 64×64 渐变条纹测试图（1×1 透明 PNG 会被 ModelScope 当无效图返回空 choices）
  const TEST_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAB30lEQVR4nO3VS0uUcRxH8RNBtbBFEUEuvrqoCMKNLSqCcpGCFUK50IURQkqMxHQRGZEnZFKGybCpGMuYrLTSyogWRiQhXQhFJkQMsUKssBt2v994ehnDn+f3Ej6LwyEC9dAAHhyARohCEzRDDOJwCA5D6ywSczk6n+OLSGbTlsvJ5ZzKI7WK02s5s4FzRXRu4fw2LpbTs4NLVVyp4epefN+HatgFNbCb2WHm7SOrlgV1LK4nu4Ecj6WNrIiS10R+jNVx1rVQ0EphguJjlCQpPUFZOxUpKjuoOkuoi/AF9ncTuYzXiwEyDRhEQ3M0nKX0Qj1copEcjS7T2Eo9ytf4Gk2s1+ONerpZk1s1VaZn2/Vip6ZDerlHr+v01tPMQb2L68MRfWrT55S+dup7j35e068+/enXvzvyfV8FN1R4U5v6VXJbpQMqv6uK+6p8oOohhYYVTqt2RJFReWOKjis2oZYnSkwqOaX25+qYVtcrdb9R74yuv1ffR936ooFvuvdDg7+V/msAAxjAABkGOP8BA2Qa4HwDBjCAAQxgJw72yJwHON+AAQxgAAPYiYM9MucBzjdgAAMYwAB24mCPzHmA8w0YwAAGMICdONgjcx7gfAMGMIABDGAnDvbInAe43sB/ps+tBKHJdMAAAAAASUVORK5CYII='
  const rounds = new Map()
  let recentIds = []
  let imageDir = ''
  // 配置持久化：密钥随模型保存，插件重启/升级后依然有效
  const CONFIG_FILE = '.vision-images/.config.json'
  let keys = {}
  // 可命名的自定义模型条目：{ id, label, baseUrl, model, apiKey, systemPrompt? }
  let customProviders = []
  let configLoaded = false
  let loadPromise = null

  async function loadConfig() {
    const fs = ctx.get('fs')
    if (fs === undefined) return
    try {
      const target = await fs.resolve(CONFIG_FILE, {})
      const text = await fs.readText(target)
      const data = JSON.parse(text)
      if (data && typeof data.config === 'object') {
        for (const k of ['provider', 'baseUrl', 'model', 'apiKey', 'systemPrompt']) {
          if (typeof data.config[k] === 'string' && data.config[k].length > 0) config[k] = data.config[k]
        }
        if (typeof data.config.maxTokens === 'number' && data.config.maxTokens > 0) config.maxTokens = data.config.maxTokens
      }
      if (data && typeof data.keys === 'object' && data.keys !== null) keys = data.keys
      if (data && Array.isArray(data.customProviders)) {
        customProviders = data.customProviders.filter(c => c && typeof c === 'object'
          && typeof c.id === 'string' && typeof c.label === 'string'
          && typeof c.baseUrl === 'string' && typeof c.model === 'string')
      }
      if (!config.apiKey && keys[config.provider]) config.apiKey = keys[config.provider]
      // 旧版本保存的 provider 已不存在时回退到自定义（custom-xxx 由 customProviders 校验）
      if (!PROVIDERS.find(x => x.id === config.provider) && !config.provider.startsWith('custom-')) config.provider = 'custom'
    } catch (e) { /* 无配置文件则使用默认配置 */ }
  }
  function ensureLoaded() {
    if (configLoaded) return Promise.resolve()
    if (!loadPromise) loadPromise = loadConfig().catch(() => {}).then(() => { configLoaded = true })
    return loadPromise
  }
  async function persistConfig() {
    const fs = ctx.get('fs')
    if (fs === undefined) return
    try {
      const target = await fs.resolve(CONFIG_FILE, {})
      await fs.writeText(target, JSON.stringify({ config: { ...config }, keys, customProviders }))
    } catch (e) { /* 持久化失败不影响主流程 */ }
  }

  function touchRecent(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return
    recentIds = [...recentIds.filter(id => !ids.includes(id)), ...ids].slice(-MAX_IMAGES)
  }

  const fsProbe = () => {
    const fs = ctx.get('fs')
    if (fs === undefined || imageDir !== '') return
    fs.resolve('.vision-images/.', {}).then(t => {
      if (t && typeof t.displayPath === 'string') imageDir = t.displayPath.replace(/[\/\\]$/, '')
    }).catch(() => {})
  }
  fsProbe()

  const sp = ctx.get('systemPrompt')
  if (sp !== undefined) {
    sp.section({
      name: 'vision-bridge-rules',
      order: 150,
      text: () => {
        fsProbe()
        const dir = imageDir !== '' ? imageDir : '插件的 .vision-images/ 目录（首次保存后自动填入）'
        return '## 视觉图片识别规则（vision-bridge）\n'
          + '本会话用户粘贴/拖入/导入的图片会被插件自动保存并经当前配置的视觉模型（OpenAI 兼容接口）识别为文字作为消息进入对话，图片本身不会直接出现在对话中。\n'
          + '- 图片由插件自动管理，你【不需要查找图片文件】：调用 vision_ask 工具时省略 images 参数即可自动取回本会话最近识别的图片（若会话索引缺失则自动使用最近保存的图片，插件重启后依然有效）。图片保存在：' + dir + '（文件名即图片 ID，仅当需要指定某张图时才用）。\n'
          + '- 需要识别**你自己生成或引用的本地图片文件**（如 PDF 渲染/提取的图表、网页截图、本地文件）时，调用 vision_ask 并传入 paths 参数（绝对或相对路径，相对路径基于 DSH 进程工作目录；支持 png/jpg/gif/webp/bmp/avif，单文件 ≤20MB）；插件会自动读取并注册进图片索引，之后的多轮追问无需重复传参。\n'
          + '- 对话中的图片描述文本即视觉模型对该图的识别结果，直接基于它作答。\n'
          + '- 当对话中收到图片识别结果时，先评估它是否满足当前任务需要的信息（文字原文、数值、布局、局部细节等）。信息不足、结果模糊或需要更精确内容时，主动调用 vision_ask 工具与视觉模型继续对话追问，可多次调用；每轮基于上一轮回答继续修正，直到信息足够或视觉模型确认无法提供。\n'
          + '- 追问要具体（例如：重新识别并完整转写图中文字 / 放大看左上角写的什么 / 把第二张图的布局描述清楚）。\n'
          + '- 评估通过后主对话继续进行；全程无需用户介入，不要为了找图片而浏览文件系统，也不要要求用户重新粘贴或描述图片。'
      },
    })
  }

  // 去掉 ModelScope 令牌的 ms- 前缀
  function normalizeKey(baseUrl, apiKey) {
    let k = String(apiKey || '').trim()
    if (/modelscope\.cn/i.test(baseUrl)) k = k.replace(/^ms-?/i, '')
    return k
  }

  function bytesToBase64(bytes) {
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)))
    }
    return btoa(binary)
  }

  function textOf(content) {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const texts = content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text)
      return texts.length > 0 ? texts.join('\n') : '(图片)'
    }
    return String(content)
  }

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '')
    return m ? m[1].toLowerCase() : 'png'
  }

  // 探测图片 MIME：优先按扩展名，未知扩展名时按文件魔数
  function mimeOf(path, bytes) {
    const ext = extOf(path)
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
    if (ext === 'png' || ext === 'gif' || ext === 'webp' || ext === 'bmp' || ext === 'avif') return 'image/' + ext
    if (bytes && bytes.length >= 12) {
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
      if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
      if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
      if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
      if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
    }
    return ''
  }

  // 从任意本地图片文件（绝对/相对路径）读取并转 data URL；上限 20MB
  async function dataUrlFromPath(path) {
    const fs = ctx.get('fs')
    if (fs === undefined) throw new Error('fs 服务不可用，无法读取本地图片文件')
    let target
    try {
      target = await fs.resolve(String(path), {})
    } catch (e) {
      throw new Error('无法解析图片路径: ' + path)
    }
    let bytes
    try {
      bytes = await fs.readBytes(target, undefined, 20 * 1024 * 1024)
    } catch (e) {
      const code = e && e.code
      if (code === 'FS_NOT_FOUND') throw new Error('图片文件不存在: ' + path)
      if (code === 'FS_TOO_LARGE') throw new Error('图片文件超过 20MB 上限: ' + path)
      if (code === 'FS_NOT_REGULAR_FILE') throw new Error('路径不是文件（可能是目录）: ' + path)
      throw new Error('读取图片失败 (' + path + '): ' + String((e && e.message) || e))
    }
    if (bytes.length === 0) throw new Error('图片文件为空: ' + path)
    const mime = mimeOf(String(path), bytes)
    if (!mime) throw new Error('不支持的文件格式（支持 png/jpg/gif/webp/bmp/avif）: ' + path)
    return {
      dataUrl: 'data:' + mime + ';base64,' + bytesToBase64(bytes),
      ext: mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length),
    }
  }

  async function writeImage(id, dataUrl) {
    const fs = ctx.get('fs')
    if (fs === undefined) throw new Error('fs 服务不可用，无法保存图片')
    const target = await fs.resolve('.vision-images/' + id, {})
    await fs.writeText(target, dataUrl)
  }

  async function readImage(id) {
    const fs = ctx.get('fs')
    if (fs === undefined) throw new Error('fs 服务不可用，无法读取图片')
    if (typeof id !== 'string' || id.length === 0) throw new Error('无效的图片 ID（应为字符串）')
    const target = await fs.resolve('.vision-images/' + id, {})
    return fs.readText(target)
  }

  function metaPath(sid) {
    return '.vision-images/.meta-' + sid.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json'
  }

  async function loadMeta(sid) {
    const fs = ctx.get('fs')
    if (fs === undefined) return { history: [], lastImageIds: [] }
    try {
      const target = await fs.resolve(metaPath(sid), {})
      const text = await fs.readText(target)
      const meta = JSON.parse(text)
      const st = { history: [], lastImageIds: Array.isArray(meta.lastImageIds) ? meta.lastImageIds : [] }
      for (const m of Array.isArray(meta.history) ? meta.history : []) {
        if (m.role === 'assistant') {
          st.history.push({ role: 'assistant', content: String(m.text || '') })
        } else if (m.role === 'user') {
          const content = []
          if (Array.isArray(m.images) && m.images.length > 0 && m.isLatest) {
            for (const id of m.images) {
              try {
                const dataUrl = await readImage(id)
                if (dataUrl.startsWith('data:')) content.push({ type: 'image_url', image_url: { url: dataUrl } })
              } catch (e) { /* 文件缺失则跳过 */ }
            }
          }
          content.push({ type: 'text', text: String(m.text || '(图片)') })
          st.history.push({ role: 'user', content, images: m.images || [] })
        }
      }
      return st
    } catch (e) {
      return { history: [], lastImageIds: [] }
    }
  }

  async function saveMeta(sid, st) {
    const fs = ctx.get('fs')
    if (fs === undefined) return
    try {
      const slim = {
        lastImageIds: st.lastImageIds,
        history: st.history.slice(-8).map((m, idx, arr) => {
          const isLatestUser = m.role === 'user' && idx === arr.length - 1
          return {
            role: m.role,
            text: textOf(m.content),
            images: m.role === 'user' ? (m.images || []) : undefined,
            isLatest: m.role === 'user' && isLatestUser,
          }
        }),
      }
      const target = await fs.resolve(metaPath(sid), {})
      await fs.writeText(target, JSON.stringify(slim))
    } catch (e) { /* 持久化失败不影响主流程 */ }
  }

  // 通用 HTTP POST（node fetch，与主模型同栈）
  async function httpPost(baseUrl, apiKey, bodyObj, graceMs) {
    const sub = ctx.get('subprocess')
    if (sub === undefined) throw new Error('subprocess 服务不可用，无法发起视觉模型请求')
    const body = JSON.stringify(bodyObj)
    const url = String(baseUrl).trim().replace(/\/+$/, '') + '/chat/completions'
    const script = [
      "let body = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', d => { body += d });",
      "process.stdin.on('end', () => {",
      '  (async () => {',
      '    try {',
      '      const key = ' + JSON.stringify(apiKey) + ';',
      '      const r = await fetch(' + JSON.stringify(url) + ', {',
      "        method: 'POST',",
      "        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },",
      '        body,',
      '      });',
      '      const text = await r.text();',
      '      console.log(JSON.stringify({ status: r.status, text }));',
      '    } catch (e) {',
      '      console.log(JSON.stringify({ status: 0, text: String((e && e.message) || e) }));',
      '    }',
      '  })();',
      '});',
    ].join('\n')
    const handle = sub.spawn({
      argv: ['node', '-e', script],
      cwd: '.',
      stdio: {
        stdin: { data: body },
        stdout: { maxBytes: 16 * 1024 * 1024 },
        stderr: { maxBytes: 1024 * 1024 },
      },
      graceMs: graceMs || 120000,
    })
    const outcome = await handle.done
    const out = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const err = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    if (outcome.exitCode !== 0 && outcome.exitCode !== null) {
      throw new Error('视觉 API 子进程失败 (exit ' + outcome.exitCode + '): ' + String(err || out).slice(0, 300))
    }
    let envelope
    try {
      envelope = JSON.parse(out)
    } catch (e) {
      throw new Error('视觉 API 包装输出非 JSON: ' + String(out).slice(0, 300))
    }
    return envelope
  }

  // 配置校验：用有真实内容的测试图请求一次，给出可读错误
  async function validateConnection(cfg) {
    const baseUrl = String(cfg.baseUrl || '').trim()
    const model = String(cfg.model || '').trim()
    const apiKey = String(cfg.apiKey || '').trim()
    if (!baseUrl) return { ok: false, error: '请填写 API Base URL' }
    if (!model) return { ok: false, error: '请填写模型名' }
    if (!apiKey) return { ok: false, error: '请填写 API Key' }
    const start = Date.now()
    let envelope
    try {
      envelope = await httpPost(baseUrl, normalizeKey(baseUrl, apiKey), {
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,' + TEST_PNG } },
            { type: 'text', text: '这张图是什么颜色的？一句话回答。' },
          ],
        }],
        stream: false,
        max_tokens: 4096,
      })
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
    const latencyMs = Date.now() - start
    const status = envelope.status
    if (status !== 200) {
      const t = String(envelope.text || '').slice(0, 200)
      let msg
      if (status === 400) msg = '请求被拒绝（HTTP 400）：检查模型名是否正确，或该模型不支持图片输入'
      else if (status === 401) msg = 'API Key 无效（HTTP 401）：请检查 Key 是否正确'
      else if (status === 403) msg = '无访问权限（HTTP 403）：套餐或 Key 无权访问该模型'
      else if (status === 404) msg = '地址或模型不存在（HTTP 404）：检查 Base URL 与模型名'
      else if (status === 429) msg = '请求过于频繁（HTTP 429）：请稍后再试'
      else if (status >= 500) msg = '服务端错误（HTTP ' + status + '）：请稍后再试'
      else msg = '请求失败（HTTP ' + status + '）'
      return { ok: false, error: msg + (t ? ' — ' + t : '') }
    }
    let json = null
    try { json = JSON.parse(envelope.text) } catch (e) { json = null }
    const choice = json && json.choices && json.choices[0]
    const msg = choice && choice.message
    let content = msg && msg.content
    // 兼容 content 为数组（多模态输出）的网关：拼接其中的 text 片段
    if (Array.isArray(content)) {
      content = content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
    }
    if (typeof content !== 'string' || content.length === 0) {
      const apiErr = json && json.error && json.error.message ? ' — ' + json.error.message : ''
      if (!choice) {
        return { ok: false, error: '接口返回空响应（choices 为空）：该模型/网关可能不支持图片输入，或返回格式不是 OpenAI 兼容的 chat/completions' + apiErr }
      }
      const reason = choice.finish_reason || 'unknown'
      if (reason === 'length') {
        return { ok: false, error: '模型输出被截断（finish_reason: length）：思考/输出超出 token 预算，请确认模型支持图片，或提高输出上限' + apiErr }
      }
      if (msg && typeof msg.reasoning_content === 'string' && msg.reasoning_content.length > 0) {
        return { ok: false, error: '模型只返回了思考过程（reasoning_content）未输出回答：该模型可能是纯文本思考模型，不支持图片输入' + apiErr }
      }
      return { ok: false, error: '连接成功但模型未返回内容（finish_reason: ' + reason + '）：请确认该模型支持图片输入，或检查网关返回格式' + apiErr }
    }
    return { ok: true, model, latencyMs, note: '连接成功，模型可正常识别图片（耗时 ' + latencyMs + ' ms）' }
  }

  // 视觉模型请求：输出上限 + 低思考强度（ModelScope 与不支持 reasoning 的网关自动降级）
  async function postChat(messages, tryReasoning) {
    const bodyObj = { model: config.model, messages, stream: false, max_tokens: config.maxTokens }
    const isMs = /modelscope\.cn/i.test(config.baseUrl)
    if (tryReasoning !== false && !isMs) bodyObj.reasoning_effort = 'low'
    const envelope = await httpPost(config.baseUrl, normalizeKey(config.baseUrl, config.apiKey), bodyObj)
    if (envelope.status !== 200) {
      const text = String(envelope.text).slice(0, 300)
      if (tryReasoning !== false && envelope.status === 400 && /reasoning|unsupported|unknown/i.test(text)) {
        return postChat(messages, false)
      }
      throw new Error('视觉 API 请求失败 (HTTP ' + envelope.status + '): ' + text)
    }
    let json
    try {
      json = JSON.parse(envelope.text)
    } catch (e) {
      throw new Error('视觉 API 响应非 JSON: ' + String(envelope.text).slice(0, 300))
    }
    const choice = json && json.choices && json.choices[0]
    const content = choice && choice.message && choice.message.content
    if (typeof content !== 'string' || content.length === 0) {
      const reason = choice && choice.finish_reason ? choice.finish_reason : 'unknown'
      const errMsg = json && json.error && json.error.message
        ? json.error.message
        : '模型未返回内容 (finish_reason: ' + reason + '，可能是思考过长导致输出截断)'
      throw new Error('视觉 API 错误: ' + errMsg)
    }
    return content
  }

  async function askVision(sid, prompt, imageRefs) {
    await ensureLoaded()
    let st = rounds.get(sid)
    if (!st) {
      st = await loadMeta(sid)
      rounds.set(sid, st)
    }
    const userContent = []
    const usedIds = []
    const explicit = Array.isArray(imageRefs) && imageRefs.length > 0
    const pool = st.lastImageIds.length > 0 ? st.lastImageIds : recentIds
    for (const ref of (explicit ? imageRefs : [])) {
      let dataUrl = null
      if (ref && typeof ref.id === 'string') {
        if (/^\d+$/.test(ref.id)) {
          const idx = parseInt(ref.id, 10)
          const realId = pool[idx]
          if (realId) dataUrl = await readImage(realId)
        } else {
          dataUrl = await readImage(ref.id)
          usedIds.push(ref.id)
        }
      } else if (ref && typeof ref.path === 'string') {
        // 本地图片文件（绝对/相对路径）：读取后注册进插件索引，多轮追问可省略参数自动复用
        const loaded = await dataUrlFromPath(ref.path)
        const id = 'vis-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + loaded.ext
        await writeImage(id, loaded.dataUrl)
        dataUrl = loaded.dataUrl
        usedIds.push(id)
      } else if (ref && typeof ref.dataUrl === 'string') {
        dataUrl = ref.dataUrl
      }
      if (dataUrl && dataUrl.startsWith('data:')) {
        userContent.push({ type: 'image_url', image_url: { url: dataUrl } })
      }
    }
    if (!explicit && userContent.length === 0) {
      for (const id of pool) {
        try {
          const dataUrl = await readImage(id)
          if (dataUrl.startsWith('data:')) {
            userContent.push({ type: 'image_url', image_url: { url: dataUrl } })
            usedIds.push(id)
          }
        } catch (e) { /* 文件缺失跳过 */ }
      }
    }
    let textPrompt = String(prompt || '').trim()
    if (textPrompt === '') {
      const lastAssistant = [...st.history].reverse().find(m => m.role === 'assistant')
      textPrompt = lastAssistant
        ? '上一轮你的回答是：' + String(lastAssistant.content) + '。请在此基础上重新仔细识别图片，修正错误、补充遗漏的细节，直接输出更新后的完整描述。'
        : '请识别这些图片，输出完整、准确的中文文字描述（包括图中文字、主体、场景、布局、颜色等细节）。'
    }
    if (userContent.length === 0 && st.history.length === 0) {
      throw new Error('没有可识别的图片（本会话及最近保存的图片都不存在，请先粘贴/拖入/导入图片）')
    }
    userContent.push({ type: 'text', text: textPrompt })

    const messages = [{ role: 'system', content: config.systemPrompt }]
    const trimmed = st.history.slice(-6).map((m, idx, arr) => {
      if (m.role === 'user' && idx < arr.length - 1) return { role: 'user', content: textOf(m.content) }
      return { role: m.role, content: m.content }
    })
    messages.push(...trimmed)
    messages.push({ role: 'user', content: userContent })

    const text = await postChat(messages)
    st.history = st.history.concat([
      { role: 'user', content: userContent, images: usedIds },
      { role: 'assistant', content: text },
    ]).slice(-12)
    if (usedIds.length > 0) {
      st.lastImageIds = usedIds
      touchRecent(usedIds)
    }
    rounds.set(sid, st)
    saveMeta(sid, st)
    return { text, rounds: st.history.length, imageIds: st.lastImageIds }
  }

  // ---- Client→Host RPC（HTTP 路由，JSON 信封 {ok, data|error}）----
  const ws = ctx.get('webServer')
  function route(path, fn) {
    if (ws === undefined) return
    ctx.effect(() => ws.register({
      kind: 'exact',
      path: '/vision-bridge/' + path,
      async handler(req, res) {
        let body = ''
        try {
          for await (const chunk of req) body += chunk
          const args = body ? JSON.parse(body) : {}
          const data = await fn(args)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, data }))
        } catch (e) {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
        }
      },
    }))
  }

  route('save', async (args) => {
    const images = Array.isArray(args && args.images) ? args.images : []
    const out = []
    for (const img of images) {
      if (!img || typeof img.dataUrl !== 'string' || !img.dataUrl.startsWith('data:')) continue
      const ext = extOf(img.name)
      const id = 'vis-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext
      await writeImage(id, img.dataUrl)
      out.push({ id, name: img.name || id })
    }
    if (out.length === 0) throw new Error('没有可保存的图片')
    touchRecent(out.map(it => it.id))
    return { images: out }
  })
  route('configGet', async () => {
    await ensureLoaded()
    return {
      config: { ...config },
      providers: PROVIDERS,
      keys: { ...keys },
      compatNote: COMPAT_NOTE,
      customProviders: customProviders.map(c => ({ ...c })),
    }
  })
  route('configSet', async (args) => {
    await ensureLoaded()
    const patch = args && typeof args === 'object' ? args : {}
    if (typeof patch.provider === 'string' && patch.provider.length > 0) {
      config.provider = patch.provider
      if (patch.provider.startsWith('custom-')) {
        // 可命名自定义条目：从其条目同步 URL/模型/Key
        const cp = customProviders.find(c => 'custom-' + c.id === patch.provider)
        if (cp) {
          config.baseUrl = cp.baseUrl
          config.model = cp.model
          if (cp.apiKey) { config.apiKey = cp.apiKey; keys[patch.provider] = cp.apiKey }
        } else if (keys[patch.provider]) {
          config.apiKey = keys[patch.provider]
        }
      } else if (keys[patch.provider]) {
        config.apiKey = keys[patch.provider]
      }
    }
    for (const k of ['baseUrl', 'model', 'systemPrompt']) {
      if (typeof patch[k] === 'string' && patch[k].length > 0) config[k] = patch[k]
    }
    if (typeof patch.apiKey === 'string' && patch.apiKey.length > 0) {
      config.apiKey = patch.apiKey
      keys[config.provider] = patch.apiKey
    }
    const p = PROVIDERS.find(x => x.id === config.provider)
    config.maxTokens = p && p.id === 'modelscope' ? 8192 : 16384
    await persistConfig()
    return { ...config }
  })
  // 新建/更新可命名的自定义模型条目
  route('customSave', async (args) => {
    await ensureLoaded()
    const label = String((args && args.label) || '').trim() || '自定义模型'
    const baseUrl = String((args && args.baseUrl) || '').trim()
    const model = String((args && args.model) || '').trim()
    const apiKey = String((args && args.apiKey) || '').trim()
    if (!baseUrl) throw new Error('请填写 API Base URL')
    if (!model) throw new Error('请填写模型名')
    let entry
    const existingId = args && typeof args.id === 'string' && args.id ? args.id : ''
    if (existingId) {
      entry = customProviders.find(c => c.id === existingId)
      if (!entry) throw new Error('自定义条目不存在（可能已被删除）')
      entry.label = label
      entry.baseUrl = baseUrl
      entry.model = model
      if (apiKey) entry.apiKey = apiKey
    } else {
      entry = {
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        label,
        baseUrl,
        model,
        apiKey,
      }
      customProviders.push(entry)
    }
    // 若当前激活的就是该条目，同步活动配置
    if (config.provider === 'custom-' + entry.id) {
      config.baseUrl = entry.baseUrl
      config.model = entry.model
      if (entry.apiKey) { config.apiKey = entry.apiKey; keys[config.provider] = entry.apiKey }
    }
    await persistConfig()
    return { ...entry }
  })
  // 删除自定义模型条目
  route('customRemove', async (args) => {
    await ensureLoaded()
    const id = args && typeof args.id === 'string' ? args.id : ''
    const idx = customProviders.findIndex(c => c.id === id)
    if (idx < 0) throw new Error('自定义条目不存在')
    customProviders.splice(idx, 1)
    delete keys['custom-' + id]
    // 删除的是当前激活条目时，回退到第一个预设
    if (config.provider === 'custom-' + id) {
      const first = PROVIDERS[0]
      config.provider = first.id
      config.baseUrl = first.baseUrl
      config.model = first.models[0]
      config.apiKey = keys[first.id] || ''
    }
    await persistConfig()
    return null
  })
  route('configValidate', async (args) => {
    const patch = args && typeof args === 'object' ? args : {}
    return validateConnection({
      baseUrl: patch.baseUrl,
      model: patch.model,
      apiKey: patch.apiKey,
    })
  })
  route('reset', async (args) => {
    const sid = args && args.sessionId
    if (typeof sid === 'string') {
      rounds.delete(sid)
      try {
        const fs = ctx.get('fs')
        if (fs !== undefined) {
          const target = await fs.resolve(metaPath(sid), {})
          await fs.writeText(target, '{"history":[],"lastImageIds":[]}')
        }
      } catch (e) { /* 忽略 */ }
    }
    return null
  })
  route('readDirImages', async (args) => {
    const fs = ctx.get('fs')
    if (fs === undefined) throw new Error('fs 服务不可用，无法读取文件夹')
    const dir = args && typeof args.dir === 'string' ? args.dir : ''
    if (!dir) throw new Error('缺少目录路径')
    const target = await fs.resolve(dir, {})
    const entries = await fs.listDir(target)
    const out = []
    for (const entry of entries) {
      if (entry.type !== 'file') continue
      if (!/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(entry.name)) continue
      const bytes = await fs.readBytes(entry.target, undefined, 20 * 1024 * 1024)
      const ext = extOf(entry.name)
      const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext
      out.push({ name: entry.name, dataUrl: 'data:' + mime + ';base64,' + bytesToBase64(bytes) })
      if (out.length >= MAX_IMAGES) break
    }
    if (out.length === 0) throw new Error('文件夹中没有找到图片文件')
    return { images: out }
  })
  route('ask', async (args) => {
    await ensureLoaded()
    const sid = args && typeof args.sessionId === 'string' ? args.sessionId : 'default'
    const refs = []
    // 兼容两种入参：字符串数组（"0"/ID）与对象数组（[{id,name}]，客户端 UI 的格式）
    for (const img of Array.isArray(args && args.images) ? args.images : []) {
      if (img && typeof img === 'object') refs.push({ id: String(img.id || '') })
      else refs.push({ id: String(img) })
    }
    for (const p of Array.isArray(args && args.paths) ? args.paths : []) refs.push({ path: String(p) })
    const prompt = typeof (args && args.prompt) === 'string' ? args.prompt : ''
    return askVision(sid, prompt, refs)
  })

  // ---- 模型工具（与动态版 vision_ask 等价；parameters 为编译后 JSON Schema）----
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    ctx.effect(() => tools.register({
      name: 'vision_ask',
      description: '与当前配置的视觉模型（OpenAI 兼容接口）对话，询问图片内容。本会话用户粘贴/拖入/导入的图片已被插件自动保存，你【不需要查找图片文件】：省略 images 参数时插件自动取回本会话最近识别的图片（若会话索引缺失则自动使用最近保存的图片，插件重启后依然有效）并携带与视觉模型的全部历史对话。需要识别你自己生成/引用的本地图片文件（如 PDF 渲染/提取的图表、网页截图、本地文件）时，用 paths 参数传入文件路径（绝对或相对路径，相对路径基于 DSH 进程工作目录解析；支持 png/jpg/gif/webp/bmp/avif，单文件上限 20MB），插件会自动读取并注册进图片索引，之后的多轮追问无需重复传参。当你评估认为识别结果信息不足、模糊、缺字漏细节，或需要就图片内容进一步提问时，调用本工具与视觉模型继续对话；可多次调用，每轮基于上一轮回答继续修正，直到信息足够或视觉模型确认无法提供。返回视觉模型的文字回答。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '本次询问内容，例如：重新识别并输出完整文字描述 / 放大看图片左上角是什么 / 总结图片中的要点' },
          images: { type: 'array', items: { type: 'string' }, description: '可选的图片序号或 ID 列表（如 ["0"] 指最近保存图片的第一张）；省略则自动取回最近保存的图片' },
          paths: { type: 'array', items: { type: 'string' }, description: '可选的本地图片文件路径列表（绝对路径或相对路径，相对路径基于 DSH 进程工作目录；支持 png/jpg/gif/webp/bmp/avif，单文件 ≤20MB）。用于识别你自己生成或引用的图片（PDF 渲染图、网页截图、本地文件等）；插件读取后自动注册进图片索引，多轮追问可省略本参数复用' },
        },
        required: ['prompt'],
      },
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: v }],
      },
      async execute(args, exec) {
        const agent = exec && exec.agent
        const sid = (agent && agent.sessionId) || 'default'
        const refs = []
        // 兼容字符串与对象两种入参
        for (const img of Array.isArray(args.images) ? args.images : []) {
          if (img && typeof img === 'object') refs.push({ id: String(img.id || '') })
          else refs.push({ id: String(img) })
        }
        for (const p of Array.isArray(args.paths) ? args.paths : []) refs.push({ path: String(p) })
        const res = await askVision(sid, args.prompt || '', refs)
        return res.text
      },
    }))
  }
}
