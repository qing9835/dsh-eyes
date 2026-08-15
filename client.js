// dsh-vision-bridge client bundle（手构建：tsdown 同款 closure-factory 格式）
var module = { exports: {} }; var exports = module.exports;
window.__ModuleLoader__.load({ id: 'dsh-vision-bridge', factory: (require) => {
const React = require('react')

const MAX_IMAGES = 9
const store = {
  sessions: new Map(),
  configOpen: false,
  config: null,
  listeners: new Set(),
}
function notify() {
  for (const fn of [...store.listeners]) fn()
}
function useStore() {
  const [, force] = React.useState(0)
  React.useEffect(() => {
    const fn = () => force(x => x + 1)
    store.listeners.add(fn)
    return () => store.listeners.delete(fn)
  }, [])
}
function sessionState(sid) {
  let s = store.sessions.get(sid)
  if (!s) {
    s = { images: [], busy: false, error: null, rounds: [], draft: '', actions: null }
    store.sessions.set(sid, s)
  }
  return s
}
function useVision(sid) {
  const [, force] = React.useState(0)
  React.useEffect(() => {
    const fn = () => force(x => x + 1)
    store.listeners.add(fn)
    return () => store.listeners.delete(fn)
  }, [])
  return sessionState(sid)
}
function isImageFile(f) {
  if (!f) return false
  if (f.type) return f.type.startsWith('image/')
  return /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(f.name || '')
}
function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(file)
  })
}
// Client→Host RPC：HTTP 路由（/vision-bridge/*），JSON 信封 {ok, data|error}
function rpc(method, body) {
  return fetch('/vision-bridge/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(r => r.json()).then(envelope => {
    if (!envelope || envelope.ok !== true) {
      throw new Error((envelope && envelope.error) || 'vision-bridge: RPC 失败')
    }
    return envelope.data
  })
}
function saveToHost(sid, items) {
  const st = sessionState(sid)
  const room = MAX_IMAGES - st.images.length
  if (room <= 0) {
    st.error = '最多同时 ' + MAX_IMAGES + ' 张图片'
    notify()
    return
  }
  const batch = items.slice(0, room)
  if (batch.length === 0) return
  st.busy = true
  notify()
  rpc('save', { images: batch.map(it => ({ dataUrl: it.dataUrl, name: it.name })) })
    .then(saved => {
      const byId = {}
      ;(saved.images || []).forEach((it, i) => { byId[it.id] = batch[i] })
      st.images = st.images.concat((saved.images || []).map(it => ({
        id: it.id,
        dataUrl: (byId[it.id] && byId[it.id].dataUrl) || '',
        name: it.name,
        sent: false,
      })))
      st.busy = false
      st.error = null
      notify()
    })
    .catch(e => {
      st.busy = false
      st.error = '图片保存失败: ' + String((e && e.message) || e)
      notify()
    })
}
function addFiles(sid, files) {
  const batch = files.filter(isImageFile)
  if (batch.length === 0) {
    const st = sessionState(sid)
    st.error = '没有找到图片文件'
    notify()
    return
  }
  Promise.all(batch.map((file, i) => fileToDataUrl(file).then(dataUrl => ({
    dataUrl,
    name: file.name || 'image-' + i,
  }))))
    .then(items => saveToHost(sid, items))
    .catch(e => {
      const st = sessionState(sid)
      st.error = String((e && e.message) || e)
      notify()
    })
}
function addDataUrls(sid, items) {
  saveToHost(sid, items)
}
function removeImage(sid, id) {
  const st = sessionState(sid)
  st.images = st.images.filter(i => i.id !== id)
  notify()
}
function clearAll(sid) {
  const st = sessionState(sid)
  st.images = []
  st.rounds = []
  st.error = null
  st.busy = false
  rpc('reset', { sessionId: sid }).catch(() => {})
  notify()
}
async function runRound(sid) {
  const st = sessionState(sid)
  if (st.busy) return
  const fresh = st.images.filter(i => !i.sent)
  if (fresh.length === 0 && st.rounds.length === 0) {
    st.error = '请先粘贴 / 拖入 / 导入图片'
    notify()
    return
  }
  st.busy = true
  st.error = null
  notify()
  try {
    const requirement = (st.draft || '').trim()
    const res = await rpc('ask', {
      sessionId: sid,
      images: fresh.map(i => ({ id: i.id })),
      prompt: requirement,
    })
    st.busy = false
    st.images = []
    st.rounds = []
    if (st.actions && res.text) {
      // 方案 B：输入了要求时，把【我的要求 + 图片识别结果】一起发给主模型
      const text = requirement
        ? '我的要求：' + requirement + '\n\n图片识别结果：\n' + res.text
        : res.text
      st.actions.setDraft(text)
      st.actions.submit()
    }
    notify()
  } catch (e) {
    st.busy = false
    st.error = String((e && (e.message || e)) || e)
    notify()
  }
}
const ICONS = {
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
}
function Icon({ name, spin }) {
  return React.createElement('span', {
    className: 'dynv-ic' + (spin ? ' dynv-spin' : ''),
    dangerouslySetInnerHTML: { __html: ICONS[name] || '' },
  })
}
function VisionDock(props) {
  const sid = props.sessionId
  const st = useVision(sid)
  if (props.input && typeof props.input.draft === 'string') st.draft = props.input.draft
  if (props.inputActions) st.actions = props.inputActions
  React.useEffect(() => {
    const onPasteCapture = (e) => {
      const files = []
      if (e.clipboardData && e.clipboardData.items) {
        for (const item of e.clipboardData.items) {
          if (item.kind === 'file') {
            const f = item.getAsFile()
            if (f && isImageFile(f)) files.push(f)
          }
        }
      }
      if (files.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      addFiles(sid, files)
    }
    const onDropCapture = (e) => {
      const dt = e.dataTransfer
      if (!dt) return
      const types = Array.from(dt.types || [])
      if (!types.includes('Files')) return
      const files = Array.from(dt.files || []).filter(isImageFile)
      if (files.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      addFiles(sid, files)
    }
    const onKeyCapture = (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return
      const st = sessionState(sid)
      if (st.busy) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (st.images.length === 0 && st.rounds.length === 0) return
      const t = e.target
      if (!t || t.tagName !== 'TEXTAREA') return
      e.preventDefault()
      e.stopPropagation()
      runRound(sid)
    }
    document.addEventListener('paste', onPasteCapture, true)
    document.addEventListener('drop', onDropCapture, true)
    document.addEventListener('keydown', onKeyCapture, true)
    return () => {
      document.removeEventListener('paste', onPasteCapture, true)
      document.removeEventListener('drop', onDropCapture, true)
      document.removeEventListener('keydown', onKeyCapture, true)
    }
  }, [sid])

  if (st.images.length === 0 && !st.error && !st.busy) return null
  const thumbs = st.images.map(img => React.createElement('span', { key: img.id || img.name, className: 'dynv-thumb' },
    React.createElement('img', { src: img.dataUrl, alt: img.name, className: 'dynv-thumb-img', title: img.name }),
    React.createElement('button', {
      className: 'dynv-x',
      title: '移除',
      onClick: () => removeImage(sid, img.id),
    }, '×'),
  ))
  let status
  if (st.busy) {
    status = React.createElement('span', { className: 'dynv-status dynv-busy' },
      React.createElement(Icon, { name: 'refresh', spin: true }),
      '识别中…',
    )
  } else if (st.error) {
    status = React.createElement('span', { className: 'dynv-status dynv-error' },
      React.createElement(Icon, { name: 'image' }),
      st.error,
    )
  } else {
    status = React.createElement('span', { className: 'dynv-status' },
      React.createElement(Icon, { name: 'image' }),
      st.images.length + '/' + MAX_IMAGES + ' 张 · 回车识别并发送 · 复核由 AI 判断',
    )
  }
  return React.createElement('div', { className: 'dynv-dock-wrap' },
    React.createElement('div', { className: 'dynv-dock' },
      React.createElement('div', { className: 'dynv-dock-row' },
        React.createElement('div', { className: 'dynv-thumbs' }, thumbs),
        React.createElement('button', { className: 'dynv-clear', onClick: () => clearAll(sid) },
          React.createElement(Icon, { name: 'trash' }),
          '清空',
        ),
      ),
      React.createElement('div', { className: 'dynv-info' }, status),
    ),
  )
}
function ImportButton(props) {
  const sid = props.sessionId
  const fileRef = React.useRef(null)
  return React.createElement('span', { className: 'dynv-left' },
    React.createElement('button', {
      className: 'dynv-btn',
      title: '选择图片文件（可多选）',
      onClick: () => { if (fileRef.current) fileRef.current.click() },
    },
      React.createElement(Icon, { name: 'image' }),
      '导入图片',
    ),
    React.createElement('input', {
      ref: fileRef,
      type: 'file',
      accept: 'image/*',
      multiple: 'true',
      style: { display: 'none' },
      onChange: (e) => { addFiles(sid, Array.from(e.target.files || [])); e.target.value = '' },
    }),
  )
}
function ConfigButton(props) {
  return React.createElement('span', { className: 'dynv-left' },
    React.createElement('button', { className: 'dynv-btn', title: '视觉识别配置', onClick: () => { store.configOpen = !store.configOpen; notify() } },
      React.createElement(Icon, { name: 'gear' }),
      '配置',
    ),
  )
}
function ConfigDialog() {
  useStore()
  const [view, setView] = React.useState(null)
  const [form, setForm] = React.useState(null)
  const [status, setStatus] = React.useState({ phase: 'idle', text: '' })
  React.useEffect(() => {
    if (store.configOpen && view === null) {
      rpc('configGet', {})
        .then(r => {
          const cfg = (r && r.config) || {}
          const providers = (r && r.providers) || []
          const keys = (r && r.keys) || {}
          const compatNote = (r && r.compatNote) || ''
          const matched = providers.find(p => p.baseUrl === cfg.baseUrl) || null
          setView({ providers, keys, compatNote })
          setForm({
            provider: matched ? matched.id : 'custom',
            baseUrl: cfg.baseUrl || '',
            model: cfg.model || '',
            apiKey: (matched && keys[matched.id]) || cfg.apiKey || '',
            systemPrompt: cfg.systemPrompt || '',
          })
        })
        .catch(() => {
          setView({ providers: [], keys: {}, compatNote: '' })
          setForm({ provider: 'custom', baseUrl: '', model: '', apiKey: '', systemPrompt: '' })
        })
    }
  }, [store.configOpen, view])
  if (!store.configOpen || view === null || form === null) return null
  const close = () => {
    setView(null)
    setForm(null)
    setStatus({ phase: 'idle', text: '' })
    store.configOpen = false
    notify()
  }
  const current = view.providers.find(p => p.id === form.provider) || null
  const models = current ? current.models : []
  const change = (key, value) => setForm({ ...form, [key]: value })
  const pickProvider = (id) => {
    const p = view.providers.find(x => x.id === id) || null
    const remembered = view.keys && view.keys[id]
    setForm({
      ...form,
      provider: id,
      baseUrl: p ? p.baseUrl : form.baseUrl,
      model: p ? p.models[0] : form.model,
      apiKey: remembered || form.apiKey,
    })
    setStatus({ phase: 'idle', text: '' })
  }
  const runTest = async () => {
    setStatus({ phase: 'testing', text: '正在测试连接…' })
    try {
      const res = await rpc('configValidate', { baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey })
      if (res && res.ok) setStatus({ phase: 'ok', text: res.note || '连接成功' })
      else setStatus({ phase: 'error', text: (res && res.error) || '测试失败' })
    } catch (e) {
      setStatus({ phase: 'error', text: String((e && e.message) || e) })
    }
  }
  const save = async () => {
    setStatus({ phase: 'testing', text: '正在校验并保存…' })
    try {
      const res = await rpc('configValidate', { baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey })
      if (!(res && res.ok)) {
        setStatus({ phase: 'error', text: (res && res.error) || '校验失败' })
        return
      }
      await rpc('configSet', {
        provider: form.provider,
        baseUrl: form.baseUrl,
        model: form.model,
        apiKey: form.apiKey,
        systemPrompt: form.systemPrompt,
      })
      close()
    } catch (e) {
      setStatus({ phase: 'error', text: String((e && e.message) || e) })
    }
  }
  const statusCls = 'dynv-dialog-status' + (status.phase === 'ok' ? ' dynv-ok' : status.phase === 'error' ? ' dynv-error' : status.phase === 'testing' ? ' dynv-busy' : '')
  const statusEl = status.phase === 'idle' ? null : React.createElement('span', { className: statusCls },
    status.phase === 'testing' ? React.createElement(Icon, { name: 'refresh', spin: true }) : status.phase === 'ok' ? React.createElement(Icon, { name: 'check' }) : React.createElement(Icon, { name: 'alert' }),
    status.text,
  )
  return React.createElement('div', { className: 'dynv-overlay' },
    React.createElement('div', { className: 'dynv-dialog' },
      React.createElement('div', { className: 'dynv-dialog-title' }, '视觉识别配置'),
      React.createElement('div', { className: 'dynv-note' }, view.compatNote),
      React.createElement('label', { className: 'dynv-field' },
        React.createElement('span', { className: 'dynv-field-label' }, '服务商（预设）'),
        React.createElement('select', { className: 'dynv-input', value: form.provider, onChange: (e) => pickProvider(e.target.value) },
          view.providers.map(p => React.createElement('option', { key: p.id, value: p.id }, p.label)),
          React.createElement('option', { key: 'custom', value: 'custom' }, '自定义'),
        ),
      ),
      React.createElement('label', { className: 'dynv-field' },
        React.createElement('span', { className: 'dynv-field-label' }, 'API Base URL'),
        React.createElement('input', {
          className: 'dynv-input',
          type: 'text',
          value: form.baseUrl,
          onChange: (e) => change('baseUrl', e.target.value),
          placeholder: 'https://.../v1',
        }),
      ),
      React.createElement('label', { className: 'dynv-field' },
        React.createElement('span', { className: 'dynv-field-label' }, '模型'),
        React.createElement('input', {
          className: 'dynv-input',
          type: 'text',
          value: form.model,
          list: 'dynv-model-list',
          onChange: (e) => change('model', e.target.value),
          placeholder: '可从列表选择或自行输入',
        }),
        React.createElement('datalist', { id: 'dynv-model-list' }, models.map(m => React.createElement('option', { key: m, value: m }))),
      ),
      React.createElement('label', { className: 'dynv-field' },
        React.createElement('span', { className: 'dynv-field-label' }, 'API Key'),
        React.createElement('input', {
          className: 'dynv-input',
          type: 'password',
          value: form.apiKey,
          onChange: (e) => change('apiKey', e.target.value),
          placeholder: '输入 API Key（ModelScope 可带 ms- 前缀，自动去除）',
        }),
      ),
      React.createElement('div', { className: 'dynv-note' }, current ? current.note : '自定义配置：手动填写 Base URL、模型名与 API Key。'),
      React.createElement('details', { className: 'dynv-details' },
        React.createElement('summary', null, '高级选项（系统提示词）'),
        React.createElement('textarea', { className: 'dynv-input', value: form.systemPrompt, onChange: (e) => change('systemPrompt', e.target.value) }),
      ),
      statusEl,
      React.createElement('div', { className: 'dynv-dialog-actions' },
        React.createElement('button', { className: 'dynv-btn', onClick: runTest, disabled: status.phase === 'testing' }, '测试连接'),
        React.createElement('button', { className: 'dynv-btn dynv-btn-primary', onClick: save, disabled: status.phase === 'testing' }, '保存'),
        React.createElement('button', { className: 'dynv-btn', onClick: close }, '取消'),
      ),
    ),
  )
}

module.exports = {
  name: 'dsh-vision-bridge-client',
  apply(ctx) {
    const css = `
.dynv-ic{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none}
.dynv-ic svg{width:100%;height:100%}
.dynv-spin{animation:dynv-spin 0.9s linear infinite}
@keyframes dynv-spin{to{transform:rotate(360deg)}}
.dynv-dock-wrap{box-sizing:border-box;display:flex;justify-content:flex-start;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:6px auto 0;padding:0 var(--dsh-composer-dock-inset)}
.dynv-dock{display:inline-flex;flex-direction:column;gap:6px;padding:8px 12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;color:var(--dsw-alias-label-primary);font-size:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);width:fit-content;max-width:100%}
.dynv-dock-row{display:flex;align-items:center;gap:12px;min-width:0}
.dynv-thumbs{display:flex;gap:8px;align-items:center;overflow-x:auto;max-width:560px;padding:2px 0}
.dynv-thumb{position:relative;display:inline-flex;flex:none}
.dynv-thumb-img{width:42px;height:42px;object-fit:cover;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);transition:transform .12s ease}
.dynv-thumb-img:hover{transform:scale(1.06)}
.dynv-x{position:absolute;top:-7px;right:-7px;width:17px;height:17px;line-height:15px;padding:0;border:none;border-radius:9px;background:var(--dsw-alias-state-error-primary);color:#fff;cursor:pointer;font-size:11px;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.dynv-info{display:flex;min-width:0}
.dynv-status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
.dynv-busy{color:var(--dsw-alias-brand-primary)}
.dynv-error{color:var(--dsw-alias-state-error-primary)}
.dynv-ok{color:var(--dsw-alias-brand-primary)}
.dynv-clear{flex:none;display:inline-flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);border-radius:6px;cursor:pointer;font-size:12px;padding:4px 10px;transition:background .15s,color .15s,border-color .15s}
.dynv-clear:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dynv-btn{display:inline-flex;align-items:center;gap:5px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);border-radius:6px;cursor:pointer;font-size:12px;padding:4px 10px;line-height:18px;transition:background .15s,color .15s,border-color .15s}
.dynv-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dynv-btn:disabled{opacity:.55;cursor:default}
.dynv-btn-primary{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dynv-btn-primary:hover{background:var(--dsw-alias-bg-layer-2)}
.dynv-left{position:relative;display:inline-flex;align-items:center}
.dynv-overlay{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.16);pointer-events:auto}
.dynv-dialog{width:460px;max-width:92vw;padding:14px 16px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.12);display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary);font-size:12px}
.dynv-dialog-title{font-weight:600;font-size:13px}
.dynv-field{display:flex;flex-direction:column;gap:4px}
.dynv-field-label{color:var(--dsw-alias-label-secondary);font-size:12px}
.dynv-input{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);padding:6px 9px;font-size:12px;font-family:inherit;width:100%;box-sizing:border-box}
.dynv-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dynv-note{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}
.dynv-dialog-status{display:inline-flex;align-items:center;gap:6px;min-height:18px;color:var(--dsw-alias-label-secondary)}
.dynv-dialog-actions{display:flex;gap:8px;justify-content:flex-end}
.dynv-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;user-select:none}
.dynv-details textarea{min-height:56px;resize:vertical}
`
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-vision-bridge/styles"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-vision-bridge'
      tag.dataset.pluginCss = 'dsh-vision-bridge/styles'
      tag.textContent = css
      document.head.appendChild(tag)
    }
    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('conversation.input.left', () => slots.register(
      { name: 'conversation.input.left', id: 'vision-import', order: 5 },
      (props) => React.createElement(ImportButton, props),
    ))
    slots.inject('conversation.input.left', () => slots.register(
      { name: 'conversation.input.left', id: 'vision-config', order: 6 },
      (props) => React.createElement(ConfigButton, props),
    ))
    slots.inject('conversation.input.dock', () => slots.register(
      { name: 'conversation.input.dock', id: 'vision-dock', order: 15 },
      (props) => React.createElement(VisionDock, props),
    ))
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'vision-config-dialog' },
      () => React.createElement(ConfigDialog),
    ))
  },
}
return module.exports; } });
