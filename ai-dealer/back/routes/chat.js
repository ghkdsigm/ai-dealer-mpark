// back/routes/chat.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음

const express = require('express')
const { parseIntent } = require('../lib/nlu') // 통합 NLU
const { ruleFilter, filterWithRelaxation } = require('../lib/search') // 필터/완화
const { rankVehicles } = require('../lib/search') // 랭킹은 기존 search.js 재사용
const { checklist } = require('../services/maintenance')
const { recommendFuel } = require('../services/rules')
const { chatAnswer } = require('../services/infer')
const { buildComps } = require('../services/valuation')

function buildChatRoutes(ctx) {
	const { getSnapshot, getWeights } = ctx
	const router = express.Router()

	router.get('/inventory/meta', (_req, res) => {
		const snap = getSnapshot()
		res.json({ version: snap.version, updatedAt: snap.updatedAt, count: snap.list.length })
	})

	router.post('/recommend', (req, res) => {
		const q = String(req.body?.query || '')
		const snap = getSnapshot()

		// 카탈로그(브랜드/모델 동적 인식에 사용)
		const catalog = {
			makes: [...new Set(snap.list.map(v => v.make).filter(Boolean))],
			models: [...new Set(snap.list.map(v => v.model).filter(Boolean))],
		}

		const intent = parseIntent(q, catalog)
		const { candidates, usedIntent, relaxed } = filterWithRelaxation(snap.list, intent)
		const ranked = rankVehicles(candidates, usedIntent, q, getWeights())

		res.json({ items: ranked.slice(0, 5), intent: usedIntent, relaxed })
	})

	router.post('/chat', async (req, res) => {
		const raw = req.body?.message || ''
		const user = req.body?.user || {}

		const WAKE = /(ai\s*딜러|에이아이\s*딜러|딜러)\s*야/i
		const greeted = WAKE.test(raw)
		const msg = raw.replace(WAKE, '').trim()
		const greetText = '네 고객님, 차량을 구매하실건가요? 판매하실건가요?'

		const snap = getSnapshot()

		// 동일한 NLU 사용
		const catalog = {
			makes: [...new Set(snap.list.map(v => v.make).filter(Boolean))],
			models: [...new Set(snap.list.map(v => v.model).filter(Boolean))],
		}
		const intent = parseIntent(msg, catalog)

		/* ----- 판매 플로우 ----- */
		if (intent.kind === 'sell') {
			const needName = !intent.carName
			const needYear = !intent.year
			const needKm = intent.mileage == null
			if (needName || needYear || needKm) {
				const holes = []
				if (needName) holes.push('차명(예: 현대 제네시스DH G330 모던)')
				if (needYear) holes.push('연식(예: 2016년)')
				if (needKm) holes.push('주행거리(예: 12만 km)')
				let reply = `판매하실 차량 정보를 알려주세요.\n필요 정보: ${holes.join(', ')}`
				if (greeted) reply = `${greetText}\n${reply}`
				return res.json({ reply, items: [], intent })
			}

			const subject = {
				carName: intent.carName,
				year: intent.year,
				mileage: intent.mileage,
				fuelType: intent.fuelType,
				color: intent.color,
			}
			const { comps, estimate } = buildComps(snap.list, subject)

			let reply = `입력하신 차량 기준 예상 매입가(만 원): ${estimate.low.toLocaleString()} ~ ${estimate.high.toLocaleString()} (중앙값 ${estimate.mid.toLocaleString()}).\n유사 매물 기준으로 산정했어요. 실제 가격은 상태/사고/옵션에 따라 달라질 수 있습니다.`
			if (greeted) reply = `${greeted ? greetText + '\n' : ''}${reply}`

			return res.json({ reply, items: comps.slice(0, 6), intent, estimate })
		}

		/* ----- 구매 플로우 ----- */
		const looksVehicle =
			/(차|차량|suv|세단|연비|예산|가격|원|만원|억|km|키로|주행|주행거리|연식|옵션|브랜드|모델|사고|무사고|lpg|디젤|가솔린|하이브리드|전기)/i.test(
				msg,
			)

		const hasConstraints = [
			'budgetMin',
			'budgetMax',
			'monthlyMin',
			'monthlyMax',
			'mileageMin',
			'mileageMax',
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
		].some(k => {
			const v = intent[k]
			return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null
		})

		if (looksVehicle || intent.kind === 'buy' || hasConstraints) {
			let fuelGuide = null
			if (user && (user.yearlyKm || user.monthlyKm)) fuelGuide = recommendFuel(user)

			// 1) 하드 필터 + 완화
			const { candidates, usedIntent, relaxed } = filterWithRelaxation(snap.list, intent)

			// 2) 랭킹
			const ranked = rankVehicles(candidates, usedIntent, msg, getWeights())
			const items = ranked.slice(0, 5)

			// 3) 태그 표현: 주행 방향(≥/≤ 또는 범위) 반영
			const mileageTag =
				typeof usedIntent.mileageMin === 'number' && typeof usedIntent.mileageMax === 'number'
					? `주행 ${usedIntent.mileageMin.toLocaleString()}~${usedIntent.mileageMax.toLocaleString()}km`
					: typeof usedIntent.mileageMin === 'number'
					? `주행≥${usedIntent.mileageMin.toLocaleString()}km`
					: typeof usedIntent.mileageMax === 'number'
					? `주행≤${usedIntent.mileageMax.toLocaleString()}km`
					: ''

			let reply
			if (items.length) {
				const top = items[0]
				const tags = [
					typeof usedIntent.budgetMax === 'number' ? `예산≤${usedIntent.budgetMax}만원` : '',
					typeof usedIntent.monthlyMax === 'number' ? `월≤${usedIntent.monthlyMax}만원` : '',
					mileageTag,
					usedIntent.bodyType ? `차종:${usedIntent.bodyType}` : '',
					usedIntent.segment ? `세그:${usedIntent.segment}` : '',
					usedIntent.fuelType ? `연료:${usedIntent.fuelType}` : '',
					fuelGuide ? `주행패턴:${fuelGuide.join('/')}` : '',
				]
					.filter(Boolean)
					.join(' · ')

				const relaxNote = relaxed.length ? ` (일부 조건 완화: ${relaxed.join(', ')})` : ''
				reply = `요청을 반영해 골라봤어요${relaxNote}. ${top.year ?? ''} ${top.make} ${top.model}${
					tags ? ` (${tags})` : ''
				}가 조건에 잘 맞아요.`
			} else {
				reply = `정확히 일치하는 매물은 없어 조건을 조금 완화해 다시 시도해 주세요. 예: "중형 세단 8만km 이하"처럼 범위를 넓혀보세요.`
			}
			if (greeted) reply = `${greetText}\n${reply}`
			return res.json({ reply, items, intent: usedIntent, fuelGuide, relaxed })
		}

		/* ----- 차량번호 점검 ----- */
		const plateMatch = msg.match(/([0-9]{2,3}[가-힣][0-9]{4})/)
		if (plateMatch) {
			const carNo = plateMatch[1]
			const v = snap.list.find(x => x.carNo === carNo)
			if (!v) {
				let reply = '해당 차량번호를 찾지 못했어요.'
				if (greeted) reply = `${greetText}\n${reply}`
				return res.json({ reply, items: [] })
			}
			const list = checklist({ year: v.year, mileage: v.mileage })
			let reply = `차량(${v.carName}) 점검 제안: ${list.join(' · ')}`
			if (greeted) reply = `${greetText}\n${reply}`
			return res.json({ reply, items: [v] })
		}

		/* ----- 일반 Q&A → (있으면) 클라우드/FT ----- */
		const messages = [
			{ role: 'system', content: '너는 엠파크 AI딜러 보조원. 사실 기반으로 짧고 정확하게 답한다.' },
			{ role: 'user', content: msg },
		]
		try {
			let reply = await chatAnswer(messages, { useFtIfAvailable: true })
			if (greeted) reply = `${greetText}\n${reply}`
			return res.json({ reply, items: [] })
		} catch (e) {
			let reply = '지금은 답변을 가져오지 못했어요. 나중에 다시 시도해 주세요.'
			if (greeted) reply = `${greetText}\n${reply}`
			return res.json({ reply, items: [] })
		}
	})

	return router
}

module.exports = buildChatRoutes // 라우터를 익스포트 (중요)
