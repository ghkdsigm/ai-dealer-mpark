// NOTE: 코드 주석에 이모티콘은 사용하지 않음

// -------------------------
// 유틸
// -------------------------
function hasNumber(x) {
	return typeof x === 'number' && Number.isFinite(x)
}
function clamp01(x) {
	return Math.max(0, Math.min(1, x))
}
function strEq(a, b) {
	return String(a || '').toLowerCase() === String(b || '').toLowerCase()
}
function includesCI(s, sub) {
	return String(s || '')
		.toLowerCase()
		.includes(String(sub || '').toLowerCase())
}

// 코사인 유사도
function cosine(a, b) {
	let dot = 0,
		na = 0,
		nb = 0
	const L = Math.min(a.length, b.length)
	for (let i = 0; i < L; i++) {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	if (!na || !nb) return 0
	return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// TF-IDF 헬퍼 (weightsModel: { vocab, idf })
function makeTfidf(weightsModel) {
	if (!weightsModel || !Array.isArray(weightsModel.vocab) || !Array.isArray(weightsModel.idf)) {
		return {
			textToVec: () => [],
			tokenize: s =>
				String(s || '')
					.toLowerCase()
					.split(/\s+/)
					.filter(Boolean),
		}
	}
	const { vocab, idf } = weightsModel
	const tok2idx = new Map(vocab.map((w, i) => [w, i]))
	function tokenize(s) {
		return String(s || '')
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, ' ')
			.split(/\s+/)
			.filter(Boolean)
	}
	function textToVec(text) {
		const tf = new Array(vocab.length).fill(0)
		const toks = tokenize(text)
		for (const t of toks) {
			const i = tok2idx.get(t)
			if (i !== undefined) tf[i] += 1
		}
		const maxTf = Math.max(1, ...tf)
		for (let i = 0; i < tf.length; i++) tf[i] = (tf[i] / maxTf) * idf[i]
		return tf
	}
	return { textToVec, tokenize }
}

// -------------------------
// 필터
// -------------------------
function ruleFilter(list, intent) {
	let out = Array.isArray(list) ? list : []

	if (intent.make) out = out.filter(v => v.make && includesCI(v.make, intent.make))
	if (intent.model) out = out.filter(v => v.model && includesCI(v.model, intent.model))
	if (intent.fuelType) out = out.filter(v => v.fuelType && strEq(v.fuelType, intent.fuelType))
	if (intent.bodyType) out = out.filter(v => v.bodyType && strEq(v.bodyType, intent.bodyType))
	if (intent.segment) out = out.filter(v => v.segment && strEq(v.segment, intent.segment))
	if (intent.transmission) out = out.filter(v => v.transmission && strEq(v.transmission, intent.transmission))

	if (typeof intent.noAccident === 'boolean')
		out = out.filter(v => typeof v.noAccident === 'boolean' && v.noAccident === intent.noAccident)

	// 예산: v.price는 만원 단위 가정
	if (hasNumber(intent.budgetMin)) out = out.filter(v => hasNumber(v.price) && v.price >= intent.budgetMin)
	if (hasNumber(intent.budgetMax)) out = out.filter(v => hasNumber(v.price) && v.price <= intent.budgetMax)

	// 월부담
	if (hasNumber(intent.monthlyMin))
		out = out.filter(v => hasNumber(v.monthlyPrice) && v.monthlyPrice >= intent.monthlyMin)
	if (hasNumber(intent.monthlyMax))
		out = out.filter(v => hasNumber(v.monthlyPrice) && v.monthlyPrice <= intent.monthlyMax)

	// 주행
	if (hasNumber(intent.kmMin)) out = out.filter(v => hasNumber(v.km) && v.km >= intent.kmMin)
	if (hasNumber(intent.kmMax)) out = out.filter(v => hasNumber(v.km) && v.km <= intent.kmMax)

	// 연식
	if (hasNumber(intent.yearMin)) out = out.filter(v => hasNumber(v.year) && v.year >= intent.yearMin)
	if (hasNumber(intent.yearMax)) out = out.filter(v => hasNumber(v.year) && v.year <= intent.yearMax)
	if (hasNumber(intent.yearExact)) out = out.filter(v => hasNumber(v.year) && v.year === intent.yearExact)

	return out
}

// 조건 완화: 방향 유지
function filterWithRelaxation(list, intent) {
	const used = { ...intent }
	const relaxed = []
	let out = ruleFilter(list, used)

	// 주행 방향 유지
	if (out.length === 0 && hasNumber(used.kmMin) && !hasNumber(used.kmMax)) {
		used.kmMin = Math.max(0, Math.floor(used.kmMin * 0.9))
		relaxed.push('kmMin-10%')
		out = ruleFilter(list, used)
	}
	if (out.length === 0 && hasNumber(used.kmMax) && !hasNumber(used.kmMin)) {
		used.kmMax = Math.ceil(used.kmMax * 1.1)
		relaxed.push('kmMax+10%')
		out = ruleFilter(list, used)
	}
	if (out.length === 0 && hasNumber(used.kmMin) && hasNumber(used.kmMax)) {
		used.kmMin = Math.max(0, Math.floor(used.kmMin * 0.9))
		used.kmMax = Math.ceil(used.kmMax * 1.1)
		relaxed.push('km±10%')
		out = ruleFilter(list, used)
	}

	// 예산
	if (out.length === 0 && hasNumber(used.budgetMax)) {
		used.budgetMax = Math.ceil(used.budgetMax * 1.1)
		relaxed.push('budgetMax+10%')
		out = ruleFilter(list, used)
	}
	if (out.length === 0 && hasNumber(used.budgetMin)) {
		used.budgetMin = Math.max(0, Math.floor(used.budgetMin * 0.9))
		relaxed.push('budgetMin-10%')
		out = ruleFilter(list, used)
	}

	// 연식
	if (out.length === 0 && hasNumber(used.yearMin)) {
		used.yearMin = Math.max(1990, used.yearMin - 1)
		relaxed.push('yearMin-1')
		out = ruleFilter(list, used)
	}
	if (out.length === 0 && hasNumber(used.yearMax)) {
		used.yearMax = used.yearMax + 1
		relaxed.push('yearMax+1')
		out = ruleFilter(list, used)
	}

	// 카테고리 느슨화
	for (const key of ['segment', 'fuelType', 'bodyType', 'transmission', 'make', 'model', 'noAccident']) {
		if (out.length === 0 && used[key] !== undefined) {
			delete used[key]
			relaxed.push(key)
			out = ruleFilter(list, used)
		}
	}

	return { candidates: out, usedIntent: used, relaxed }
}

// -------------------------
// 랭킹
// -------------------------

// 랭킹 가중치 기본값 (index.js에서 weights.json으로 덮어씀)
const DEFAULT_W = {
	tfidf: 0.5, // 질의-텍스트 유사도
	intentMatch: 0.2, // 카테고리 정합
	price: 0.12, // 예산 근접도
	km: 0.12, // 주행 근접도
	year: 0.06, // 연식 근접도
	diversityPenalty: 0.12, // 제조사 중복 페널티
}

function getW(userW) {
	// index.js에서 getWeights()가 반환하는 객체를 기대
	// userW가 비어있거나 숫자 키가 없으면 DEFAULT_W 사용
	return { ...DEFAULT_W, ...(userW || {}) }
}

function rankVehicles(list, intent, query, weightsModelOrW) {
	const items = Array.isArray(list) ? list.slice() : []
	if (!items.length) return []

	// weightsModelOrW에는 두 가지 케이스가 올 수 있음:
	// 1) TF-IDF 학습 결과( { vocab, idf, heads? } )
	// 2) 랭킹 가중치 맵( { tfidf, price, ... } )
	// 둘 다 올 가능성도 있으니, 구분해서 사용
	const tfidf = makeTfidf(weightsModelOrW && weightsModelOrW.vocab ? weightsModelOrW : null)
	const W = getW(weightsModelOrW && !weightsModelOrW.vocab ? weightsModelOrW : null)

	// 쿼리 벡터
	const qVec = tfidf.textToVec(query || '')

	// 관측 통계(정규화에 사용)
	const miles = items.filter(v => hasNumber(v.km)).map(v => v.km)
	const years = items.filter(v => hasNumber(v.year)).map(v => v.year)
	const prices = items.filter(v => hasNumber(v.price)).map(v => v.price)
	const minM = miles.length ? Math.min(...miles) : 0
	const maxM = miles.length ? Math.max(...miles) : 1
	const minY = years.length ? Math.min(...years) : 2000
	const maxY = years.length ? Math.max(...years) : new Date().getFullYear()
	const minP = prices.length ? Math.min(...prices) : 0
	const maxP = prices.length ? Math.max(...prices) : 1
	const BUDGET_STEP_MAN = 100 // 100만원
	const BUDGET_MAX_MAN = 100_000 // 10억

	function pickBudgetBucket(manPrice, labelSpace) {
		const p = Number(manPrice) || 0
		if (p <= 0) return 0
		const idx = Math.min(labelSpace.budget.length - 1, Math.max(0, Math.ceil(p / BUDGET_STEP_MAN) - 1))
		return idx
	}

	function priceCloseness(v) {
		if (!hasNumber(v.price)) return 0
		if (hasNumber(intent.budgetMin) && hasNumber(intent.budgetMax)) {
			// 범위 중심 근접
			const c = (intent.budgetMin + intent.budgetMax) / 2
			const span = Math.max(1, intent.budgetMax - intent.budgetMin)
			return clamp01(1 - Math.abs(v.price - c) / span)
		}
		if (hasNumber(intent.budgetMax)) {
			// 상한 이하일수록 가점, 상한에 가까울수록 최고점
			return clamp01(1 - (intent.budgetMax - v.price) / Math.max(1, intent.budgetMax - minP))
		}
		if (hasNumber(intent.budgetMin)) {
			// 하한 이상일수록 가점, 하한에 가까울수록 최고점
			return clamp01(1 - (v.price - intent.budgetMin) / Math.max(1, maxP - intent.budgetMin))
		}
		return 0
	}

	function kmCloseness(v) {
		if (!hasNumber(v.km)) return 0
		if (hasNumber(intent.kmMin) && hasNumber(intent.kmMax)) {
			const c = (intent.kmMin + intent.kmMax) / 2
			const span = Math.max(1, intent.kmMax - intent.kmMin)
			return clamp01(1 - Math.abs(v.km - c) / span)
		}
		if (hasNumber(intent.kmMax)) {
			// 낮을수록 가점, 0~kmMax 사이 정규화
			return clamp01(1 - v.km / Math.max(1, intent.kmMax))
		}
		if (hasNumber(intent.kmMin)) {
			// 높을수록 가점, kmMin~maxM 사이 정규화
			return clamp01((v.km - intent.kmMin) / Math.max(1, maxM - intent.kmMin))
		}
		return 0
	}

	function yearCloseness(v) {
		if (!hasNumber(v.year)) return 0
		if (hasNumber(intent.yearMin) && hasNumber(intent.yearMax)) {
			const c = (intent.yearMin + intent.yearMax) / 2
			const span = Math.max(1, intent.yearMax - intent.yearMin)
			return clamp01(1 - Math.abs(v.year - c) / span)
		}
		if (hasNumber(intent.yearMax)) {
			// 최신에 가까울수록 가점
			return clamp01((v.year - minY) / Math.max(1, intent.yearMax - minY))
		}
		if (hasNumber(intent.yearMin)) {
			// 최근일수록 가점
			return clamp01((v.year - intent.yearMin) / Math.max(1, maxY - intent.yearMin))
		}
		return 0
	}

	function intentMatch(v) {
		let s = 0,
			cnt = 0
		if (intent.bodyType) {
			cnt++
			if (v.bodyType && strEq(v.bodyType, intent.bodyType)) s++
		}
		if (intent.fuelType) {
			cnt++
			if (v.fuelType && strEq(v.fuelType, intent.fuelType)) s++
		}
		if (intent.segment) {
			cnt++
			if (v.segment && strEq(v.segment, intent.segment)) s++
		}
		if (intent.transmission) {
			cnt++
			if (v.transmission && strEq(v.transmission, intent.transmission)) s++
		}
		if (intent.make) {
			cnt++
			if (v.make && includesCI(v.make, intent.make)) s++
		}
		if (intent.model) {
			cnt++
			if (v.model && includesCI(v.model, intent.model)) s++
		}
		if (typeof intent.noAccident === 'boolean') {
			cnt++
			if (typeof v.noAccident === 'boolean' && v.noAccident === intent.noAccident) s++
		}
		return cnt ? s / cnt : 0
	}

	// 스코어링 원시값
	const prelim = items.map(v => {
		const doc = [
			v.carName || '',
			v.make || '',
			v.model || '',
			v.bodyType || '',
			v.fuelType || '',
			v.segment || '',
			hasNumber(v.year) ? String(v.year) : '',
			...(Array.isArray(v.tags) ? v.tags : []),
			...(Array.isArray(v.options) ? v.options : []),
		].join(' ')

		const vVec = tfidf.textToVec(doc)
		const sim = qVec.length && vVec.length ? cosine(qVec, vVec) : 0

		const ms = intentMatch(v)
		const ps = priceCloseness(v)
		const ks = kmCloseness(v)
		const ys = yearCloseness(v)

		// 선형 결합
		const score = W.tfidf * sim + W.intentMatch * ms + W.price * ps + W.km * ks + W.year * ys
		return { v, sim, ms, ps, ks, ys, score }
	})

	// 제조사 다양성 페널티 적용하며 상위 선택
	const seen = new Map()
	const penalty = Number(W.diversityPenalty) || 0
	const pool = prelim.slice()

	const out = []
	while (pool.length) {
		// 동적 점수
		pool.sort((a, b) => {
			const pa = a.score - (seen.get(a.v.make) || 0) * penalty
			const pb = b.score - (seen.get(b.v.make) || 0) * penalty
			return pb - pa
		})
		const pick = pool.shift()
		out.push(pick.v)
		seen.set(pick.v.make, (seen.get(pick.v.make) || 0) + 1)
		if (out.length >= 200) break // 충분히 추림
	}

	return out
}

module.exports = {
	ruleFilter,
	filterWithRelaxation,
	rankVehicles,
	DEFAULT_W,
}
