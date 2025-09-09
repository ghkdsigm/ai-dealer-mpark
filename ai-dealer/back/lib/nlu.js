// back/lib/nlu_kr.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음

const NOW_YEAR = new Date().getFullYear()

const LEX = {
	approx: /(내외|전후|정도|쯤|가량|안팎|근처|언저리|대략|약|한|짜리)\b/i,
	le: /(이하|이내|미만|최대|까지)\b/i,
	ge: /(이상|초과|부터)\b/i,
	priceCtx: /(원|만원|억|예산|가격|금액|차값|가격대)/i,
	monthCtx: /월/i,

	fuel: {
		diesel: /디젤|diesel/i,
		gasoline: /가솔린|휘발유|gasoline|petrol/i,
		hybrid: /하이브리드|hybrid/i,
		ev: /전기|전동|ev|electric/i,
		lpg: /lpg|엘피지/i,
	},

	body: {
		suv: /\bsuv\b|스유브|스포티지|투싼/i, // suv 키워드 우선
		sedan: /세단|sedan/i,
		hatch: /해치|hatch|해치백/i,
		van: /밴|승합|van/i,
		truck: /트럭|truck/i,
		wagon: /왜건|wagon/i,
		coupe: /쿠페|coupe/i,
	},

	segment: {
		midsize: /중형|midsize|d-?seg/i,
		compact: /준중형|compact|c-?seg/i,
		fullsize: /대형|full\s*size|e-?seg|f-?seg/i,
		subcompact: /소형|sub\s*compact|b-?seg/i,
		mini: /경차|a-?seg/i,
	},

	transmission: {
		auto: /자동|오토/i,
		manual: /수동|manual/i,
	},

	// 단색과 그룹을 같이 다룸
	color: {
		black: /검정|블랙|까만/i,
		white: /흰|화이트|하양/i,
		silver: /은색|실버/i,
		gray: /회색|그레이|쥐색/i,
		blue: /파랑|블루/i,
		red: /빨강|레드/i,
		green: /초록|그린/i,
		brown: /갈색|브라운/i,
		gold: /골드|금색/i,
		yellow: /노랑|옐로/i,
		orange: /오렌지|주황/i,
		purple: /보라|퍼플/i,
		dark: /어두운\s*색|진한\s*색|다크/i,
		bright: /밝은\s*색|라이트/i,
	},

	accident: {
		noAccident: /무사고|사고\s*없|사고이력\s*없/i,
		hasAccident: /사고차|사고\s*있|사고이력\s*있/i,
	},
}

// 한국어 숫자 → 정수 (억/만/천/백/십 지원)
function koNumberToInt(text) {
	const t = String(text).trim()
	// 섞임 방지용: 공백 제거
	const s = t.replace(/\s+/g, '')
	// 한글 숫자 사전
	const digit = {
		영: 0,
		공: 0,
		일: 1,
		이: 2,
		삼: 3,
		사: 4,
		오: 5,
		육: 6,
		칠: 7,
		팔: 8,
		구: 9,
		십: 10,
		백: 100,
		천: 1000,
	}
	function parseBlock(u) {
		// 만 미만 블록
		let val = 0,
			tmp = 0,
			seen = false
		const re = /(일|이|삼|사|오|육|칠|팔|구)?(천|백|십)?/g
		// 간단 파서: 천/백/십 순서로
		const map = { 천: 1000, 백: 100, 십: 10 }
		let rest = u
		// 천,백,십
		for (const k of ['천', '백', '십']) {
			const m = rest.match(new RegExp(`(일|이|삼|사|오|육|칠|팔|구)?${k}`))
			if (m) {
				const n = m[1] ? digit[m[1]] : 1
				val += n * map[k]
				rest = rest.replace(m[0], '')
				seen = true
			}
		}
		// 일의 자리
		if (rest) {
			let n = 0
			if (/^\d+$/.test(rest)) n = parseInt(rest, 10)
			else n = digit[rest] ?? 0
			val += n
			seen = true
		}
		if (!seen && /^\d+$/.test(u)) return parseInt(u, 10)
		return val
	}
	// "억"과 "만"으로 분해
	let total = 0
	const mEok = s.split('억')
	if (mEok.length > 1) {
		const left = mEok[0]
		const right = mEok.slice(1).join('억') // 이후에 또 "억"이 있으면 이어붙임
		total += (left ? koNumberToInt(left) : 0) * 100000000
		return total + (right ? koNumberToInt(right) : 0)
	}
	const mMan = s.split('만')
	if (mMan.length > 1) {
		const left = mMan[0]
		const right = mMan.slice(1).join('만')
		total += (left ? koNumberToInt(left) : 0) * 10000
		return total + (right ? koNumberToInt(right) : 0)
	}
	// "천오백" 같은 형태 처리
	return parseBlock(s)
}

// 숫자 토큰 추출 유틸: "2만5천", "2.5만", "25,000km", "30k", "만키로"
function extractKm(text) {
	const t = String(text)
	let m = t.match(/(\d+)\s*만\s*(\d+)\s*천(?:\s*(?:km|키로|킬로))?/i)
	if (m) return Number(m[1]) * 10000 + Number(m[2]) * 1000
	m = t.match(/(\d+(?:\.\d+)?)\s*만(?:\s*(?:km|키로|킬로))?/i)
	if (m) return Math.round(parseFloat(m[1]) * 10000)
	m = t.match(/(\d+)\s*천(?:\s*(?:km|키로|킬로))?/i)
	if (m) return Number(m[1]) * 1000
	m = t.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:km|키로|킬로)\b/i)
	if (m) return parseInt(m[1].replace(/,/g, ''), 10)
	if (/[^0-9]만\s*(?:km|키로|킬로)?\b/i.test(t)) return 10000
	m = t.match(/(\d+(?:\.\d+)?)\s*k(?:m)?\b/i)
	if (m) return Math.round(parseFloat(m[1]) * 1000)
	// "3만키로짜리" 같이 단위 없이 '짜리'
	if (/짜리\b/i.test(t)) {
		const n = t.match(/([0-9,]+)/) ? parseInt(t.match(/([0-9,]+)/)[1].replace(/,/g, ''), 10) : null
		if (n != null) return n
		// 한글 숫자
		const word = t.match(/[가-힣]+/g)?.join('') || ''
		const k = koNumberToInt(word)
		if (k) return k
	}
	// 한글 숫자 + 키워드 맥락
	if (/(키로|킬로|주행)/i.test(t)) {
		const pure = t.replace(/[^\d가-힣]/g, '')
		const k = koNumberToInt(pure)
		if (k) return k
	}
	return null
}

// 가격: 만원 단위로 반환
function normalizePriceToManWon(value, unitHint) {
	// value는 원 단위일 수도 있고 문자열일 수도 있음
	const n = typeof value === 'number' ? value : koNumberToInt(String(value))
	if (!Number.isFinite(n)) return null
	if (unitHint === 'man') return n // 이미 만원
	if (unitHint === 'won') return Math.round(n / 10000)
	if (unitHint === 'eok') return n * 10000
	// 힌트 없으면 숫자 규모로 추정
	if (n >= 100000000) return Math.round(n / 10000) // 원 단위 1억 이상
	if (n <= 50000) return n // 만원 단위로 본다
	return Math.round(n / 10000)
}

// “300만원대” → [300, 399], “2천만대” → [2000, 2099]
function priceBand(man) {
	const base = Math.max(0, Math.floor(man))
	return { min: base, max: base + 99 }
}

function parseBudget(text) {
	const t = String(text)
	const hasPrice = LEX.priceCtx.test(t)
	const approx = LEX.approx.test(t)
	const le = LEX.le.test(t)
	const ge = LEX.ge.test(t)
  
	// 월 부담
	const mMon = t.match(/월\s*([0-9,]+|\d+(?:\.\d+)?|[가-힣]+)\s*만\s*원?/i)
	if (mMon) {
	  const v = mMon[1].match(/[0-9,]/) ? parseFloat(mMon[1].replace(/,/g, '')) : koNumberToInt(mMon[1])
	  if (Number.isFinite(v)) {
		const val = Math.round(v)
		if (le && ge) return { monthlyMin: Math.max(0, Math.floor(val * 0.9)), monthlyMax: Math.ceil(val * 1.1) }
		if (ge) return { monthlyMin: val }
		return { monthlyMax: val }
	  }
	}
  
	// 가격 맥락이 없을 때의 축약형 처리
	if (!hasPrice) {
	  // km/연식 맥락이 없고 '억|천|만'이 있으면 가격으로 간주
	  if (!/(km|키로|킬로|주행|연식|년)/i.test(t) && /(억|천|만)/.test(t)) {
		// 1) 'N천만' / 'N천' → 만원 단위로 n*1000
		let m = t.match(/(\d+(?:\.\d+)?)\s*천\s*만?/i)
		if (m) return { budgetMax: Math.round(parseFloat(m[1]) * 1000) }
		// 2) 'N만' → 만원 단위 그대로
		m = t.match(/(\d+(?:\.\d+)?)\s*만(?!\s*(?:km|키로|킬로))/i)
		if (m) return { budgetMax: Math.round(parseFloat(m[1])) }
		// 3) 'N억' → 억을 만원 단위로
		m = t.match(/(\d+(?:\.\d+)?)\s*억/i)
		if (m) return { budgetMax: Math.round(parseFloat(m[1]) * 10000) }
		// 4) 그 외 숫자만 있을 때는 해석 보류
	  }
	  return {}
	}
  
	// 명시적 단위가 있는 일반 케이스
	let unitHint = null
	if (/억/.test(t)) unitHint = 'eok'
	else if (/만\s*원|만원/.test(t)) unitHint = 'man'
	else if (/원/.test(t)) unitHint = 'won'
  
	// A ~ B
	const mRange = t.match(/([0-9,]+|[가-힣]+)\s*(억|만|원)?\s*[~\-–]\s*([0-9,]+|[가-힣]+)\s*(억|만|원)?/i)
	if (mRange) {
	  const [ , a, ua, b, ub ] = mRange
	  const vA = normalizePriceToManWon(a, ua === '억' ? 'eok' : ua === '만' ? 'man' : ua === '원' ? 'won' : unitHint)
	  const vB = normalizePriceToManWon(b, ub === '억' ? 'eok' : ub === '만' ? 'man' : ub === '원' ? 'won' : unitHint)
	  if (Number.isFinite(vA) && Number.isFinite(vB)) {
		const min = Math.min(vA, vB), max = Math.max(vA, vB)
		return { budgetMin: min, budgetMax: max }
	  }
	}
  
	// “N만원대”
	const mBand = t.match(/([0-9,]+|[가-힣]+)\s*만?\s*원?\s*대\b/i)
	if (mBand) {
	  const v = normalizePriceToManWon(mBand[1], 'man')
	  if (Number.isFinite(v)) {
		const { min, max } = priceBand(v)
		return { budgetMin: min, budgetMax: max }
	  }
	}
  
	// 단일 값
	const mSingle =
	  t.match(/([0-9,]+|[가-힣]+)\s*(억|만|원)\b/i) || t.match(/(?:예산|가격|금액|차값|가격대)\s*([0-9,]+|[가-힣]+)/i)
	if (mSingle) {
	  const val = normalizePriceToManWon(
		mSingle[1],
		mSingle[2] === '억' ? 'eok' : mSingle[2] === '만' ? 'man' : mSingle[2] === '원' ? 'won' : unitHint,
	  )
	  if (Number.isFinite(val)) {
		if (approx || (le && ge)) return { budgetMin: Math.max(0, Math.floor(val * 0.9)), budgetMax: Math.ceil(val * 1.1) }
		if (ge) return { budgetMin: val }
		return { budgetMax: val }
	  }
	}
	return {}
  }

function parseMileage(s) {
	const t = String(s)
  
	// km 단위 토큰 필요
	const hasKmToken = /(km|키로|킬로|주행|주행거리)\b/i.test(t)
	if (!hasKmToken) return {} // 단위 없으면 주행 해석 중단
  
	function extractKoreanNumberToKm(text) {
	  // 2만5천 km
	  let m = text.match(/(\d+)\s*만\s*(\d+)\s*천\s*(?:km|키로|킬로)\b/i)
	  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 1000
	  // 2.5만 km
	  m = text.match(/(\d+(?:\.\d+)?)\s*만\s*(?:km|키로|킬로)\b/i)
	  if (m) return Math.round(parseFloat(m[1]) * 10000)
	  // 5천 km
	  m = text.match(/(\d+)\s*천\s*(?:km|키로|킬로)\b/i)
	  if (m) return Number(m[1]) * 1000
	  // 25,000km | 25000 km
	  m = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:km|키로|킬로)\b/i)
	  if (m) return parseInt(m[1].replace(/,/g, ''), 10)
	  // 30k
	  m = text.match(/(\d+(?:\.\d+)?)\s*k(?:m)?\b/i)
	  if (m) return Math.round(parseFloat(m[1]) * 1000)
	  // "만키로"
	  if (/\b만\s*(?:km|키로|킬로)\b/i.test(text)) return 10000
	  return null
	}
  
	const baseKm = extractKoreanNumberToKm(t)
	if (baseKm == null) return {}
  
	const hasApprox = /(내외|전후|정도|쯤|가량|안팎|근처|언저리|대략|약|한|짜리)\b/i.test(t)
	const hasLE = /(이하|이내|미만|최대|까지)\b/i.test(t)
	const hasGE = /(이상|초과|부터)\b/i.test(t)
  
	if (hasApprox) {
	  const tol = /짜리\b/i.test(t) ? 0.1 : 0.2
	  return {
		mileageMin: Math.max(0, Math.floor(baseKm * (1 - tol))),
		mileageMax: Math.ceil(baseKm * (1 + tol)),
		mileageApprox: baseKm,
	  }
	}
	if (hasLE && hasGE) {
	  const tol = 0.1
	  return {
		mileageMin: Math.max(0, Math.floor(baseKm * (1 - tol))),
		mileageMax: Math.ceil(baseKm * (1 + tol)),
		mileageApprox: baseKm,
	  }
	}
	if (hasLE) return { mileageMax: baseKm }
	if (hasGE) return { mileageMin: baseKm }
	return { mileageMax: baseKm }
  }

function parseYear(text) {
	const t = String(text)
	// 2016년식, 15년식/년형
	const mFull = t.match(/(20\d{2}|19\d{2})\s*년\s*(식|형)?/i)
	if (mFull) {
		const y = parseInt(mFull[1], 10)
		const le = LEX.le.test(t),
			ge = LEX.ge.test(t)
		if (le && ge) return { yearMin: y - 1, yearMax: y + 1 }
		if (ge) return { yearMin: y }
		if (le) return { yearMax: y }
		return { yearExact: y }
	}
	const m2d = t.match(/(\d{2})\s*년\s*(식|형)?/i)
	if (m2d) {
		let yy = parseInt(m2d[1], 10)
		const y = yy < 30 ? 2000 + yy : 1900 + yy
		const le = LEX.le.test(t),
			ge = LEX.ge.test(t)
		if (le && ge) return { yearMin: y - 1, yearMax: y + 1 }
		if (ge) return { yearMin: y }
		if (le) return { yearMax: y }
		return { yearExact: y }
	}
	// 20년대
	const mDec = t.match(/(20|19)?(\d)0\s*년\s*대/i) || t.match(/(\d{2})\s*년\s*대/i)
	if (mDec) {
		let tens = mDec[1] && mDec[2] ? parseInt(`${mDec[1]}${mDec[2]}0`, 10) : parseInt(mDec[1] || mDec[0], 10)
		let y0
		if (String(tens).length === 2) y0 = (tens < 30 ? 2000 : 1900) + tens
		else if (String(tens).length === 3) y0 = tens
		else y0 = 2000 // 기본
		return { yearMin: y0, yearMax: y0 + 9 }
	}
	// 신형/구형
	if (/신형|최신/i.test(t)) return { yearMin: NOW_YEAR - 3 }
	if (/구형|올드/i.test(t)) return { yearMax: NOW_YEAR - 8 }
	// 이후/이전만 있을 때 숫자
	const mRel = t.match(/(20\d{2}|19\d{2}|\d{2})\s*년\s*(이후|이전)/i)
	if (mRel) {
		const raw = mRel[1]
		const y =
			raw.length === 2
				? parseInt(raw, 10) < 30
					? 2000 + parseInt(raw, 10)
					: 1900 + parseInt(raw, 10)
				: parseInt(raw, 10)
		if (/이후/.test(mRel[2])) return { yearMin: y }
		return { yearMax: y }
	}
	return {}
}

function firstMatch(map, text) {
	for (const [k, r] of Object.entries(map)) if (r.test(text)) return k
	return undefined
}

function parseCategoricals(text) {
	const fuelType = firstMatch(LEX.fuel, text)
	const bodyType = firstMatch(LEX.body, text)
	const segment = firstMatch(LEX.segment, text)
	const transmission = firstMatch(LEX.transmission, text)

	// 색상: 단일 혹은 그룹
	const colors = []
	for (const [k, r] of Object.entries(LEX.color)) {
		if (r.test(text)) colors.push(k)
	}

	let noAccident
	if (LEX.accident.noAccident.test(text)) noAccident = true
	else if (LEX.accident.hasAccident.test(text)) noAccident = false

	return { fuelType, bodyType, segment, transmission, colors, noAccident }
}

// 카탈로그 기반 브랜드/모델 추출
function _norm(s) {
	return String(s || '')
	  .toLowerCase()
	  .replace(/[\s_/()-]+/g, '')
	  .replace(/[^a-z0-9가-힣]/g, '')
  }
  
  // Damerau-Levenshtein 간단 구현 (교체/삽입/삭제/전치 허용)
  function _edit(a, b) {
	const A = a.length, B = b.length
	if (!A || !B) return Math.max(A, B)
	const dp = Array.from({ length: A + 1 }, () => new Array(B + 1).fill(0))
	for (let i = 0; i <= A; i++) dp[i][0] = i
	for (let j = 0; j <= B; j++) dp[0][j] = j
	for (let i = 1; i <= A; i++) {
	  for (let j = 1; j <= B; j++) {
		const cost = a[i - 1] === b[j - 1] ? 0 : 1
		dp[i][j] = Math.min(
		  dp[i - 1][j] + 1,       // 삭제
		  dp[i][j - 1] + 1,       // 삽입
		  dp[i - 1][j - 1] + cost // 치환
		)
		if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
		  dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1) // 전치
		}
	  }
	}
	return dp[A][B]
  }
  
  function parseMakeModel(text, catalog = {}) {
	const tRaw = String(text || '')
	const t = _norm(tRaw)
  
	const makes = Array.isArray(catalog.makes) ? catalog.makes.filter(Boolean) : []
	// models는 재고에서 뽑은 "원문 모델명"(여러 단어 포함) 목록을 기대
	const models = Array.isArray(catalog.models) ? catalog.models.filter(Boolean) : []
  
	// 후보 풀: {raw, norm} 형태로 미리 정규화
	const normMakes = makes.map(mk => ({ raw: mk, norm: _norm(mk) }))
	const normModels = models.map(md => ({ raw: md, norm: _norm(md) }))
  
	// 1) 완전/부분 포함 매치 우선 (길이 가중치)
	let bestModel = null
	for (const md of normModels) {
	  if (!md.norm) continue
	  if (t.includes(md.norm) || md.norm.includes(t)) {
		const score = md.norm.length // 길이 길수록 더 구체적인 모델로 가정
		if (!bestModel || score > bestModel.score) bestModel = { model: md.raw, score }
	  }
	}
  
	// 2) 퍼지 매칭(오타 허용): edit distance ≤ 2, 길이 대비 정규화 점수
	if (!bestModel) {
	  let cand = null
	  for (const md of normModels) {
		if (!md.norm) continue
		const d = _edit(t, md.norm)
		const maxLen = Math.max(1, Math.max(t.length, md.norm.length))
		const sim = 1 - d / maxLen // 1에 가까울수록 유사
		if (d <= 2 && sim > 0.6) {
		  if (!cand || sim > cand.sim || (sim === cand.sim && md.norm.length > cand.len)) {
			cand = { model: md.raw, sim, len: md.norm.length }
		  }
		}
	  }
	  if (cand) bestModel = { model: cand.model, score: cand.sim * 100 }
	}
  
	// 브랜드는 모델이 정해지면 재고에서 역추론하는 게 가장 안전
	// 카탈로그가 brandByModel 맵을 제공하면 사용, 없으면 질의문에서도 추정
	let make
	if (bestModel && catalog.brandByModel && catalog.brandByModel[bestModel.model]) {
	  make = catalog.brandByModel[bestModel.model]
	} else {
	  let bestMake = null
	  for (const mk of normMakes) {
		if (!mk.norm) continue
		if (t.includes(mk.norm) || mk.norm.includes(t)) {
		  const score = mk.norm.length
		  if (!bestMake || score > bestMake.score) bestMake = { make: mk.raw, score }
		}
	  }
	  make = bestMake ? bestMake.make : undefined
	}
  
	return { make, model: bestModel ? bestModel.model : undefined }
  }

function parseIntent(raw, catalog) {
	const text = String(raw || '')

	const buyLike = /(사고|추천|알려|고르|구매|좀|찾아|고민|보여|찾아줘|추천해줘)/i.test(text)
	const sellLike = /(판매|팔|매입|견적|시세)/i.test(text)

	const budget = parseBudget(text)
	const mileage = parseMileage(text)
	const year = parseYear(text)
	const cat = parseCategoricals(text)
	const mkmd = parseMakeModel(text, catalog)

	const monthlyMax = typeof budget.monthlyMax === 'number' ? budget.monthlyMax : undefined
	const monthlyMin = typeof budget.monthlyMin === 'number' ? budget.monthlyMin : undefined

	const intent = {
		kind: sellLike ? 'sell' : buyLike ? 'buy' : 'chitchat',
		budgetMin: budget.budgetMin,
		budgetMax: budget.budgetMax,
		monthlyMin,
		monthlyMax,
		mileageMin: mileage.mileageMin,
		mileageMax: mileage.mileageMax,
		mileageApprox: mileage.mileageApprox,
		yearMin: year.yearMin,
		yearMax: year.yearMax,
		yearExact: year.yearExact,
		fuelType: cat.fuelType,
		bodyType: cat.bodyType,
		segment: cat.segment,
		transmission: cat.transmission,
		colors: cat.colors,
		noAccident: cat.noAccident,
		make: mkmd.make,
		model: mkmd.model,
	}

	// 간단 신뢰도: 채워진 슬롯 수
	const filled = Object.entries(intent).filter(
		([k, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0),
	).length
	intent._confidence = filled

	return intent
}

module.exports = { parseIntent, koNumberToInt }
