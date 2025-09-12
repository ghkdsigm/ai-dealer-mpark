// NOTE: 코드 주석에 이모티콘은 사용하지 않음

import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// 파싱/검색형 LLM 유틸
import { askJSONForChat } from '../services/llm_gemma.js'

// 조언형 분류 및 LLM
import { classifyIntentAdvice } from '../lib/util.js'
import { normalizeIntent } from '../lib/filter.js'
import { askAdviceLLM } from '../services/advice_llm.js'

// 차량 정규화/랭킹
import { filterAndRank, normalizeVehicle } from '../lib/filter.js'

// 세션 유틸은 기존에 만든 app.js/session.js를 그대로 사용
import { sidFrom } from '../app.js'
import { getSess, resetSess } from '../services/session.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataPath = path.join(__dirname, '..', 'data', 'vehicles.json')

// 파일 형식: { meta, data: [...] }
const RAW = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
const VEHICLES = Array.isArray(RAW?.data) ? RAW.data.map(normalizeVehicle) : []

export default function buildRoutes() {
	const router = express.Router()

	// 대화 단계: 리스트는 반환하지 않고 힌트/상태만
	router.post('/chat', async (req, res) => {
		const sid = sidFrom(req)
		const sess = getSess(sid)
		const msg = String(req.body?.message || '').trim()

		// 1) 조언형/검색형 분기 우선 판단
		const kind = classifyIntentAdvice(msg)
		if (kind === 'advice') {
			console.log(1)
			// 선택: 필요시 짧은 KB 텍스트를 붙일 수 있다. 여기서는 생략
			const kb = ''
			const advice = await askAdviceLLM(msg, kb)
			return res.json({
				reply: [
					advice.summary,
					advice.bullets?.length ? '- ' + advice.bullets.join('\n- ') : '',
					advice.caveats?.length ? `주의: ${advice.caveats.join(', ')}` : '',
					advice.followups?.length ? `다음 질문: ${advice.followups.join(' / ')}` : '',
				]
					.filter(Boolean)
					.join('\n'),
				items: [],
				route: 'advice',
				intent: sess.intent,
			})
		}

		// 2) 검색형 파이프라인
		const cloud = await askJSONForChat(msg)
		const f = cloud?.filters || {}

		if (Array.isArray(f?.notes) && f.notes.includes('non_vehicle')) {
			return res.json({
				reply: '엠파크 차량 관련 질문에만 답할 수 있어요. 예산대(예: 2천만 원대)나 차종(SUV/세단) 중 하나를 알려주시면 추천을 준비하겠습니다.',
				items: [],
				route: 'non_vehicle',
				intent: sess.intent,
			})
		}

		// 세션 intent 갱신
		sess.intent = normalizeIntent({
			...sess.intent,
			// 금액
			budgetMin: f?.budget?.minKman ?? sess.intent.budgetMin,
			budgetMax: f?.budget?.maxKman ?? sess.intent.budgetMax,
			// 월납입
			monthlyMin: f?.monthly?.minKman ?? sess.intent.monthlyMin,
			monthlyMax: f?.monthly?.maxKman ?? sess.intent.monthlyMax,
			// 주행/연식
			kmMin: f?.km?.minKm ?? sess.intent.kmMin,
			kmMax: f?.km?.maxKm ?? sess.intent.kmMax,
			yearMin: f?.years?.min ?? sess.intent.yearMin,
			yearMax: f?.years?.max ?? sess.intent.yearMax,
			// 연료/차종
			fuelType: (f.fuelTypes && f.fuelTypes[0]) ?? sess.intent.fuelType,
			bodyType: (f.bodyTypes && f.bodyTypes[0]) ?? sess.intent.bodyType,
			// 기타
			brands: Array.isArray(f.brands) && f.brands.length ? f.brands : sess.intent.brands || [],
			models: Array.isArray(f.models) && f.models.length ? f.models : sess.intent.models || [],
			colors: Array.isArray(f.colors) && f.colors.length ? f.colors : sess.intent.colors || [],
			options: Array.isArray(f.options) && f.options.length ? f.options : sess.intent.options || [],
			noAccident: typeof f.noAccident === 'boolean' ? f.noAccident : sess.intent.noAccident ?? null,
			shortKm: typeof f.shortKm === 'boolean' ? f.shortKm : sess.intent.shortKm ?? null,
		})

		if (cloud?.direct_reply) {
			return res.json({
				reply: cloud.direct_reply,
				items: [],
				route: 'direct_reply',
				intent: sess.intent,
			})
		}

		// 준비 상태 판정: 조건 중 하나라도 있으면 ready
		const i = sess.intent
		const hasBudget = Number.isFinite(i.budgetMax) || Number.isFinite(i.budgetMin)
		const hasMonthly = Number.isFinite(i.monthlyMax) || Number.isFinite(i.monthlyMin)
		const hasType = !!(i.bodyType || i.fuelType)
		const hasUsage = Number.isFinite(i.kmMax) || Number.isFinite(i.yearMin) || Number.isFinite(i.yearMax)
		const hasKeyword = i.brands?.length || i.models?.length || i.colors?.length || i.options?.length
		const wantRecommend = /(추천|추천해줘|보여줘|골라줘|리스트|찾아줘)/i.test(msg)

		const ready = hasBudget || hasMonthly || hasType || hasUsage || hasKeyword

		if (wantRecommend && ready) {
			return res.json({
				reply: '조건이 충분합니다! "추천 실행" 버튼을 눌러 맞춤 차량을 찾아보세요.',
				items: [],
				route: 'trigger_recommend',
				intent: sess.intent,
			})
		}

		if (ready) {
			return res.json({
				reply: '조건이 모였습니다. "추천 실행" 버튼을 눌러 결과를 확인해 주세요.',
				items: [],
				route: 'ready',
				intent: sess.intent,
			})
		}

		// 아직 부족하면 최소 단서만 더 유도
		const asks = []
		if (!hasBudget && !hasMonthly) asks.push('예산대 또는 월 납입액(예: 2천만 원대, 월 25만)')
		if (!hasType) asks.push('차종/연료(예: 세단, SUV, 디젤)')
		if (!hasUsage) asks.push('주행/연식(예: 8만km 이하, 16~19년식)')
		asks.push('브랜드/모델/색상/옵션 중 하나')

		return res.json({
			reply: `다음 중 하나만 알려주세요: ${asks.join(', ')}`,
			items: [],
			route: 'collect',
			intent: sess.intent,
		})
	})

	// 최종 추천: 세션 intent + 옵션 q 또는 filters 하나 더 반영
	router.post('/recommend', async (req, res) => {
		const sid = sidFrom(req)
		const sess = getSess(sid)

		const q = String(req.body?.q || '').trim()
		const directFilters = req.body?.filters

		let f = null
		if (directFilters && typeof directFilters === 'object') {
			// 클라이언트가 필터 객체를 직접 전달한 경우
			f = directFilters
		} else if (q) {
			// 텍스트 질의가 있다면 파싱
			const cloud = await askJSONForChat(q)
			f = cloud?.filters || {}
		} else {
			f = {}
		}

		// 세션 intent 갱신
		sess.intent = normalizeIntent({
			...sess.intent,
			budgetMin: f?.budget?.minKman ?? sess.intent.budgetMin,
			budgetMax: f?.budget?.maxKman ?? sess.intent.budgetMax,
			monthlyMin: f?.monthly?.minKman ?? sess.intent.monthlyMin,
			monthlyMax: f?.monthly?.maxKman ?? sess.intent.monthlyMax,
			kmMin: f?.km?.minKm ?? sess.intent.kmMin,
			kmMax: f?.km?.maxKm ?? sess.intent.kmMax,
			yearMin: f?.years?.min ?? sess.intent.yearMin,
			yearMax: f?.years?.max ?? sess.intent.yearMax,
			fuelType: (f.fuelTypes && f.fuelTypes[0]) ?? sess.intent.fuelType,
			bodyType: (f.bodyTypes && f.bodyTypes[0]) ?? sess.intent.bodyType,
			brands: Array.isArray(f.brands) && f.brands.length ? f.brands : sess.intent.brands || [],
			models: Array.isArray(f.models) && f.models.length ? f.models : sess.intent.models || [],
			colors: Array.isArray(f.colors) && f.colors.length ? f.colors : sess.intent.colors || [],
			options: Array.isArray(f.options) && f.options.length ? f.options : sess.intent.options || [],
			noAccident: typeof f.noAccident === 'boolean' ? f.noAccident : sess.intent.noAccident ?? null,
			shortKm: typeof f.shortKm === 'boolean' ? f.shortKm : sess.intent.shortKm ?? null,
		})

		const limit = Number(req.body?.limit || 100)
		const outAll = filterAndRank(VEHICLES, sess.intent)
		const out = outAll.slice(0, limit)

		if (!out.length) {
			return res.json({
				reply: '죄송합니다. 현재 조건에 맞는 매물을 찾지 못했습니다. 예산 범위를 넓히거나 다른 조건으로 다시 시도해 주세요. 예: "중형 세단 8만km 이하 2,000만원대"',
				items: [],
				route: 'no_result',
				debug: {
					intent: sess.intent,
					totalVehicles: VEHICLES.length,
					filteredCount: outAll.length,
				},
			})
		}

		return res.json({
			reply: `요청을 종합해 ${out.length}건을 추천드립니다.`,
			items: out,
			route: 'final_recommend',
			debug: { intent: sess.intent },
		})
	})

	router.post('/reset', (req, res) => {
		const sid = sidFrom(req)
		resetSess(sid)
		res.json({ ok: true })
	})

	return router
}
