// back/lib/cloud_adapter.js
// 목적: 로컬 LLM(Gemma3)으로부터 JSON 파라미터를 받아
//       기존 NLU 스키마(intent, filters)로 변환하는 어댑터.
// 의존: services/llm_gemma.js (askJSON)

const { askJSON } = require('../services/llm_gemma');

// 내부 표준 스키마 설명
// intent: {
//   isVehicleQuery: boolean,
//   confidence: number,
//   budget: { minKman?: number, maxKman?: number } | null,
//   km: { minKm?: number, maxKm?: number } | null,
//   years: { min?: number, max?: number } | null,
//   fuelTypes?: string[],
//   bodyTypes?: string[],
//   segments?: string[],
//   transmission?: string[],
//   colors?: string[],
//   brands?: string[],
//   models?: string[],
//   textTags?: string[],
//   summary: string
// }

function buildPrompt(q) {
  return [
    '너는 중고차 질의 정규화 도우미이다.',
    '사용자의 한국어 질문을 분석하여 아래 JSON 스키마로만 응답하라.',
    '규칙:',
    '- 예산은 "만원" 단위 정수 범위로 표현한다. 예: 2천만원 → maxKman=2000. "내외"면 근사 범위로 10% 폭을 둔다.',
    '- 주행거리는 km 정수로 환산한다. "만"=10000, "천"=1000. 범위를 인지하면 minKm/maxKm로 표현.',
    '- 연식은 연도 정수 범위(min/max)로, "15년식"=2015로 환산.',
    '- 연료/차종/세그먼트/변속기/색상/브랜드/모델은 배열로.',
    '- 알 수 없으면 null 또는 빈 배열로 둔다.',
    '출력 JSON 스키마:',
    `{
      "normalized_query": "string",
      "intent": {
        "isVehicleQuery": true,
        "confidence": 0.0
      },
      "filters": {
        "budget": { "minKman": null|number, "maxKman": null|number },
        "km": { "minKm": null|number, "maxKm": null|number },
        "years": { "min": null|number, "max": null|number },
        "fuelTypes": string[]|[],
        "bodyTypes": string[]|[],
        "segments": string[]|[],
        "transmission": string[]|[],
        "colors": string[]|[],
        "brands": string[]|[],
        "models": string[]|[],
        "notes": string[]|[]
      }
    }`,
    '반드시 유효한 JSON만 출력하라.',
    `사용자질문: ${q}`
  ].join('\n');
}

function mapToLocalSchema(gOut) {
  const f = gOut?.filters || {};
  const intent = {
    isVehicleQuery: !!gOut?.intent?.isVehicleQuery,
    confidence: Number(gOut?.intent?.confidence ?? 0),
    budget: f.budget ?? null,
    km: f.km ?? null,
    years: f.years ?? null,
    fuelTypes: Array.isArray(f.fuelTypes) ? f.fuelTypes : [],
    bodyTypes: Array.isArray(f.bodyTypes) ? f.bodyTypes : [],
    segments: Array.isArray(f.segments) ? f.segments : [],
    transmission: Array.isArray(f.transmission) ? f.transmission : [],
    colors: Array.isArray(f.colors) ? f.colors : [],
    brands: Array.isArray(f.brands) ? f.brands : [],
    models: Array.isArray(f.models) ? f.models : [],
    textTags: Array.isArray(f.notes) ? f.notes : [],
    summary: gOut?.normalized_query || ''
  };

  // 예산 단위 안전화: 음수/NaN 방지
  if (intent.budget) {
    ['minKman', 'maxKman'].forEach(k => {
      if (intent.budget[k] != null) {
        const v = parseInt(intent.budget[k], 10);
        intent.budget[k] = Number.isFinite(v) && v > 0 ? v : null;
      }
    });
  }
  // 주행 단위 안전화
  if (intent.km) {
    ['minKm', 'maxKm'].forEach(k => {
      if (intent.km[k] != null) {
        const v = parseInt(intent.km[k], 10);
        intent.km[k] = Number.isFinite(v) && v >= 0 ? v : null;
      }
    });
  }
  // 연식 범위 안전화
  if (intent.years) {
    ['min', 'max'].forEach(k => {
      if (intent.years[k] != null) {
        const v = parseInt(intent.years[k], 10);
        intent.years[k] = Number.isFinite(v) && v > 1900 ? v : null;
      }
    });
  }

  return intent;
}

async function getCloudIntent(q, opts = {}) {
  const gOut = await askJSON(buildPrompt(q), { temperature: 0.1, ...opts });
  const intent = mapToLocalSchema(gOut);
  return { intent, raw: gOut };
}

module.exports = { getCloudIntent };
