// back/server/infer.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음

const fs = require('fs')
const path = require('path')

// 룰 기반 NLU/검색 파이프라인
const { parseIntent } = require('../lib/nlu')
const { ruleFilter, filterWithRelaxation, rankVehicles } = require('../lib/search')

// 경로
const DATA_DIR = path.resolve(__dirname, '../_data')
const VEHICLE_FILE = path.join(DATA_DIR, 'merge-vehicles.json')
const WEIGHT_FILE = path.join(DATA_DIR, 'weights.json')

// 안전 로드
function safeReadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    console.error('[infer] JSON read fail:', file, e.message)
    return null
  }
}

// 어떤 구조로 와도 배열로 변환
function coerceVehicles(v) {
  if (!v) return []
  if (Array.isArray(v)) return v
  if (Array.isArray(v.list)) return v.list
  if (Array.isArray(v.vehicles)) return v.vehicles
  if (Array.isArray(v.data)) return v.data // API 응답 래퍼(data 배열)
  if (typeof v === 'object') {
    const keys = Object.keys(v)
    const looksWrapper = ['statusCode', 'responseMessage', 'data'].every(k => keys.includes(k))
    if (looksWrapper) return Array.isArray(v.data) ? v.data : []
  }
  return []
}

// 문자열→정수
function intOrNull(x) {
  if (x == null) return null
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string' && /^\d+$/.test(x)) return parseInt(x, 10)
  return null
}

// 불리언 문자열 처리(무사고 등)
function boolFromString(x) {
  if (typeof x === 'boolean') return x
  const s = String(x || '').trim()
  if (!s) return null
  if (/^(true|yes|y|1|무사고)$/i.test(s)) return true
  if (/^(false|no|n|0|사고)$/i.test(s)) return false
  return null
}

// 연료 매핑
function mapFuel(x) {
  const s = String(x || '').toLowerCase().trim()
  if (!s) return undefined
  if (/diesel|디젤/.test(s)) return 'diesel'
  if (/gasoline|휘발유|가솔린|petrol/.test(s)) return 'gasoline'
  if (/hybrid|하이브리드|hev/.test(s)) return 'hybrid'
  if (/(^|[^a-z])ev([^a-z]|$)|전기|electric/.test(s)) return 'ev'
  if (/lpg|엘피지/.test(s)) return 'lpg'
  if (/가솔린\+전기/.test(s)) return 'hybrid'
  return s
}

// 차종 매핑
function mapBody(x) {
  const s = String(x || '').toLowerCase()
  if (/suv/.test(s)) return 'suv'
  if (/세단|sedan/.test(s)) return 'sedan'
  if (/해치|hatch|해치백/.test(s)) return 'hatch'
  if (/밴|승합|van/.test(s)) return 'van'
  if (/트럭|truck/.test(s)) return 'truck'
  if (/왜건|wagon/.test(s)) return 'wagon'
  if (/쿠페|coupe/.test(s)) return 'coupe'
  return undefined
}

// 색상 매핑(간단 그룹)
function mapColor(x) {
  const s = String(x || '').toLowerCase()
  if (/검정|블랙|까만/.test(s)) return 'black'
  if (/흰|화이트|하양/.test(s)) return 'white'
  if (/은색|실버/.test(s)) return 'silver'
  if (/회색|그레이|쥐색/.test(s)) return 'gray'
  if (/파랑|블루/.test(s)) return 'blue'
  if (/빨강|레드/.test(s)) return 'red'
  if (/초록|그린/.test(s)) return 'green'
  if (/갈색|브라운/.test(s)) return 'brown'
  if (/골드|금색/.test(s)) return 'gold'
  if (/노랑|옐로/.test(s)) return 'yellow'
  if (/주황|오렌지/.test(s)) return 'orange'
  if (/보라|퍼플/.test(s)) return 'purple'
  return undefined
}

// carName 기반 make/model 추정
function deriveMakeModel(carName) {
  if (!carName) return {}
  const s = String(carName).trim()
  const parts = s.split(/\s+/)
  if (!parts.length) return {}
  let make = parts[0]
  let model = parts.slice(1).join(' ')
  return { make, model: model || undefined }
}

// carName으로 bodyType 추정(없을 때만)
function inferBodyFromName(name) {
  const t = String(name || '')
  if (/스포티지|투싼|쏘렌토|싼타페|셀토스|qm6|니로|코란도/i.test(t)) return 'suv'
  if (/포터|봉고|마이티|라보/i.test(t)) return 'truck'
  if (/그랜저|쏘나타|k5|아반떼|sm5|sm6|말리부|임팔라|토러스/i.test(t)) return 'sedan'
  return undefined
}

// 필드 정규화
function normalize(v) {
  const out = { ...v }

  // make/model 보정
  if (!out.make || !out.model) {
    const mm = deriveMakeModel(out.carName)
    out.make = out.make || mm.make
    out.model = out.model || mm.model
  }

  // 연식: year/ yyyy / yymm에서 보정
  out.year = out.year ?? out.yyyy ?? null
  if (typeof out.year === 'string' && /^\d+$/.test(out.year)) out.year = parseInt(out.year, 10)
  if (out.year == null && typeof out.yymm === 'string') {
    const m = out.yymm.match(/(20\d{2}|19\d{2})\s*년/)
    if (m) {
      const y = parseInt(m[1], 10)
      if (Number.isFinite(y)) out.year = y
    }
    const mh = out.yymm.match(/\((\d{2}|\d{4})년형\)/)
    if (mh) {
      const yy = mh[1].length === 2 ? (parseInt(mh[1], 10) < 30 ? 2000 + parseInt(mh[1], 10) : 1900 + parseInt(mh[1], 10)) : parseInt(mh[1], 10)
      if (Number.isFinite(yy)) out.year = out.year || yy
    }
  }

  // 주행거리: km -> km
  if (typeof out.km !== 'number') {
    const km = intOrNull(out.km) ?? intOrNull(out.odometer)
    if (km != null) out.km = km
  }

  // 가격: demoAmt(만원) 또는 price(원→만원 환산)
  if (out.price == null) {
    const p = intOrNull(out.demoAmt) ?? intOrNull(out.priceWon)
    if (p != null) out.price = p
  }
  if (typeof out.price === 'number' && out.price > 100000) {
    // 원 단위였던 경우
    out.price = Math.round(out.price / 10000)
  }

  // 월부담
  if (out.monthlyPrice == null) {
    const mp = intOrNull(out.monthlyDemoAmt)
    if (mp != null) out.monthlyPrice = mp
  }

  // 연료
  out.fuelType = out.fuelType || out.fuel || out.carGas || undefined
  out.fuelType = mapFuel(out.fuelType)

  // 차종
  out.bodyType = out.bodyType || out.body || out.type || undefined
  out.bodyType = mapBody(out.bodyType) || inferBodyFromName(out.carName)

  // 색상
  out.color = out.color || out.colorCode || undefined
  out.color = mapColor(out.color) || out.color

  // 사고이력
  if (typeof out.noAccident !== 'boolean') out.noAccident = boolFromString(out.noAccident)

  // id 보정
  if (!out.id) {
    out.id =
      out.carNo ||
      out.demoNo ||
      `${out.make || 'NA'}-${out.model || 'NA'}-${out.year || 'NA'}-${Math.random().toString(36).slice(2, 8)}`
  }

  return out
}

// 데이터 로드
let _vehiclesCache = null
let _weights = null
function getVehicles() {
  if (_vehiclesCache) return _vehiclesCache
  const raw = safeReadJSON(VEHICLE_FILE)
  const arr = coerceVehicles(raw).map(normalize).filter(Boolean)
  _vehiclesCache = arr
  console.log(`[infer] vehicles loaded: ${arr.length} items`)
  return _vehiclesCache
}
function getWeights() {
  if (_weights) return _weights
  _weights = safeReadJSON(WEIGHT_FILE) || {}
  return _weights
}

// 재고 기반 동적 카탈로그 구성
function buildCatalog(list) {
  const makes = new Set()
  const models = new Set()
  const brandByModel = Object.create(null)
  for (const v of list) {
    const mk = v.make || (v.carName ? String(v.carName).split(/\s+/)[0] : '')
    const md = v.model || (v.carName ? String(v.carName).split(/\s+/).slice(1).join(' ') : '')
    if (mk) makes.add(mk)
    if (md) {
      models.add(md)
      if (mk && !brandByModel[md]) brandByModel[md] = mk
    }
  }
  return {
    makes: Array.from(makes),
    models: Array.from(models),
    brandByModel,
  }
}

// 추천: NLU → 하드필터(+완화) → 랭킹
function recommend(q, limit = 10) {
  const list = getVehicles()
  const catalog = buildCatalog(list)

  // 1) 의도 파싱
  const intent0 = parseIntent(q, catalog)

  // 2) 하드 필터 + 조건 완화(연료/차종/예산/주행/연식 등 단계적)
  const { candidates, usedIntent, relaxed } = filterWithRelaxation(list, intent0)

  // 3) 랭킹: TF-IDF 문서유사 + 의도정합 + 예산/주행/연식 근접도 + 제조사 다양성
  const ranked = rankVehicles(candidates, usedIntent, q, getWeights())

  // 4) 상위 반환
  return { items: ranked.slice(0, limit), intent: usedIntent, relaxed }
}

module.exports = { recommend }
