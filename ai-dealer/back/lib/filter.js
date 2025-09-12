// NOTE: 코드 주석에 이모티콘은 사용하지 않음

// 차량명 기반 차종 추론 규칙
const BODYTYPE_RULES = [
	{
		re: /(스포티지|투싼|쏘렌토|싼타페|카니발|펠리세이드|모하비|QM6|QM5|XM3|티볼리|트레일블레이저|콜로라도|GV70|GV80|니로|셀토스|베뉴|스토닉|코란도|티구안|RAV4|CR-?V|CX-?5|SUV|밴|승합|픽업)/i,
		type: 'suv',
	},
	{
		re: /(아반떼|쏘나타|그랜저|K3|K5|K7|K8|K9|SM6|말리부|임팔라|제타|패사트|아테온|C\s*클래스|E\s*클래스|S\s*클래스|A[468]|3\s*시리즈|5\s*시리즈|7\s*시리즈|세단)/i,
		type: 'sedan',
	},
	{ re: /(모닝|레이|스파크|i10|i20|해치|해치백)/i, type: 'hatch' },
	{ re: /(포터|봉고|마이티|트럭|픽업)/i, type: 'truck' },
	{ re: /(카니발|스타리아|그랜드스타렉스)/i, type: 'van' },
]

// 브랜드 추론
const BRAND_RULES = [
	{ re: /(현대|제네시스|포터|스타리아|그랜저|쏘나타|아반떼|투싼|싼타페|펠리세이드)/i, brand: '현대' },
	{ re: /(기아|K[3-9]|쏘렌토|스포티지|모닝|레이|카니발|니로|셀토스)/i, brand: '기아' },
	{ re: /(제네시스|GV[0-9]+|G[0-9]+)/i, brand: '제네시스' },
	{ re: /(르노|SM[3456]|QM[56]|XM3)/i, brand: '르노' },
	{ re: /(쌍용|티볼리|코란도|렉스턴)/i, brand: '쌍용' },
	{ re: /(쉐보레|말리부|임팔라|스파크|트레일블레이저|콜로라도)/i, brand: '쉐보레' },
	{ re: /(BMW|3\s*시리즈|5\s*시리즈|7\s*시리즈)/i, brand: 'BMW' },
	{ re: /(벤츠|mercedes|C\s*클래스|E\s*클래스|S\s*클래스|GL[ABCES]?)/i, brand: '벤츠' },
	{ re: /(아우디|A[468]|Q[357])/i, brand: '아우디' },
	{ re: /(폭스바겐|티구안|제타|패사트)/i, brand: '폭스바겐' },
	{ re: /(렉서스|토요타|RAV4|캠리|프리우스)/i, brand: '토요타/렉서스' },
]

// 연료 정규화
function canonicalFuel(korName) {
	const s = String(korName || '').toLowerCase()
	if (s.includes('디젤')) return 'diesel'
	if (s.includes('가솔린') || s.includes('휘발유')) return 'gasoline'
	if (s.includes('하이브리드')) return 'hybrid'
	if (s.includes('전기') || s.includes('ev')) return 'ev'
	if (s.includes('lpg')) return 'lpg'
	return ''
}

function inferBodyTypeFromName(name) {
	if (!name) return null
	for (const r of BODYTYPE_RULES) if (r.re.test(name)) return r.type
	return null
}

function inferBrandFromName(name) {
	if (!name) return null
	for (const r of BRAND_RULES) if (r.re.test(name)) return r.brand
	return null
}

function toBoolLoose(x) {
	const s = String(x || '').toLowerCase()
	if (s === 'true' || s === '1' || s === 'y') return true
	if (s === 'false' || s === '0' || s === 'n') return false
	return undefined
}

function toInt(x) {
	const n = parseInt(String(x).replace(/[, ]/g, ''), 10)
	return Number.isFinite(n) ? n : undefined
}

// 외부 JSON 한 건을 내부 표준 형태로 변환
export function normalizeVehicle(raw) {
	const carName = raw.carName || raw.name || ''
	const bodyType = raw.bodyType || inferBodyTypeFromName(carName) || null
	const brand = raw.brand || inferBrandFromName(carName) || null

	return {
		// 원본 표시용
		carNo: raw.carNo || '',
		carName,
		demoNo: raw.demoNo || '',
		demoDay: raw.demoDay || '',
		yymm: raw.yymm || '',
		source: raw,

		// 정규화된 검색용 필드
		fuelName: raw.fuel?.name || '',
		fuelType: canonicalFuel(raw.fuel?.name),
		colorName: raw.color?.name || '',
		options: Array.isArray(raw.options?.names) ? raw.options.names : [],

		km: toInt(raw.km),
		year: raw.yyyy ? toInt(raw.yyyy) : undefined,

		noAccident: toBoolLoose(raw.noAccident),
		shortKm: toBoolLoose(raw.shortKm),

		priceKman: toInt(raw.demoAmt), // 만원 단위
		monthlyKman: toInt(raw.monthlyDemoAmt), // 만원 단위

		bodyType,
		brand,
	}
}

// 점수 보조
function norm01(v, min, max) {
	if (!Number.isFinite(v)) return 0
	if (max === min) return 0
	const n = (v - min) / (max - min)
	return Math.max(0, Math.min(1, n))
}

// 필터링 및 랭킹
export function filterAndRank(rawVehicles, intent = {}) {
	// 입력이 원본이면 정규화
	const vehicles = rawVehicles.map(v => ('priceKman' in v && 'fuelType' in v ? v : normalizeVehicle(v)))

	// 집계값
	const years = vehicles.map(v => v.year).filter(Number.isFinite)
	const kms = vehicles.map(v => v.km).filter(Number.isFinite)
	const prices = vehicles.map(v => v.priceKman).filter(Number.isFinite)
	const months = vehicles.map(v => v.monthlyKman).filter(Number.isFinite)

	const yMin = years.length ? Math.min(...years) : 2005
	const yMax = years.length ? Math.max(...years) : 2025
	const kmMaxAll = kms.length ? Math.max(...kms) : 200000
	const pMin = prices.length ? Math.min(...prices) : 100
	const pMax = prices.length ? Math.max(...prices) : 10000
	const mMin = months.length ? Math.min(...months) : 5
	const mMax = months.length ? Math.max(...months) : 200

	const {
		bodyType = null,
		fuelType = null,
		budgetMin = null,
		budgetMax = null,
		monthlyMin = null,
		monthlyMax = null,
		kmMin = null,
		kmMax = null,
		yearMin = null,
		yearMax = null,
		brands = [],
		models = [],
		colors = [],
		options = [],
		noAccident = null,
		shortKm = null,
	} = intent

	// 느슨한 필터: 주어진 조건만 적용
	let filtered = vehicles.filter(v => {
		if (bodyType && v.bodyType && v.bodyType !== bodyType) return false
		if (fuelType && v.fuelType && v.fuelType !== fuelType) return false

		if (Array.isArray(brands) && brands.length) {
			const ok = !!v.brand && brands.some(b => String(v.brand).toLowerCase().includes(String(b).toLowerCase()))
			if (!ok) return false
		}
		if (Array.isArray(models) && models.length) {
			const name = String(v.carName || '').toLowerCase()
			const ok = models.some(m => {
				const modelName = String(m).toLowerCase()
				// 차량명에 모델명이 포함되어 있는지 확인
				return name.includes(modelName)
			})
			if (!ok) return false
		}
		if (Array.isArray(colors) && colors.length) {
			const c = String(v.colorName || '').toLowerCase()
			const ok = colors.some(col => c.includes(String(col).toLowerCase()))
			if (!ok) return false
		}
		if (Array.isArray(options) && options.length) {
			// 하나라도 포함되면 패스
			const list = Array.isArray(v.options) ? v.options : []
			const ok = options.some(opt => list.some(x => String(x).toLowerCase().includes(String(opt).toLowerCase())))
			if (!ok) return false
		}

		if (noAccident === true && v.noAccident === false) return false
		if (noAccident === false && v.noAccident === true) return false
		if (shortKm === true && v.shortKm === false) return false

		if (Number.isFinite(budgetMin) && Number.isFinite(v.priceKman) && v.priceKman < budgetMin) return false
		if (Number.isFinite(budgetMax) && Number.isFinite(v.priceKman) && v.priceKman > budgetMax) return false

		if (Number.isFinite(monthlyMin) && Number.isFinite(v.monthlyKman) && v.monthlyKman < monthlyMin) return false
		if (Number.isFinite(monthlyMax) && Number.isFinite(v.monthlyKman) && v.monthlyKman > monthlyMax) return false

		if (Number.isFinite(kmMin) && Number.isFinite(v.km) && v.km < kmMin) return false
		if (Number.isFinite(kmMax) && Number.isFinite(v.km) && v.km > kmMax) return false

		if (Number.isFinite(yearMin) && Number.isFinite(v.year) && v.year < yearMin) return false
		if (Number.isFinite(yearMax) && Number.isFinite(v.year) && v.year > yearMax) return false

		return true
	})

	// 하드 조건이 하나라도 있으면 fallback 금지
	const hasHard =
		Number.isFinite(kmMin) ||
		Number.isFinite(kmMax) ||
		Number.isFinite(yearMin) ||
		Number.isFinite(yearMax) ||
		Number.isFinite(budgetMin) ||
		Number.isFinite(budgetMax) ||
		Number.isFinite(monthlyMin) ||
		Number.isFinite(monthlyMax) ||
		!!bodyType ||
		!!fuelType ||
		(brands && brands.length) ||
		(models && models.length) ||
		(colors && colors.length) ||
		(options && options.length) ||
		typeof noAccident === 'boolean' ||
		typeof shortKm === 'boolean'

	if (!hasHard && filtered.length === 0) {
		// 정말 아무 하드 조건도 없을 때만 완화
		filtered = vehicles.slice()
	}

	if (filtered.length === 0) return []

	// 점수 산정
	const scored = filtered.map(v => {
		let s = 0

		if (bodyType && v.bodyType === bodyType) s += 4
		if (fuelType && v.fuelType === fuelType) s += 2

		if (Array.isArray(brands) && brands.length && v.brand) {
			if (brands.some(b => String(v.brand).toLowerCase().includes(String(b).toLowerCase()))) s += 1.5
		}
		if (Array.isArray(models) && models.length) {
			const name = String(v.carName || '').toLowerCase()
			if (models.some(m => name.includes(String(m).toLowerCase()))) s += 2
		}
		if (Array.isArray(options) && options.length && Array.isArray(v.options)) {
			const hit = options.reduce(
				(acc, opt) =>
					acc + (v.options.some(x => String(x).toLowerCase().includes(String(opt).toLowerCase())) ? 1 : 0),
				0,
			)
			s += Math.min(hit, 3) * 0.7
		}

		if (Number.isFinite(v.year)) s += norm01(v.year, yMin, yMax) * 1.5
		if (Number.isFinite(v.km)) {
			const invKm = 1 - norm01(v.km, 0, kmMaxAll)
			s += invKm * 1.2
		}

		if (Number.isFinite(v.priceKman)) {
			if (Number.isFinite(budgetMax)) {
				const diff = Math.abs(v.priceKman - budgetMax)
				const closeness = 1 - norm01(diff, 0, Math.max(500, pMax - pMin))
				s += closeness * 1.0
			} else {
				const mid = (pMin + pMax) / 2
				const closenessMid = 1 - norm01(Math.abs(v.priceKman - mid), 0, (pMax - pMin) / 2)
				s += closenessMid * 0.5
			}
		}

		if (Number.isFinite(v.monthlyKman) && Number.isFinite(monthlyMax)) {
			const diffM = Math.abs(v.monthlyKman - monthlyMax)
			const closenessM = 1 - norm01(diffM, 0, Math.max(10, mMax - mMin))
			s += closenessM * 0.8
		}

		if (v.noAccident === true) s += 0.5
		if (v.shortKm === true) s += 0.3

		return { v, s }
	})

	scored.sort((a, b) => b.s - a.s)
	return scored.map(x => x.v)
}

//차량 검색 조건(intent)을 정규화
export function normalizeIntent(intent) {
	const out = { ...intent }

	// 기본 필드 보정
	if (!Array.isArray(out.brands)) out.brands = []
	if (!Array.isArray(out.models)) out.models = []
	if (!Array.isArray(out.colors)) out.colors = []
	if (!Array.isArray(out.options)) out.options = []

	// 범위 보정
	if (Number.isFinite(out.budgetMin) && Number.isFinite(out.budgetMax) && out.budgetMin > out.budgetMax) {
		const t = out.budgetMin
		out.budgetMin = out.budgetMax
		out.budgetMax = t
	}
	if (Number.isFinite(out.monthlyMin) && Number.isFinite(out.monthlyMax) && out.monthlyMin > out.monthlyMax) {
		const t = out.monthlyMin
		out.monthlyMin = out.monthlyMax
		out.monthlyMax = t
	}
	if (Number.isFinite(out.kmMin) && Number.isFinite(out.kmMax) && out.kmMin > out.kmMax) {
		const t = out.kmMin
		out.kmMin = out.kmMax
		out.kmMax = t
	}
	if (Number.isFinite(out.yearMin) && Number.isFinite(out.yearMax) && out.yearMin > out.yearMax) {
		const t = out.yearMin
		out.yearMin = out.yearMax
		out.yearMax = t
	}

	// 음수 방지
	;['budgetMin', 'budgetMax', 'monthlyMin', 'monthlyMax', 'kmMin', 'kmMax'].forEach(k => {
		if (Number.isFinite(out[k]) && out[k] < 0) out[k] = 0
	})

	return out
}
