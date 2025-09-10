// back/services/intent_llm.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음
const { askJSON } = require('./llm_gemma')

// 간단 동의어/토큰 매핑
const MAP = {
  fuel: {
    '가스': 'lpg','lpg': 'lpg','엘피지': 'lpg',
    '디젤': 'diesel','diesel': 'diesel',
    '가솔린': 'gasoline','휘발유': 'gasoline','gasoline': 'gasoline','petrol': 'gasoline',
    '하이브리드': 'hybrid','hybrid': 'hybrid','hev': 'hybrid',
    '전기': 'ev','ev': 'ev','electric': 'ev'
  },
  body: {
    '밴': 'van','van': 'van','승합': 'van',
    'suv': 'suv',
    '세단': 'sedan','sedan': 'sedan',
    '트럭': 'truck','truck': 'truck',
    '해치': 'hatch','해치백': 'hatch','hatch': 'hatch',
    '왜건': 'wagon','wagon': 'wagon',
    '쿠페': 'coupe','coupe': 'coupe'
  },
  usage: {
    '비포장': 'offroad','오프로드': 'offroad',
    '가족': 'family','짐': 'cargo','적재': 'cargo','트렁크': 'cargo',
    '출퇴근': 'commute','장거리': 'long_trip','도심': 'city'
  },
  priority: {
    '저렴': 'price','가성비': 'price',
    '연비': 'fuel_efficiency','효율': 'fuel_efficiency',
    '안전': 'safety','정비': 'maintenance','정숙': 'comfort',
    '적재': 'cargo_space','트렁크': 'cargo_space'
  }
}

function norm(map, s) {
  const k = String(s || '').toLowerCase()
  return map[k] || s
}
function iint(x) { const n = parseInt(String(x), 10); return Number.isFinite(n) ? n : undefined }
function approxToRange(km) {
  if (!Number.isFinite(km)) return {}
  const tol = Math.max(2000, Math.round(km * 0.2))
  return { kmMin: Math.max(0, km - tol), kmMax: km + tol, kmApprox: km }
}

function buildPrompt(q) {
  return [
    '너는 중고차 구매 조건 파서다. 아래 한국어 문장을 읽고 JSON만 출력한다.',
    '규칙:',
    '- 예산은 만원 단위 정수 budget.max_man / budget.min_man.',
    '- 주행거리는 km 정수. "내외/정도/쯤"은 km.approx_km, 이하/이상은 max_km/min_km.',
    '- 연식은 years.min/years.max/years.exact 정수(연도).',
    '- 연료/차종/브랜드/모델/색상은 표준 토큰으로.',
    '- usage: offroad, family, cargo, commute, long_trip, city 등.',
    '- priority: price, fuel_efficiency, cargo_space, safety, maintenance, comfort 등.',
    '- 확실치 않으면 null 또는 빈배열.',
    '출력 스키마:',
    `{
      "budget": { "max_man": null, "min_man": null },
      "km": { "approx_km": null, "max_km": null, "min_km": null },
      "years": { "min": null, "max": null, "exact": null },
      "fuel_types": [],
      "body_types": [],
      "brands": [],
      "models": [],
      "colors": [],
      "usage": [],
      "priority": [],
      "notes": []
    }`,
    `문장: ${q}`,
    '반드시 유효한 JSON만 출력한다.'
  ].join('\n')
}

async function extractIntentViaLLM(q) {
  const data = await askJSON(buildPrompt(q), { temperature: 0.1 })

  const b = data?.budget || {}
  const m = data?.km || {}
  const y = data?.years || {}

  const fuel_types = (data?.fuel_types || []).map(s => norm(MAP.fuel, s)).filter(Boolean)
  const body_types = (data?.body_types || []).map(s => norm(MAP.body, s)).filter(Boolean)
  const usage = (data?.usage || []).map(s => norm(MAP.usage, s)).filter(Boolean)
  const priority = (data?.priority || []).map(s => norm(MAP.priority, s)).filter(Boolean)

  let kmMin, kmMax, kmApprox
  if (Number.isFinite(m?.approx_km)) {
    const r = approxToRange(m.approx_km)
    kmMin = r.kmMin
    kmMax = r.kmMax
    kmApprox = r.kmApprox
  } else {
    kmMin = iint(m?.min_km)
    kmMax = iint(m?.max_km)
  }

  const intent = {
    kind: 'buy',
    budgetMin: iint(b?.min_man),
    budgetMax: iint(b?.max_man),
    kmMin,
    kmMax,
    kmApprox,
    yearMin: iint(y?.min),
    yearMax: iint(y?.max),
    yearExact: iint(y?.exact),
    fuelType: fuel_types[0],
    bodyType: body_types[0],
    make: Array.isArray(data?.brands) && data.brands[0] ? data.brands[0] : undefined,
    model: Array.isArray(data?.models) && data.models[0] ? data.models[0] : undefined,
    colors: Array.isArray(data?.colors) ? data.colors.filter(Boolean) : [],
    usage,
    priority,
    _source: 'llm'
  }
  return intent
}

module.exports = { extractIntentViaLLM }
