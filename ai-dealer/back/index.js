// NOTE: 코드 주석에 이모티콘은 사용하지 않음
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import chatRoutes from './routes/chat.js'

dotenv.config()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(morgan('dev'))

// 라우트
app.use('/api', chatRoutes())

// 헬스체크
app.get('/api/health', (_req, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`[back] listening on http://localhost:${PORT}`)
})
