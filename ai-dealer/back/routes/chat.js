// back/routes/chat.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음

const express = require('express')
const { parseIntent } = require('../lib/nlu')
const { filterWithRelaxation } = require('../lib/search')
const { rankVehicles } = require('../lib/search')
const { checklist } = require('../services/maintenance')
const { recommendFuel } = require('../services/rules')
const { chatAnswer } = require('../services/infer')
const { buildComps } = require('../services/valuation')
const { askJSON } = require('../services/llm_gemma')

// ------------------------------
// 간단 세션 (메모리)
// ------------------------------
const SESSIONS = new Map() // sid -> { intent, stage, updatedAt }

function getSessionId(req) {
  // 우선순위: 명시적 user.id > 헤더 x-user-id > ip+ua 해시 대용(간단)
  const uid = req.body?.user?.id || req.get('x-user-id') || `${req.ip}|${req.get('user-agent') || ''}`
  return String(uid)
}
function getSession(sid) {
  if (!SESSIONS.has(sid)) SESSIONS.set(sid, { intent: {}, stage: 'collect', updatedAt: Date.now() })
  const s = SESSIONS.get(sid)
  s.updatedAt = Date.now()
  return s
}
function resetSession(sid) {
  SESSIONS.set(sid, { intent: {}, stage: 'collect', updatedAt: Date.now() })
  return SESSIONS.get(sid)
}

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
function arrOrEmpty(v) { return Array.isArray(v) ? v.filter(Boolean) : [] }
function pickFirst(arr) { return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined }

function normalizeIntentRanges(intent) {
  const out = { ...intent }
  // 범위 보정
  if (Number.isFinite(out.budgetMin) && Number.isFinite(out.budgetMax) && out.budgetMin > out.budgetMax) {
    const t = out.budgetMin; out.budgetMin = out.budgetMax; out.budgetMax = t
  }
  if (Number.isFinite(out.kmMin) && Number.isFinite(out.kmMax) && out.kmMin > out.kmMax) {
    const t = out.kmMin; out.kmMin = out.kmMax; out.kmMax = t
  }
  if (Number.isFinite(out.yearMin) && Number.isFinite(out.yearMax) && out.yearMin > out.yearMax) {
    const t = out.yearMin; out.yearMin = out.yearMax; out.yearMax = t
  }
  // 음수 방지
  if (Number.isFinite(out.kmMin) && out.kmMin < 0) out.kmMin = 0
  if (Number.isFinite(out.kmMax) && out.kmMax < 0) out.kmMax = 0
  if (Number.isFinite(out.budgetMin) && out.budgetMin < 0) out.budgetMin = 0
  if (Number.isFinite(out.budgetMax) && out.budgetMax < 0) out.budgetMax = 0
  return out
}
function stableId(v, i = 0) {
  const parts = [v.id, v.demoNo, v.carNo, v.make, v.model, v.year, v.km, v.price, i].filter(x => x !== undefined && x !== null)
  return String(parts.join('|'))
}
function hasAnyConstraint(intent) {
  const KEYS = ['budgetMin','budgetMax','monthlyMin','monthlyMax','kmMin','kmMax','yearMin','yearMax','yearExact','fuelType','bodyType','segment','transmission','make','model','colors','noAccident']
  return KEYS.some(k => {
    const v = intent[k]
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''
  })
}
function mergeIntent(base, add) {
  const out = { ...base, ...add } // 단순 병합
  return normalizeIntentRanges(out)
}
function isPureGreeting(s) {
  if (!s) return false
  const t = String(s).trim()
  return /^([!?.…\s]*)?(안녕|안녕하세요|하이|ㅎㅇ|hello|hi)([!?.…\s]*)?$/i.test(t)
}
function isVehicleRelated(intent, msg) {
  if (intent?.kind === 'buy' || intent?.kind === 'sell') return true
  if (hasAnyConstraint(intent || {})) return true
  return /(차|차량|suv|세단|연비|예산|가격|원|만원|억|km|키로|주행|주행거리|연식|옵션|브랜드|모델|사고|무사고|lpg|디젤|가솔린|하이브리드|전기|리스|렌트|승용|승합|픽업)/i.test(msg || '')
}
function isConsent(msg) {
  return /(네|예|좋아요|좋습니다|추천해줘|추천해 주세요|골라줘|찾아줘|보여줘|진행해|시작해)/i.test(msg || '')
}
function wantsDirectRecommend(msg) {
  return /(추천(해|해줘|해줘요|해 주세요)|골라줘|찾아줘|보여줘|top\s*\d+)/i.test(msg || '')
}

// ------------------------------
// Gemma JSON 추출 (direct_reply 지원)
// ------------------------------
async function callCloudFallback({ q }) {
  const prompt = [
    '너는 엠파크 AI딜러다. 사용자의 한국어 질문을 분석해 아래 JSON만 출력한다.',
    '목표: 차량 관련 의도를 구조화하여 추천 파라미터로 전달. 차량 관련이 아니면 추천을 시도하지 않는다.',
    '규칙:',
    '- 예산은 "만원" 정수. 예: 2,200만원 -> 2200.',
    '- 주행거리는 km 정수. "만"=10000, "천"=1000.',
    '- 연식은 연도 정수 범위(min/max). "15년식"은 2015.',
    '- 연료/차종/세그먼트/변속기/브랜드/모델/색상은 배열. 알 수 없으면 빈 배열.',
    '- 인사만 한 경우(예: "안녕", "안녕하세요", "hi", "ㅎㅇ"): filters는 모두 비우고 direct_reply="안녕하세요" 로 설정.',
    '- 질문 의도가 차량 구매/판매/점검과 무관하면 filters를 모두 비우고 notes=["non_vehicle"] 를 포함.',
    '출력 JSON 스키마(이외 텍스트 금지):',
    `{
      "normalized_query": "string",
      "direct_reply": null | string,
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
    '반드시 유효한 JSON만 출력한다. 다른 텍스트 출력 금지.',
    `사용자질문: ${q}`
  ].join('\n')

  const data = await askJSON(prompt, { temperature: 0.1 })
  const f = data?.filters || {}

  const intentRaw = {
    kind: 'buy', // 기본값
    budgetMin: safeInt(f?.budget?.minKman),
    budgetMax: safeInt(f?.budget?.maxKman),
    kmMin: safeInt(f?.km?.minKm, 0),
    kmMax: safeInt(f?.km?.maxKm),
    yearMin: safeInt(f?.years?.min),
    yearMax: safeInt(f?.years?.max),
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

  if (intentRaw.notes?.includes('non_vehicle')) intentRaw.kind = 'unknown'
  const directReply = typeof data?.direct_reply === 'string' ? data.direct_reply.trim() : null

  return { intent: normalizeIntentRanges(intentRaw), directReply, raw: data }
}

// ------------------------------
// 라우터
// ------------------------------
function buildChatRoutes(ctx) {
  const { getSnapshot, getWeights } = ctx
  const router = express.Router()

  // 재고 메타
  router.get('/inventory/meta', (_req, res) => {
    const snap = getSnapshot()
    res.json({ version: snap.version, updatedAt: snap.updatedAt, count: snap.list.length })
  })

  // 세션 리셋(테스트용)
  router.post('/chat/reset', (req, res) => {
    const sid = getSessionId(req)
    resetSession(sid)
    res.json({ ok: true })
  })

  // 즉시 추천 엔드포인트(기존 유지) - 고객이 처음부터 "추천"을 명시하면 사용
  router.post('/recommend', async (req, res) => {
    const q = String((req.body && (req.body.q ?? req.body.query)) || '')
    const limit = Math.min(Number(req.body?.limit ?? 10), 50)

    const snap = getSnapshot()
    const weights = getWeights()

    // 인사 단락
    if (isPureGreeting(q)) {
      return res.json({ reply: '안녕하세요', items: [], intent: { kind: 'unknown' }, route: 'greeting_short_circuit' })
    }

    // Gemma 파싱
    let cloud
    try { cloud = await callCloudFallback({ q }) }
    catch {
      const catalog = {
        makes: [...new Set(snap.list.map(v => v.make).filter(Boolean))],
        models: [...new Set(snap.list.map(v => v.model).filter(Boolean))],
      }
      cloud = { intent: normalizeIntentRanges(parseIntent(q, catalog)), directReply: null, raw: null }
    }

    if (cloud.directReply) {
      return res.json({ reply: cloud.directReply, items: [], intent: cloud.intent, route: 'cloud_direct_reply' })
    }
    if (!isVehicleRelated(cloud.intent, q)) {
      const reply = '엠파크 차량 관련 질문에만 답할 수 있어요.\n원하시는 예산대나 차종(SUV/세단) 중 하나만 알려주시면 추천을 시작할게요.'
      return res.json({ reply, items: [], intent: cloud.intent, route: 'non_vehicle_filtered' })
    }

    // 추천
    const { candidates, usedIntent, relaxed } = filterWithRelaxation(snap.list, cloud.intent)
    const ranked = rankVehicles(candidates, usedIntent, q, weights)
    const items = ranked.slice(0, limit).map((v, i) => ({ id: stableId(v, i), ...v }))
    if (!items.length) {
      return res.json({
        reply: '조건에 맞는 매물을 찾지 못했어요. 예: "중형 세단 8만km 이하 2,000만원대"처럼 범위를 조정해 다시 시도해 주세요.',
        items: [],
        intent: usedIntent,
        relaxed,
        route: 'no_result'
      })
    }
    return res.json({ items, intent: usedIntent, relaxed, route: 'cloud_intent_then_local_search', cloudRaw: cloud.raw })
  })

  // 대화형 엔드포인트: 정보 수집 → 동의 → 추천
  router.post('/chat', async (req, res) => {
    const raw = req.body?.message || ''
    const user = req.body?.user || {}
    const sid = getSessionId(req)
    const sess = getSession(sid)

    const WAKE = /(ai\s*딜러|에이아이\s*딜러|딜러)\s*야/i
    const greeted = WAKE.test(raw)
    const msg = raw.replace(WAKE, '').trim()
    const greetText = '네 고객님, 차량을 구매하실건가요? 판매하실건가요?'

    const snap = getSnapshot()
    const weights = getWeights()

    // 0) 인사/차량번호 우선 처리
    if (isPureGreeting(msg)) {
      let reply = '안녕하세요. 예산대(예: 2천만 원대)나 차종(SUV/세단) 중 하나부터 알려주시면 추천 준비를 시작할게요.'
      if (greeted) reply = `${greetText}\n${reply}`
      return res.json({ reply, items: [], intent: sess.intent, stage: sess.stage, route: 'greeting_short_circuit' })
    }
    const plateMatch = msg.match(/([0-9]{2,3}[가-힣][0-9]{4})/)
    if (plateMatch) {
      const carNo = plateMatch[1]
      const v = snap.list.find(x => x.carNo === carNo)
      if (!v) {
        let reply = '해당 차량번호를 찾지 못했습니다.'
        if (greeted) reply = `${greetText}\n${reply}`
        return res.json({ reply, items: [] })
      }
      const list = checklist({ year: v.year, km: v.km })
      let reply = `차량(${v.carName}) 점검 제안: ${list.join(' · ')}`
      if (greeted) reply = `${greetText}\n${reply}`
      return res.json({ reply, items: [ { id: stableId(v,0), ...v } ], route: 'plate_check' })
    }

    // 1) Gemma로 현재 턴의 의도/파라미터 추출
    let cloud
    try { cloud = await callCloudFallback({ q: msg }) }
    catch {
      // 실패시 최소한의 로컬 파서 보조
      const catalog = {
        makes: [...new Set(snap.list.map(v => v.make).filter(Boolean))],
        models: [...new Set(snap.list.map(v => v.model).filter(Boolean))],
      }
      cloud = { intent: normalizeIntentRanges(parseIntent(msg, catalog)), directReply: null, raw: null }
    }

    // direct reply 우선
    if (cloud.directReply) {
      let reply = cloud.directReply
      if (greeted) reply = `${greetText}\n${reply}`
      return res.json({ reply, items: [], intent: sess.intent, stage: sess.stage, route: 'cloud_direct_reply' })
    }

    // 비차량 차단 + 유도
    if (!isVehicleRelated(cloud.intent, msg)) {
      const reply = '엠파크 차량 관련 질문에만 답할 수 있어요.\n원하시는 예산대(예: 2천만 원대)나 차종(SUV/세단) 중 하나만 알려주시면 준비하겠습니다.'
      return res.json({ reply, items: [], intent: sess.intent, stage: sess.stage, route: 'non_vehicle_filtered' })
    }

    // 2) 세션 intent 누적
    sess.intent = mergeIntent(sess.intent, cloud.intent)

    // 3) 판매 플로우 즉시 처리(필요 필드 유도 → comps/estimate)
    if (sess.intent.kind === 'sell') {
      const needName = !sess.intent.carName
      const needYear = !sess.intent.year
      const needKm = sess.intent.km == null
      if (needName || needYear || needKm) {
        const holes = []
        if (needName) holes.push('차명(예: 현대 제네시스DH G330 모던)')
        if (needYear) holes.push('연식(예: 2016년)')
        if (needKm) holes.push('주행거리(예: 12만 km)')
        let reply = `판매하실 차량 정보를 알려주세요.\n필요 정보: ${holes.join(', ')}`
        if (greeted) reply = `${greetText}\n${reply}`
        return res.json({ reply, items: [], intent: sess.intent, stage: sess.stage, route: 'sell_need_fields' })
      }
      const subject = {
        carName: sess.intent.carName,
        year: sess.intent.year,
        km: sess.intent.km,
        fuelType: sess.intent.fuelType,
        color: sess.intent.color,
      }
      const { comps, estimate } = buildComps(snap.list, subject)
      let reply = `입력하신 차량 기준 예상 매입가(만 원): ${estimate.low.toLocaleString()} ~ ${estimate.high.toLocaleString()} (중앙값 ${estimate.mid.toLocaleString()}).\n실제 가격은 상태/사고/옵션에 따라 달라질 수 있습니다.`
      if (greeted) reply = `${greetText}\n${reply}`
      sess.stage = 'quoted'
      return res.json({ reply, items: comps.slice(0,6).map((v,i)=>({id:stableId(v,i),...v})), intent: sess.intent, stage: sess.stage, estimate, route: 'sell_quote' })
    }

    // 4) 구매 플로우: 정보 수집 → 동의 → 추천
    // (a) 수집된 정보 점검
    const haveAny = hasAnyConstraint(sess.intent)
    const needBudget = !Number.isFinite(sess.intent.budgetMax) && !Number.isFinite(sess.intent.budgetMin)
    const needBody = !sess.intent.bodyType && !sess.intent.segment && !sess.intent.make && !sess.intent.model

    // (b) 사용자가 처음부터 "추천해줘"면 바로 추천
    const consentDirect = wantsDirectRecommend(msg) || isConsent(msg)

    // (c) 추천 실행 조건: 동의가 있거나, 직접 추천 요청이 있거나, 필수 중 일부가 채워져 있고 사용자가 추천을 원함
    const shouldRecommend = consentDirect || (haveAny && sess.stage === 'ready')

    // (d) 아직 수집 단계라면 다음 질문 제시
    if (!shouldRecommend && !consentDirect) {
      // 사용자 주행 패턴 있으면 연료가이드 마련
      let fuelGuide = null
      if (user && (user.yearlyKm || user.monthlyKm)) fuelGuide = recommendFuel(user)

      // 다음 질문 후보
      const asks = []
      if (needBudget) asks.push('예산대(예: 2천만 원대)')
      if (needBody) asks.push('차종 또는 선호(예: SUV/세단/국산/수입 또는 브랜드/모델)')
      if (!Number.isFinite(sess.intent.kmMax)) asks.push('주행거리 한도(예: 8만 km 이하)')
      if (!Number.isFinite(sess.intent.yearMin) && !Number.isFinite(sess.intent.yearMax)) asks.push('연식 범위(예: 16~19년식)')
      const nextQ = asks.length ? `다음 중 하나만 알려주세요: ${asks.join(', ')}` : '추천을 시작해도 괜찮을까요?'

      let reply = nextQ
      if (fuelGuide) reply = `${reply}\n주행 패턴 기준 권장 연료: ${fuelGuide.join('/')}`
      if (greeted) reply = `${greetText}\n${reply}`

      // 최소 조건이 일부라도 확보되면 다음 턴에 추천 가능 상태로 전환
      if (haveAny) sess.stage = 'ready'
      else sess.stage = 'collect'

      return res.json({ reply, items: [], intent: sess.intent, stage: sess.stage, route: 'collect_next' })
    }

    // (e) 추천 실행
    const { candidates, usedIntent, relaxed } = filterWithRelaxation(snap.list, sess.intent)
    const ranked = rankVehicles(candidates, usedIntent, msg, weights)
    const items = ranked.slice(0, 5).map((v,i)=>({ id: stableId(v,i), ...v }))

    if (!items.length) {
      let reply = '정확히 일치하는 매물은 없어 조건을 조금 완화해 다시 시도해 주세요. 예: "중형 세단 8만km 이하"처럼 범위를 넓혀보세요.'
      if (greeted) reply = `${greetText}\n${reply}`
      return res.json({ reply, items: [], intent: usedIntent, stage: sess.stage, relaxed, route: 'no_result' })
    }

    const top = items[0]
    let reply = `요청을 종합해 추천드립니다. ${top.year ?? ''} ${top.make} ${top.model}가 조건에 잘 맞습니다.\n더 좁히려면 예산/차종/연식/주행거리 중 하나를 조정해 보셔도 좋아요.`
    if (greeted) reply = `${greetText}\n${reply}`

    sess.stage = 'recommended'
    return res.json({ reply, items, intent: usedIntent, stage: sess.stage, relaxed, route: 'final_recommend' })
  })

  return router
}

module.exports = buildChatRoutes
