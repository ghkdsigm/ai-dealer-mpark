// back/routes/chat.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음

const express = require('express')
const { parseIntent } = require('../lib/nlu') // 통합 NLU (로컬 규칙 파서)
const { ruleFilter, filterWithRelaxation } = require('../lib/search') // 필터/완화
const { rankVehicles } = require('../lib/search') // 랭킹
const { checklist } = require('../services/maintenance')
const { recommendFuel } = require('../services/rules')
const { chatAnswer } = require('../services/infer')
const { buildComps } = require('../services/valuation')
const { askJSON } = require('../services/llm_gemma')

// ------------------------------
// 유틸
// ------------------------------
function safeInt(x, min) {
  if (x === null || x === undefined) return undefined
  const n = parseInt(String(x), 10)
  if (!Number.isFinite(n)) return undefined
  if (typeof min === 'number' && n < min) return min
  return n
}

function arrOrEmpty(v) {
  return Array.isArray(v) ? v.filter(Boolean) : []
}

function pickFirst(arr) {
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined
}

function hasAnyConstraint(intent) {
  const KEYS = [
    'budgetMin',
    'budgetMax',
    'monthlyMin',
    'monthlyMax',
    'kmMin',
    'kmMax',
    'yearMin',
    'yearMax',
    'yearExact',
    'fuelType',
    'bodyType',
    'segment',
    'transmission',
    'make',
    'model',
    'colors',
    'noAccident',
  ]
  return KEYS.some(k => {
    const v = intent[k]
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''
  })
}

// 숫자 범위 안전 보정
function normalizeIntentRanges(intent) {
  const out = { ...intent }
  // 예산
  if (Number.isFinite(out.budgetMin) && Number.isFinite(out.budgetMax) && out.budgetMin > out.budgetMax) {
    const t = out.budgetMin
    out.budgetMin = out.budgetMax
    out.budgetMax = t
  }
  // 주행
  if (Number.isFinite(out.kmMin) && Number.isFinite(out.kmMax) && out.kmMin > out.kmMax) {
    const t = out.kmMin
    out.kmMin = out.kmMax
    out.kmMax = t
  }
  // 연식
  if (Number.isFinite(out.yearMin) && Number.isFinite(out.yearMax) && out.yearMin > out.yearMax) {
    const t = out.yearMin
    out.yearMin = out.yearMax
    out.yearMax = t
  }
  // 음수 제거
  if (Number.isFinite(out.kmMin) && out.kmMin < 0) out.kmMin = 0
  if (Number.isFinite(out.kmMax) && out.kmMax < 0) out.kmMax = 0
  if (Number.isFinite(out.budgetMin) && out.budgetMin < 0) out.budgetMin = 0
  if (Number.isFinite(out.budgetMax) && out.budgetMax < 0) out.budgetMax = 0
  return out
}

// ------------------------------
// LLM 보조 파서 (Ollama/Gemma/“라마”)
// ------------------------------
// Gemma3에 질의를 보내 JSON 파라미터를 얻고, 로컬 intent 스키마로 매핑한다.
// 주의: fuelType을 "단일값"으로 매핑해야 로컬 ruleFilter가 정상 동작한다.
async function callCloudFallback({ q }) {
  const prompt = [
    '너는 중고차 구매 상담 보조다. 사용자의 한국어 질문을 분석하여 아래 JSON만 출력한다.',
    '규칙:',
    '- 예산은 "만원" 단위 정수. 예: 2,200만원 -> 2200.',
    '- 주행거리는 km 정수. "만"=10000, "천"=1000.',
    '- 연식은 연도 정수 범위(min/max). "15년식"은 2015로 환산.',
    '- 연료/차종/세그먼트/변속기/브랜드/모델/색상은 배열.',
    '- 알 수 없으면 null 또는 빈 배열.',
    '출력 JSON 스키마:',
    `{
      "normalized_query": "string",
      "filters": {
        "budget": { "minKman": null|number, "maxKman": null|number },
        "km": { "minKm": null|number, "maxKm": null|number },
        "years": { "min": null|number, "max": null|number },
        "fuelTypes": string[]|[],
        "bodyTypes": string[]|[],
        "segments": string[]|[],
        "transmission": string[]|[],
        "brands": string[]|[],
        "models": string[]|[],
        "colors": string[]|[],
        "notes": string[]|[]
      }
    }`,
    '반드시 유효한 JSON만 출력한다.',
    `사용자질문: ${q}`
  ].join('\n')

  const data = await askJSON(prompt, { temperature: 0.1 })

  const f = data?.filters || {}
  const intentRaw = {
    kind: 'buy',
    budgetMin: safeInt(f?.budget?.minKman),
    budgetMax: safeInt(f?.budget?.maxKman),
    kmMin: safeInt(f?.km?.minKm, 0),
    kmMax: safeInt(f?.km?.maxKm),
    yearMin: safeInt(f?.years?.min),
    yearMax: safeInt(f?.years?.max),

    // 중요: 단일값으로 매핑해야 로컬 filter가 동작
    fuelType: pickFirst(arrOrEmpty(f?.fuelTypes)),
    bodyType: pickFirst(arrOrEmpty(f?.bodyTypes)),
    segment: pickFirst(arrOrEmpty(f?.segments)),
    transmission: pickFirst(arrOrEmpty(f?.transmission)),
    make: pickFirst(arrOrEmpty(f?.brands)),
    model: pickFirst(arrOrEmpty(f?.models)),

    colors: arrOrEmpty(f?.colors),
    notes: arrOrEmpty(f?.notes),
    normalizedQuery: typeof data?.normalized_query === 'string' ? data.normalized_query : ''
  }

  return { intent: normalizeIntentRanges(intentRaw), raw: data }
}

// ------------------------------
// 라우트
// ------------------------------
function buildChatRoutes(ctx) {
  const { getSnapshot, getWeights } = ctx
  const router = express.Router()

  router.get('/inventory/meta', (_req, res) => {
    const snap = getSnapshot()
    res.json({ version: snap.version, updatedAt: snap.updatedAt, count: snap.list.length })
  })

  // 자연어 추천 API (간단 엔드포인트)
  router.post('/recommend', async (req, res) => {
    const q = String(req.body?.query || '')
    const snap = getSnapshot()

    // 1) 로컬 파서
    const catalog = {
      makes: [...new Set(snap.list.map(v => v.make).filter(Boolean))],
      models: [...new Set(snap.list.map(v => v.model).filter(Boolean))],
    }
    let intent = normalizeIntentRanges(parseIntent(q, catalog))
    let { candidates, usedIntent, relaxed } = filterWithRelaxation(snap.list, intent)
    let ranked = rankVehicles(candidates, usedIntent, q, getWeights())
    let items = ranked.slice(0, 5)

    // 2) 로컬이 빈약/무결과면 LLM 보조 시도
    const needLLM =
      items.length === 0 ||
      !hasAnyConstraint(intent)

    if (needLLM) {
      try {
        const cloud = await callCloudFallback({ q })
        const r2 = filterWithRelaxation(snap.list, cloud.intent)
        const ranked2 = rankVehicles(r2.candidates, r2.usedIntent, q, getWeights())
        if (ranked2.length) {
          return res.json({
            items: ranked2.slice(0, 5),
            intent: r2.usedIntent,
            relaxed: r2.relaxed,
            route: 'cloud_intent_then_local_search',
            cloudRaw: cloud.raw
          })
        }
      } catch (e) {
        // LLM 실패는 무시하고 로컬 결과 그대로 반환
      }
    }

    return res.json({ items, intent: usedIntent, relaxed, route: 'local_intent' })
  })

  // 대화형 엔드포인트
  router.post('/chat', async (req, res) => {
    const raw = req.body?.message || ''
    const user = req.body?.user || {}

    const WAKE = /(ai\s*딜러|에이아이\s*딜러|딜러)\s*야/i
    const greeted = WAKE.test(raw)
    const msg = raw.replace(WAKE, '').trim()
    const greetText = '네 고객님, 차량을 구매하실건가요? 판매하실건가요?'

    const snap = getSnapshot()

    // 1) 로컬 파서
    const catalog = {
      makes: [...new Set(snap.list.map(v => v.make).filter(Boolean))],
      models: [...new Set(snap.list.map(v => v.model).filter(Boolean))],
    }
    const intentLocal = normalizeIntentRanges(parseIntent(msg, catalog))

    // 판매 플로우
    if (intentLocal.kind === 'sell') {
      const needName = !intentLocal.carName
      const needYear = !intentLocal.year
      const needKm = intentLocal.km == null
      if (needName || needYear || needKm) {
        const holes = []
        if (needName) holes.push('차명(예: 현대 제네시스DH G330 모던)')
        if (needYear) holes.push('연식(예: 2016년)')
        if (needKm) holes.push('주행거리(예: 12만 km)')
        let reply = `판매하실 차량 정보를 알려주세요.\n필요 정보: ${holes.join(', ')}`
        if (greeted) reply = `${greetText}\n${reply}`
        return res.json({ reply, items: [], intent: intentLocal })
      }

      const subject = {
        carName: intentLocal.carName,
        year: intentLocal.year,
        km: intentLocal.km,
        fuelType: intentLocal.fuelType,
        color: intentLocal.color,
      }
      const { comps, estimate } = buildComps(snap.list, subject)

      let reply = `입력하신 차량 기준 예상 매입가(만 원): ${estimate.low.toLocaleString()} ~ ${estimate.high.toLocaleString()} (중앙값 ${estimate.mid.toLocaleString()}).\n유사 매물 기준으로 산정했다. 실제 가격은 상태/사고/옵션에 따라 달라질 수 있다.`
      if (greeted) reply = `${greetText}\n${reply}`

      return res.json({ reply, items: comps.slice(0, 6), intent: intentLocal, estimate })
    }

    // 구매 플로우 판별
    const looksVehicle =
      /(차|차량|suv|세단|연비|예산|가격|원|만원|억|km|키로|주행|주행거리|연식|옵션|브랜드|모델|사고|무사고|lpg|디젤|가솔린|하이브리드|전기)/i.test(
        msg,
      )

    const hasConstraints = hasAnyConstraint(intentLocal)

    if (looksVehicle || intentLocal.kind === 'buy' || hasConstraints) {
      let fuelGuide = null
      if (user && (user.yearlyKm || user.monthlyKm)) fuelGuide = recommendFuel(user)

      // 1) 로컬 의도 기반 후보군
      let { candidates, usedIntent, relaxed } = filterWithRelaxation(snap.list, intentLocal)
      let ranked = rankVehicles(candidates, usedIntent, msg, getWeights())
      let items = ranked.slice(0, 5)

      // 2) 태그 표현
      const kmTag =
        typeof usedIntent.kmMin === 'number' && typeof usedIntent.kmMax === 'number'
          ? `주행 ${usedIntent.kmMin.toLocaleString()}~${usedIntent.kmMax.toLocaleString()}km`
          : typeof usedIntent.kmMin === 'number'
          ? `주행≥${usedIntent.kmMin.toLocaleString()}km`
          : typeof usedIntent.kmMax === 'number'
          ? `주행≤${usedIntent.kmMax.toLocaleString()}km`
          : ''

      // 3) 로컬 결과가 없거나 제약이 거의 없으면 LLM 보조 시도
      const needLLM =
        items.length === 0 ||
        !hasAnyConstraint(intentLocal)

      if (needLLM) {
        try {
          const cloud = await callCloudFallback({ q: msg })
          const r2 = filterWithRelaxation(snap.list, cloud.intent)
          const ranked2 = rankVehicles(r2.candidates, r2.usedIntent, msg, getWeights())
          const items2 = ranked2.slice(0, 5)

          if (items2.length > 0) {
            const tags2 = [
              typeof r2.usedIntent.budgetMax === 'number' ? `예산≤${r2.usedIntent.budgetMax}만원` : '',
              typeof r2.usedIntent.monthlyMax === 'number' ? `월≤${r2.usedIntent.monthlyMax}만원` : '',
              typeof r2.usedIntent.kmMin === 'number' && typeof r2.usedIntent.kmMax === 'number'
                ? `주행 ${r2.usedIntent.kmMin.toLocaleString()}~${r2.usedIntent.kmMax.toLocaleString()}km`
                : typeof r2.usedIntent.kmMin === 'number'
                ? `주행≥${r2.usedIntent.kmMin.toLocaleString()}km`
                : typeof r2.usedIntent.kmMax === 'number'
                ? `주행≤${r2.usedIntent.kmMax.toLocaleString()}km`
                : '',
              r2.usedIntent.bodyType ? `차종:${r2.usedIntent.bodyType}` : '',
              r2.usedIntent.segment ? `세그:${r2.usedIntent.segment}` : '',
              r2.usedIntent.fuelType ? `연료:${r2.usedIntent.fuelType}` : '',
              fuelGuide ? `주행패턴:${fuelGuide.join('/')}` : '',
            ]
              .filter(Boolean)
              .join(' · ')

            const relaxNote2 = r2.relaxed.length ? ` (일부 조건 완화: ${r2.relaxed.join(', ')})` : ''
            let reply2 = `요청을 반영해 골라봤다${relaxNote2}. ${items2[0].year ?? ''} ${items2[0].make} ${items2[0].model}${tags2 ? ` (${tags2})` : ''}가 조건에 잘 맞는다.`
            if (greeted) reply2 = `${greetText}\n${reply2}`

            return res.json({
              reply: reply2,
              items: items2,
              intent: r2.usedIntent,
              fuelGuide,
              relaxed: r2.relaxed,
              cloudRaw: cloud.raw,
              route: 'cloud_intent_then_local_search'
            })
          }
        } catch (e) {
          // LLM 보조 실패는 무시
        }
      }

      // 4) 로컬 결과 응답
      let reply
      if (items.length) {
        const top = items[0]
        const tags = [
          typeof usedIntent.budgetMax === 'number' ? `예산≤${usedIntent.budgetMax}만원` : '',
          typeof usedIntent.monthlyMax === 'number' ? `월≤${usedIntent.monthlyMax}만원` : '',
          kmTag,
          usedIntent.bodyType ? `차종:${usedIntent.bodyType}` : '',
          usedIntent.segment ? `세그:${usedIntent.segment}` : '',
          usedIntent.fuelType ? `연료:${usedIntent.fuelType}` : '',
          fuelGuide ? `주행패턴:${fuelGuide.join('/')}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
        const relaxNote = relaxed.length ? ` (일부 조건 완화: ${relaxed.join(', ')})` : ''
        reply = `요청을 반영해 골라봤다${relaxNote}. ${top.year ?? ''} ${top.make} ${top.model}${tags ? ` (${tags})` : ''}가 조건에 잘 맞는다.`
      } else {
        reply = `정확히 일치하는 매물은 없어 조건을 조금 완화해 다시 시도해 달라. 예: "중형 세단 8만km 이하"처럼 범위를 넓혀보자.`
      }
      if (greeted) reply = `${greetText}\n${reply}`
      return res.json({ reply, items, intent: usedIntent, fuelGuide, relaxed })
    }

    // 차량번호 점검
    const plateMatch = msg.match(/([0-9]{2,3}[가-힣][0-9]{4})/)
    if (plateMatch) {
      const carNo = plateMatch[1]
      const v = snap.list.find(x => x.carNo === carNo)
      if (!v) {
        let reply = '해당 차량번호를 찾지 못했다.'
        if (greeted) reply = `${greetText}\n${reply}`
        return res.json({ reply, items: [] })
      }
      const list = checklist({ year: v.year, km: v.km })
      let reply = `차량(${v.carName}) 점검 제안: ${list.join(' · ')}`
      if (greeted) reply = `${greetText}\n${reply}`
      return res.json({ reply, items: [v] })
    }

    // 일반 Q&A → (있으면) 클라우드/FT
    const messages = [
      { role: 'system', content: '너는 엠파크 AI딜러 보조원. 사실 기반으로 짧고 정확하게 답한다.' },
      { role: 'user', content: msg },
    ]
    try {
      let reply = await chatAnswer(messages, { useFtIfAvailable: true })
      if (greeted) reply = `${greetText}\n${reply}`
      return res.json({ reply, items: [] })
    } catch (e) {
      let reply = '지금은 답변을 가져오지 못했다. 나중에 다시 시도해 달라.'
      if (greeted) reply = `${greetText}\n${reply}`
      return res.json({ reply, items: [] })
    }
  })

  return router
}

module.exports = buildChatRoutes
