// NOTE: 코드 주석에 이모티콘은 사용하지 않음

import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// 파싱/검색형 LLM 유틸
import { askJSONForChat } from '../services/llm_gemma.js'

// 조언형 분류
import { classifyIntentAdvice } from '../lib/util.js'
import { normalizeIntent } from '../lib/filter.js'

// 차량 정규화/랭킹
import { filterAndRank, normalizeVehicle } from '../lib/filter.js'

// 세션 유틸
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

		// 1) 조언형/검색형 분기
		const kind = classifyIntentAdvice(msg)
		if (kind === 'advice') {
			// Ollama에 직접 프록시 (스트리밍)
			const r = await fetch('http://127.0.0.1:11434/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: 'gemma3',
					stream: true,
					messages: [
						{
							role: 'system',
							content: `
당신은 자동차 구매·사용 조언 상담사다.
- 사용자에게 보이는 출력은 먼저 한국어 자연어 텍스트만 제공한다. 키 이름이나 JSON, 코드펜스를 포함하지 않는다.
- 그 다음 줄에 정확히 "<JSON>" 한 줄을 출력한 뒤, 요구된 JSON만 출력하고 종료한다.
- 최종 순서:
  1) 사용자용 텍스트(마크업 느낌의 순수 문장)
  2) <JSON>
  3) JSON 객체
`.trim(),
						},
						{ role: 'user', content: msg },
					],
					options: { temperature: 0.4, num_predict: 256 },
				}),
			})

			// 스트리밍 헤더
			res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
			res.setHeader('Cache-Control', 'no-cache')
			res.setHeader('Connection', 'keep-alive')

			const reader = r.body.getReader()
			const decoder = new TextDecoder()

			// 상태 머신: 가시 텍스트만 전달하다가 <JSON> 이후는 차단
			let buffer = ''
			let sawJSONMarker = false
			let inFence = false // ``` 코드펜스 내부 여부
			let fenceLang = '' // 코드펜스 언어 식별 (json 등)
			let pending = '' // 가시 텍스트 누적 버퍼

			function flushVisible(text) {
				if (!text) return
				// 일부 모델이 앞에 'n' 또는 '\n\n' 같은 가비지를 붙이는 것을 정리
				if (!sawJSONMarker && pending.length === 0) {
					text = text.replace(/^[n\r\n]+/, '')
				}
				res.write(text)
			}

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })

				// Ollama 스트림은 \n 구분의 JSON line
				let lines = buffer.split('\n')
				buffer = lines.pop() // 마지막 불완전 줄

				for (const line of lines) {
					if (!line.trim()) continue
					let event
					try {
						event = JSON.parse(line)
					} catch {
						continue
					}

					const delta = event.message?.content || ''
					if (!delta) continue

					// 1) JSON 구간 마커 감지: "<JSON>"
					if (!sawJSONMarker && delta.includes('<JSON>')) {
						const [before, afterMarker] = delta.split('<JSON>')
						// 마커 이전 텍스트만 가시 출력
						if (!inFence) flushVisible(before)
						sawJSONMarker = true
						// 이후 내용은 무시
						continue
					}

					// 2) 코드펜스 필터: ``` 또는 ```json ... ```
					let out = delta
					// 코드펜스 토글 감지
					const fenceOpenMatch = out.match(/```(\w+)?/)
					const fenceClose = out.includes('```')

					if (!sawJSONMarker) {
						if (inFence) {
							// 코드펜스 내부는 가시 출력에서 제외
							if (fenceClose) {
								inFence = false
								fenceLang = ''
							}
							continue
						} else {
							if (fenceOpenMatch) {
								inFence = true
								fenceLang = fenceOpenMatch[1] || ''
								// 펜스 시작 전의 텍스트만 출력
								const idx = out.indexOf('```')
								const beforeFence = out.slice(0, idx)
								if (beforeFence) flushVisible(beforeFence)
								// 이후는 펜스 내부로 간주하여 스킵
								continue
							}
						}
					}

					// 3) 일반 상황: JSON 마커 전에는 그대로 내보냄, 이후는 버림
					if (!sawJSONMarker && !inFence) {
						flushVisible(out)
					}
				}
			}

			// 종료 신호
			res.end()
			return
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

		if (cloud?.direct_reply) {
			return res.json({
				reply: cloud.direct_reply,
				items: [],
				route: 'direct_reply',
				intent: sess.intent,
			})
		}

		// 준비 상태 판정
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

		// 부족할 경우 추가 단서 유도
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

	// 최종 추천
	router.post('/recommend', async (req, res) => {
		const sid = sidFrom(req)
		const sess = getSess(sid)

		const q = String(req.body?.q || '').trim()
		const directFilters = req.body?.filters

		let f = null
		if (directFilters && typeof directFilters === 'object') {
			f = directFilters
		} else if (q) {
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
