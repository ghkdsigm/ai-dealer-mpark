// back/index.js
// 서버 부팅: 스냅샷 로드/감시 + 라우트 장착(추천/대화/파인튜닝)

const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const cfg = require('./config') // { PORT, DATA_FILE, WEIGHT_FILE, CORS_ORIGIN 등 }
const { readFlexibleJson, buildSnapshotFromArray, watchFile } = require('./services/snapshot')
const buildChatRoutes = require('./routes/chat') // export default function ({ getSnapshot, getWeights }) => Router
const fineTuneRoutes = require('./routes/finetune') // export Router
const { DEFAULT_W } = require('./lib/search')

// -------------------------------------------------------------
// 랭킹 가중치 로드/저장 영역 (파인튜닝 결과물과는 별개로 동작)
// -------------------------------------------------------------
let W = { ...DEFAULT_W }

function loadWeights() {
	try {
		if (fs.existsSync(cfg.WEIGHT_FILE)) {
			const j = JSON.parse(fs.readFileSync(cfg.WEIGHT_FILE, 'utf-8'))
			// train.js 출력 스키마(labelSpace, heads 등)를 그대로 보관
			W = j
			console.log('[weights] loaded from', cfg.WEIGHT_FILE)
		} else {
			console.log('[weights] file not found, using DEFAULT_W')
		}
	} catch (e) {
		console.warn('[weights] load fail:', e.message)
	}
}

function getWeights() {
	return W
}

// -------------------------------------------------------------
// 인벤토리 스냅샷 영역
// -------------------------------------------------------------
let snapshot = { version: 0, updatedAt: null, list: [] }

function rebuildSnapshot() {
	try {
		const rows = readFlexibleJson(cfg.DATA_FILE)
		snapshot = buildSnapshotFromArray(rows.length ? rows : [])
		console.log(`[inv] v${snapshot.version} / ${snapshot.list.length} rows`)
	} catch (e) {
		console.error('[inv] rebuild fail:', e.message)
		snapshot = { version: 0, updatedAt: null, list: [] }
	}
}

function getSnapshot() {
	return snapshot
}

// 초기 로드
rebuildSnapshot()
loadWeights()

// 데이터 파일 변경 감시(개발 편의용)
watchFile(cfg.DATA_FILE, rebuildSnapshot)

// -------------------------------------------------------------
// Express 앱 구성
// -------------------------------------------------------------
const app = express()

// CORS
app.use(cors(cfg.CORS_ORIGIN ? { origin: cfg.CORS_ORIGIN, credentials: true } : undefined))

// 바디 파서
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

// 헬스 체크
app.get('/api/health', (_req, res) => {
	res.json({ ok: true })
})

// 인벤토리 메타 정보
app.get('/api/inventory/meta', (_req, res) => {
	const s = getSnapshot()
	res.json({
		source: path.relative(process.cwd(), cfg.DATA_FILE),
		version: s.version,
		updatedAt: s.updatedAt,
		count: s.list.length,
	})
})

// 파인튜닝 라우트
// 예: POST /api/finetune/start, GET /api/finetune/status 등
app.use('/api', fineTuneRoutes)

// 추천/대화 라우트
// 예: POST /api/recommend, POST /api/chat 등
app.use('/api', buildChatRoutes({ getSnapshot, getWeights }))

// 404 핸들러
app.use((req, res, _next) => {
	res.status(404).json({
		error: 'Not Found',
		path: req.path,
	})
})

// 에러 핸들러
// 라우트 내부에서 throw 된 에러를 잡아 JSON 형태로 반환
app.use((err, _req, res, _next) => {
	console.error('[server] error:', err)
	res.status(err.status || 500).json({
		error: err.message || 'Internal Server Error',
	})
})

// -------------------------------------------------------------
// 서버 시작
// -------------------------------------------------------------
const PORT = Number(cfg.PORT) || 3000
const server = app.listen(PORT, () => {
	console.log(`API server on http://localhost:${PORT}`)
	console.log(`DATA_FILE: ${cfg.DATA_FILE}`)
	console.log(`WEIGHT_FILE: ${cfg.WEIGHT_FILE}`)
})

// 종료 시그널 처리
function gracefulShutdown(signal) {
	console.log(`[server] received ${signal}, closing...`)
	server.close(() => {
		console.log('[server] closed')
		process.exit(0)
	})
	// 타임아웃 강제 종료
	setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

// 테스트를 위해 앱을 export
module.exports = app
