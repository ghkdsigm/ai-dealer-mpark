// back/index.js
// 전체 교체본 (로컬 JSON 목업 파일 기반 + 어댑터/추천/대화까지 포함, 생략 없음)
const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

/** ================================
 *  1) 앱 생성 + 미들웨어
 * ================================= */
const app = express()
app.use(cors())
app.use(express.json())

/** ================================
 *  2) 데이터 소스 설정 (로컬 JSON 파일)
 *     - 기본 경로: 프로젝트 루트의 _data/vehicles.json
 *     - 환경변수 DATA_FILE 로 변경 가능
 * ================================= */
const DATA_FILE = process.env.DATA_FILE || path.resolve(process.cwd(), '_data/vehicles.json')

/** ================================
 *  3) 유틸: 파일에서 JSON/NDJSON 읽기
 *     - 배열 또는 { data: [...] } / { items: [...] } 모두 지원
 * ================================= */
function readFlexibleJson(filePath) {
	if (!fs.existsSync(filePath)) {
		console.warn(`[warn] 데이터 파일이 없습니다: ${filePath}`)
		return []
	}
	const raw = fs.readFileSync(filePath, 'utf-8').trim()
	if (!raw) return []
	// NDJSON 감지(여러 줄 JSON 객체) → 라인별 파싱
	const looksLikeNdjson = !raw.startsWith('[') && raw.includes('\n') && raw.includes('{')
	if (looksLikeNdjson) {
		return raw
			.split('\n')
			.map(l => l.trim())
			.filter(Boolean)
			.map(l => JSON.parse(l))
	}
	// 일반 JSON
	const parsed = JSON.parse(raw)
	if (Array.isArray(parsed)) return parsed
	if (parsed && Array.isArray(parsed.data)) return parsed.data
	if (parsed && Array.isArray(parsed.items)) return parsed.items
	return []
}

/** ================================
 *  4) (백업) inline rawData (파일 없을 때만 사용)
 *     - 최소한의 샘플
 * ================================= */
const fallbackRawData = [
	{
		demoNo: '2031001542',
		demoDay: '20250522',
		carNo: '08거2212',
		carName: '아우디 A8(2세대) 3.2 FSI 콰트로',
		carGas: '가솔린',
		carOption: null,
		color: null,
		colorCode: null,
		demoAmt: '280',
		fuel: null,
		gear: null,
		km: 127318,
		mileage: null,
		monthlyDemoAmt: '6',
		noAccident: 'false',
		price: null,
		shortKm: 'false',
		type: null,
		year: null,
		yymm: '06년08월(06년형)',
		yyyy: '2006',
	},
]

/** ================================
 *  5) 어댑터/정규화 유틸
 *     - 공급 데이터 → 내부 공통 스키마
 * ================================= */
const GAS_MAP = {
	가솔린: 'gasoline',
	디젤: 'diesel',
	하이브리드: 'hybrid',
	'가솔린+전기': 'hybrid',
	전기: 'ev',
	LPG: 'lpg',
}

const BODYTYPE_KEYWORDS = [
	{
		re: /(스포티지|투싼|쏘렌토|싼타페|카니발|펠리세이드|모하비|QM6|XM3|콜로라도|GV70|GV80|스포티지R|니로|SUV|픽업|밴)/i,
		type: 'suv',
	},
	{ re: /(아반떼|쏘나타|그랜저|K3|K5|K7|K8|SM5|SM6|SM7|제네시스(?!쿠페)|세단)/i, type: 'sedan' },
	{ re: /(모닝|레이|스파크|프라이드|i30|크루즈5|해치|해치백|클리오)/i, type: 'hatch' },
	{ re: /(GV60|EV6|아이오닉|폴스타|테슬라|코나 일렉트릭)/i, type: 'cuv' }, // 편의상
	{ re: /(포터|봉고|마이티|라보|트럭|2\.5톤|3\.5톤|카고)/i, type: 'truck' },
	{ re: /(스타렉스|스타리아|카니발|승합|버스)/i, type: 'van' },
]

function inferBodyType(carName, fallbackType) {
	if (fallbackType) return String(fallbackType).toLowerCase()
	if (!carName) return undefined
	for (const rule of BODYTYPE_KEYWORDS) {
		if (rule.re.test(carName)) return rule.type
	}
	return undefined
}

function splitMakeModel(carName = '') {
	// 예: "현대 제네시스DH G330 모던" → make: "현대", model: "제네시스DH G330 모던"
	const parts = carName.trim().split(/\s+/)
	if (parts.length <= 1) return { make: parts[0] || '', model: '' }
	return { make: parts[0], model: parts.slice(1).join(' ') }
}

function toIntOrNull(v) {
	if (v === null || v === undefined) return null
	const n = Number(String(v).replace(/[^\d.-]/g, ''))
	return Number.isFinite(n) ? n : null
}

function toBool(v) {
	if (typeof v === 'boolean') return v
	if (typeof v === 'string') return v.toLowerCase() === 'true'
	return Boolean(v)
}

function normalizeFuel(kor) {
	if (!kor) return undefined
	return GAS_MAP[kor] || undefined
}

/**
 * raw → normalized vehicle
 * 내부 기준 필드:
 *  id, make, model, year, yymm, bodyType, fuelType, mileage(km),
 *  price(만원), monthlyPrice(만원), noAccident, demoNo, carNo, carName
 */
function adaptRecord(r) {
	const { make, model } = splitMakeModel(r.carName || '')
	const price = toIntOrNull(r.demoAmt) // 만원
	const monthlyPrice = toIntOrNull(r.monthlyDemoAmt) // 만원
	const year = toIntOrNull(r.yyyy) || undefined
	const mileage = toIntOrNull(r.km) || 0

	return {
		id: r.demoNo || r.carNo || `${Math.random()}`.slice(2),
		demoNo: r.demoNo,
		carNo: r.carNo,
		carName: r.carName,
		make,
		model,
		year,
		yymm: r.yymm || undefined,
		bodyType: inferBodyType(r.carName, r.type),
		fuelType: normalizeFuel(r.carGas),
		mileage,
		price, // 만원 단위
		monthlyPrice, // 만원 단위
		noAccident: toBool(r.noAccident),
		raw: r, // 원본 보관(디버깅용)
	}
}

/** ================================
 *  6) 스냅샷(메모리) 구성 + 초기 로드/감시
 * ================================= */
let snapshot = {
	version: 0,
	updatedAt: null,
	list: [],
}

function rebuildSnapshotFromArray(arr) {
	const adapted = arr.map(adaptRecord)
	snapshot = {
		version: snapshot.version + 1,
		updatedAt: new Date().toISOString(),
		list: adapted,
	}
	console.log(`[inv] 스냅샷 갱신 v${snapshot.version} / ${snapshot.list.length}대`)
}

function initialLoad() {
	const rows = readFlexibleJson(DATA_FILE)
	if (rows && rows.length) {
		rebuildSnapshotFromArray(rows)
	} else {
		console.warn('[warn] 파일에서 로드된 데이터가 없어 fallbackRawData 사용')
		rebuildSnapshotFromArray(fallbackRawData)
	}
}

// 최초 로드
initialLoad()

// 개발 편의: 파일 변경 시 자동 재로딩
try {
	const dir = path.dirname(DATA_FILE)
	if (fs.existsSync(dir)) {
		fs.watch(dir, { recursive: false }, (evt, fname) => {
			const changed = fname && path.resolve(dir, fname) === DATA_FILE
			if (changed || fname === path.basename(DATA_FILE)) {
				try {
					console.log('[inv] 파일 변경 감지 → 재로딩')
					const rows = readFlexibleJson(DATA_FILE)
					if (rows && rows.length) rebuildSnapshotFromArray(rows)
				} catch (e) {
					console.warn('[warn] 파일 재로딩 실패:', e.message)
				}
			}
		})
	}
} catch (e) {
	console.warn('[warn] 파일 감시 미지원:', e.message)
}

/** ================================
 *  7) NLU 파서 (한글 스키마 보강)
 * ================================= */
function parseIntent(text = '') {
	const t = text.toLowerCase()

	// 예산: "2천", "1500만원", "1,800 만 원" 등
	let budgetMax
	const wonMatch = t.match(/(\d{3,4})\s*만\s*원?/) // 1200만원, 1800만원
	if (wonMatch) budgetMax = Number(wonMatch[1])

	if (/(1천|1000|천)/.test(t)) budgetMax = Math.min(budgetMax ?? 1000, 1000)
	if (/(2천|2000)/.test(t)) budgetMax = Math.min(budgetMax ?? 2000, 2000)
	if (/(3천|3000)/.test(t)) budgetMax = Math.min(budgetMax ?? 3000, 3000)

	// 월예산: "월 30만원", "월 25"
	let monthlyMax
	const monthlyMatch = t.match(/월\s*(\d{1,3})\s*만\s*원?/)
	if (monthlyMatch) monthlyMax = Number(monthlyMatch[1])

	const bodyType = /(suv|에스유브이|스포티지|투싼|쏘렌토|싼타페|카니발|qm6|gv70|gv80)/.test(t)
		? 'suv'
		: /(세단|아반떼|k3|쏘나타|k5|그랜저|제네시스(?!쿠페))/.test(t)
		? 'sedan'
		: /(해치|모닝|스파크|레이|해치백)/.test(t)
		? 'hatch'
		: undefined

	const fuelType = /디젤/.test(t)
		? 'diesel'
		: /(하이브리드|hev|가솔린\+전기)/.test(t)
		? 'hybrid'
		: /(전기|ev|일렉)/.test(t)
		? 'ev'
		: /(가솔|휘발|가솔린)/.test(t)
		? 'gasoline'
		: /(lpg)/.test(t)
		? 'lpg'
		: undefined

	const wantEconomy = /(연비|유지비|기름)/.test(t)
	const preferLowKm = /(주행거리|적은\s*km|짧은\s*키로|짧은\s*주행)/.test(t)

	return {
		bodyType,
		fuelType,
		budgetMax, // 만원
		monthlyMax, // 만원
		wantEconomy, // 연비/유지비 중시 → 여기서는 '적은 km'를 surrogate로 사용
		preferLowKm,
	}
}

/** ================================
 *  8) 검색/정렬 로직: 실데이터 기준
 * ================================= */
function searchInventoryByIntent(intent) {
	let list = snapshot.list.slice()

	if (intent.bodyType) list = list.filter(v => v.bodyType === intent.bodyType)
	if (intent.fuelType) list = list.filter(v => v.fuelType === intent.fuelType)
	if (intent.budgetMax) list = list.filter(v => v.price != null && v.price <= intent.budgetMax)
	if (intent.monthlyMax) list = list.filter(v => v.monthlyPrice != null && v.monthlyPrice <= intent.monthlyMax)

	// 정렬: 연비/유지비 수치가 없으므로 "주행거리 적음"을 대용치로 사용
	if (intent.wantEconomy || intent.preferLowKm) {
		list.sort((a, b) => (a.mileage ?? Infinity) - (b.mileage ?? Infinity))
	} else {
		// 기본은 가격 오름차순(없는 값은 뒤로)
		list.sort((a, b) => {
			const ap = a.price ?? Infinity
			const bp = b.price ?? Infinity
			return ap - bp
		})
	}

	return list
}

/** ================================
 *  9) 상태/메타 확인용
 * ================================= */
app.get('/api/inventory/meta', (req, res) => {
	res.json({
		source: path.relative(process.cwd(), DATA_FILE),
		version: snapshot.version,
		updatedAt: snapshot.updatedAt,
		count: snapshot.list.length,
	})
})

/** ================================
 *  10) 간단 추천 (프록시/테스트용) - query 한 줄 입력
 * ================================= */
app.post('/api/recommend', (req, res) => {
	const q = (req.body?.query || '').toLowerCase()
	const intent = parseIntent(q)
	const list = searchInventoryByIntent(intent)
	res.json({ items: list.slice(0, 5) })
})

/** ================================
 *  11) 대화형(룰 기반 NLU) - message 문장형 입력
 * ================================= */
app.post('/api/chat', (req, res) => {
	const msg = req.body?.message || ''
	const intent = parseIntent(msg)
	let list = searchInventoryByIntent(intent)

	let reply
	if (list.length > 0) {
		const top = list[0]
		const budgetTag = intent.budgetMax
			? `예산(≤${intent.budgetMax}만원)`
			: intent.monthlyMax
			? `월예산(≤${intent.monthlyMax}만원)`
			: ''
		const tags = [
			budgetTag,
			intent.bodyType ? `차종:${intent.bodyType.toUpperCase()}` : '',
			intent.fuelType ? `연료:${intent.fuelType}` : '',
			intent.wantEconomy || intent.preferLowKm ? '주행거리 우선' : '',
		]
			.filter(Boolean)
			.join(' · ')

		reply = `요청 조건으로 골라봤어요. ${top.year ?? ''} ${top.make} ${top.model}${
			tags ? ` (${tags})` : ''
		}가 조건에 잘 맞아요.`
	} else {
		// 완화 제안: 차종만 유지하고 가격/주행거리 조건 완화
		const relaxed = snapshot.list
			.filter(v => (intent.bodyType ? v.bodyType === intent.bodyType : true))
			.sort((a, b) => {
				const ap = a.price ?? Infinity
				const bp = b.price ?? Infinity
				return ap - bp
			})
			.slice(0, 3)

		list = relaxed
		reply = `정확히 일치하는 매물은 없어 조건을 조금 완화해 비슷한 차량을 추천드려요. 관심 등록해 주시면 입고 시 바로 알려드릴게요.`
	}

	res.json({ reply, items: list.slice(0, 5), intent, version: snapshot.version })
})

/** ================================
 *  12) (선택) 수동 리로드 엔드포인트 (개발 편의)
 *      - Postman에서 파일 갱신 후 /api/reload 호출하면 즉시 반영
 * ================================= */
app.post('/api/reload', (req, res) => {
	try {
		const rows = readFlexibleJson(DATA_FILE)
		if (rows && rows.length) {
			rebuildSnapshotFromArray(rows)
			return res.json({ ok: true, version: snapshot.version, count: snapshot.list.length })
		}
		return res.status(400).json({ ok: false, error: '파일에 데이터가 없습니다.' })
	} catch (e) {
		return res.status(500).json({ ok: false, error: e.message })
	}
})

/** ================================
 *  13) 서버 시작
 * ================================= */
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
	console.log(`API server on http://localhost:${PORT}`)
	console.log(`데이터 파일: ${DATA_FILE}`)
})
