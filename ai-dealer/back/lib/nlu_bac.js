// back/lib/nlu.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음

function parseNumberKR(s) {
	const text = String(s)
	const m1 = text.match(/(\d+(?:\.\d+)?)\s*천?만\s*원?/i)
	if (m1) return Math.round(parseFloat(m1[1]) * 100)
	const m2 = text.match(/월\s*(\d+(?:\.\d+)?)\s*만\s*원?/i)
	if (m2) return { monthlyMax: Math.round(parseFloat(m2[1])) }
	return null
}

function parseMileageKR(s) {
	const t = String(s)

	// 허용 오차 설정
	const TOL_DEFAULT = 0.2 // 내외/전후/정도/쯤/안팎 등
	const TOL_ZZARI = 0.1 // "짜리"는 좀 더 타이트

	// 숫자 추출 유틸: "2만5천" | "2.5만" | "2만" | "5천"
	function extractKoreanNumberToKm(text) {
		// 2만5천
		let m = text.match(/(\d+)\s*만\s*(\d+)\s*천(?:\s*(?:km|키로|킬로))?/i)
		if (m) return Number(m[1]) * 10000 + Number(m[2]) * 1000

		// 2.5만
		m = text.match(/(\d+(?:\.\d+)?)\s*만(?:\s*(?:km|키로|킬로))?/i)
		if (m) return Math.round(parseFloat(m[1]) * 10000)

		// 5천
		m = text.match(/(\d+)\s*천(?:\s*(?:km|키로|킬로))?/i)
		if (m) return Number(m[1]) * 1000

		// 25,000km | 25000 km
		m = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:km|키로|킬로)\b/i)
		if (m) return parseInt(m[1].replace(/,/g, ''), 10)

		// "만키로" 같은 경우: 숫자 없이 만 단위만 쓰인 케이스
		if (/[^0-9]만\s*(?:km|키로|킬로)?/i.test(text)) return 10000

		// 흔한 축약: 30k, 30k m
		m = text.match(/(\d+(?:\.\d+)?)\s*k(?:m)?\b/i)
		if (m) return Math.round(parseFloat(m[1]) * 1000)

		return null
	}

	// 텍스트에서 가장 그럴듯한 숫자 하나 선택
	// 우선순위: "키로/km"에 붙은 수치 > 만/천 조합 > 기타
	let baseKm = null
	// 1) km/키로와 붙은 수치
	let m1 = t.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:km|키로|킬로)\b/i)
	if (m1) baseKm = parseInt(m1[1].replace(/,/g, ''), 10)
	// 2) 만/천 조합
	if (baseKm == null) {
		const km2 = extractKoreanNumberToKm(t)
		if (km2 != null) baseKm = km2
	}
	if (baseKm == null) return {} // 숫자를 못 찾으면 미해석

	// 근사/부등호 키워드 탐지
	const hasApprox = /(내외|전후|정도|쯤|가량|안팎|근처|언저리|대략|약|한)\b/i.test(t) || /짜리\b/.test(t)
	const approxTol = /짜리\b/.test(t) ? TOL_ZZARI : TOL_DEFAULT

	const hasLE = /(이하|이내|미만|최대|까지)\b/i.test(t)
	const hasGE = /(이상|초과|부터)\b/i.test(t)

	// 우선순위: 근사 > 부등호
	if (hasApprox) {
		const minKm = Math.max(0, Math.floor(baseKm * (1 - approxTol)))
		const maxKm = Math.ceil(baseKm * (1 + approxTol))
		return { mileageMin: minKm, mileageMax: maxKm, mileageApprox: baseKm }
	}
	if (hasLE && hasGE) {
		// "2만 이상 3만 이하"처럼 양쪽이 모두 있을 수 있음
		// 좌우를 각각 따로 잡는 것은 복잡하니, 보수적으로 중심±10% 범위로 처리
		const tol = 0.1
		return {
			mileageMin: Math.max(0, Math.floor(baseKm * (1 - tol))),
			mileageMax: Math.ceil(baseKm * (1 + tol)),
			mileageApprox: baseKm,
		}
	}
	if (hasLE) return { mileageMax: baseKm }
	if (hasGE) return { mileageMin: baseKm }

	// 아무 수식어도 없으면 보수적으로 최대값으로 취급
	return { mileageMax: baseKm }
}

function parseFuel(s) {
	if (/디젤|diesel/i.test(s)) return 'diesel'
	if (/가솔린|휘발유|gasoline|petrol/i.test(s)) return 'gasoline'
	if (/하이브리드|hybrid/i.test(s)) return 'hybrid'
	if (/전기|ev|electric/i.test(s)) return 'ev'
	if (/lpg/i.test(s)) return 'lpg'
	return undefined
}

function parseBody(s) {
	const t = String(s)
	if (/suv/i.test(t)) return 'suv'
	if (/세단|sedan/i.test(t)) return 'sedan'
	if (/해치|hatch/i.test(t)) return 'hatch'
	if (/밴|승합|van/i.test(t)) return 'van'
	if (/트럭|truck/i.test(t)) return 'truck'
	return undefined
}

function parseSegment(s) {
	const t = String(s)
	if (/중형|midsize|d-?seg/i.test(t)) return 'midsize'
	if (/준중형|compact|c-?seg/i.test(t)) return 'compact'
	if (/대형|full\s*size|e-?seg|f-?seg/i.test(t)) return 'fullsize'
	if (/소형|sub\s*compact|b-?seg/i.test(t)) return 'subcompact'
	if (/경차|a-?seg/i.test(t)) return 'mini'
	return undefined
}

function parseBudgetKR(text) {
	const t = String(text)

	// 월 부담은 명확한 '월' 키워드가 있을 때만
	const mMonth = t.match(/월\s*(\d+(?:\.\d+)?)\s*만\s*원?/i)
	if (mMonth) return { monthlyMax: Math.round(parseFloat(mMonth[1])) }

	// 가격 맥락 없으면 예산 파싱 비활성화
	const hasPriceContext = /(원|만원|예산|가격|금액|차값|가격대)/i.test(t)
	if (!hasPriceContext) return null

	// 총액: '천만 원', '1500만 원' 등만 허용 (키로/km와 혼동 방지)
	// '원' 표기가 있거나 '만원'이 명시된 케이스만 잡는다.
	let m = t.match(/(\d+(?:\.\d+)?)\s*천?만\s*원\b/i)
	if (m) return Math.round(parseFloat(m[1]) * 100)

	m = t.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*만\s*원\b/i)
	if (m) return parseInt(m[1].replace(/,/g, ''), 10)

	// 맥락 단어가 있으면서 '원'이 빠진 형태(예: "예산 2천만")만 추가 허용
	m = t.match(/(?:예산|가격|금액|차값|가격대)\s*(\d+(?:\.\d+)?)\s*천?만\b/i)
	if (m) return Math.round(parseFloat(m[1]) * 100)

	return null
}

function parseIntent(raw) {
	const text = String(raw ?? '')

	const buyLike = /(사고|추천|알려|고르|구매|좀|찾아|고민)/i.test(text)
	const sellLike = /(판매|팔|매입|견적|시세)/i.test(text)

	// 예산/월부담은 parseBudgetKR로만
	const budgetParsed = parseBudgetKR(text)
	let budgetMax
	let monthlyMax
	if (typeof budgetParsed === 'number') budgetMax = budgetParsed
	else if (budgetParsed && typeof budgetParsed === 'object') {
		if (typeof budgetParsed.budgetMax === 'number') budgetMax = budgetParsed.budgetMax
		if (typeof budgetParsed.monthlyMax === 'number') monthlyMax = budgetParsed.monthlyMax
	}

	// 나머지 파서(주행/연료/차종/세그 등)는 그대로 유지
	const { mileageMin, mileageMax, mileageApprox } = parseMileageKR(text) // 기존 함수
	const fuelType = parseFuel(text)
	const bodyType = parseBody(text)
	const segment = parseSegment(text)
	const bodyFromComposite = /중형\s*세단|세단\s*중형/i.test(text) ? 'sedan' : undefined

	return {
		kind: sellLike ? 'sell' : buyLike ? 'buy' : 'chitchat',
		budgetMax,
		monthlyMax,
		mileageMin,
		mileageMax,
		mileageApprox,
		fuelType,
		bodyType: bodyFromComposite || bodyType,
		segment,
	}
}

module.exports = { parseIntent }
