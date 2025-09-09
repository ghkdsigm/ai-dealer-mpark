// back/server/index.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음
const express = require('express')
const cors = require('cors')
const path = require('path')
const { recommend, inferFilters } = require('./infer')

const app = express()
app.use(cors())
app.use(express.json())

// 간단 요청 로거
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
  next()
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.post('/api/recommend', (req, res) => {
  try {
    const body = req.body || {}
    const q = typeof body.q === 'string' ? body.q.trim() : ''
    const limitRaw = body.limit
    const limit = Number.isFinite(limitRaw) ? limitRaw : 8
    if (!q) return res.status(400).json({ error: 'BAD_REQUEST', message: 'q is required' })

    const out = recommend(q, limit)
    const items = Array.isArray(out) ? out : (out.items || out || [])
    return res.json({ items })
  } catch (e) {
    console.error('[API/recommend] failed:', e && e.stack ? e.stack : e)
    return res.status(500).json({ error: 'RECOMMEND_FAIL', message: String(e && e.message || e) })
  }
})

app.post('/api/parse', (req, res) => {
  try {
    const q = String(req.body?.q || '').trim()
    if (!q) return res.status(400).json({ error: 'BAD_REQUEST', message: 'q is required' })
    const filters = inferFilters(q)
    return res.json({ filters })
  } catch (e) {
    console.error('[API/parse] failed:', e && e.stack ? e.stack : e)
    return res.status(500).json({ error: 'PARSE_FAIL', message: String(e && e.message || e) })
  }
})

// 선택: 프론트가 /api/chat을 호출하고 있다면 이 라우트도 제공
app.post('/api/chat', (req, res) => {
  try {
    const msg = String(req.body?.message || '').trim()
    if (!msg) return res.status(400).json({ error: 'BAD_REQUEST', message: 'message is required' })

    const out = recommend(msg, 5)
    const items = Array.isArray(out) ? out : (out.items || out || [])
    let reply = ''
    if (items.length) {
      const top = items[0]
      reply = `${top.year ?? ''} ${top.make} ${top.model}가 조건에 잘 맞습니다.`
    } else {
      reply = '조건에 맞는 매물이 없어 범위를 조금 넓혀 다시 시도해 주세요.'
    }
    return res.json({ reply, items })
  } catch (e) {
    console.error('[API/chat] failed:', e && e.stack ? e.stack : e)
    return res.status(500).json({ error: 'CHAT_FAIL', message: String(e && e.message || e) })
  }
})

// 에러 핸들러(마지막)
app.use((err, _req, res, _next) => {
  console.error('[UNCAUGHT]', err && err.stack ? err.stack : err)
  res.status(500).json({ error: 'INTERNAL', message: String(err && err.message || err) })
})

const PORT = 3000
app.listen(PORT, () => {
  console.log(`API server on http://localhost:${PORT}`)
  console.log('DATA_FILE:', path.resolve(__dirname, '../_data/vehicles.json'))
  console.log('WEIGHT_FILE:', path.resolve(__dirname, '../_data/weights.json'))
})
