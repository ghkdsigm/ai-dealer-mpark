// back/lib/adapt.js
const { toIntOrNull, toBool } = require('./util')

const GAS_MAP = {
	가솔린: 'gasoline',
	디젤: 'diesel',
	하이브리드: 'hybrid',
	'가솔린+전기': 'hybrid',
	전기: 'ev',
	LPG: 'lpg',
}

const BODYTYPE_RULES = [
	{
		re: /(스포티지|투싼|쏘렌토|싼타페|카니발|펠리세이드|모하비|QM6|XM3|콜로라도|GV70|GV80|니로|SUV|픽업|밴)/i,
		type: 'suv',
	},
	{ re: /(아반떼|쏘나타|그랜저|K3|K5|K7|K8|SM5|SM6|SM7|제네시스(?!쿠페)|세단)/i, type: 'sedan' },
	{ re: /(모닝|레이|스파크|프라이드|i30|크루즈5|해치|해치백|클리오)/i, type: 'hatch' },
	{ re: /(GV60|EV6|아이오닉|폴스타|테슬라|코나 일렉트릭)/i, type: 'cuv' },
	{ re: /(포터|봉고|마이티|라보|트럭|2\.5톤|3\.5톤|카고)/i, type: 'truck' },
	{ re: /(스타렉스|스타리아|카니발|승합|버스)/i, type: 'van' },
]

function inferBodyType(name, fallback) {
	if (fallback) return String(fallback).toLowerCase()
	if (!name) return undefined
	for (const r of BODYTYPE_RULES) if (r.re.test(name)) return r.type
	return undefined
}

function splitMakeModel(carName = '') {
	const parts = String(carName || '')
		.trim()
		.split(/\s+/)
	if (parts.length <= 1) return { make: parts[0] || '', model: '' }
	return { make: parts[0], model: parts.slice(1).join(' ') }
}

/**
 * 공급 JSON 예시:
 * { "statusCode":0, "responseMessage":"...", "data":[{...}, ...] }
 * 내부 표준 스키마:
 * { id, demoNo, carNo, carName, make, model, year, yymm, bodyType, fuelType,
 *   km, price, monthlyPrice, noAccident, raw }
 */
function adaptRecord(r) {
	const { make, model } = splitMakeModel(r.carName || '')
	const price = toIntOrNull(r.demoAmt) // 만원
	const monthlyPrice = toIntOrNull(r.monthlyDemoAmt) // 만원
	const year = toIntOrNull(r.yyyy) || undefined
	const km = toIntOrNull(r.km) || 0
	return {
		id: r.demoNo || r.carNo || `${Math.random()}`.slice(2),
		demoNo: r.demoNo,
		carNo: r.carNo,
		carName: r.carName,
		make,
		model,
		year,
		yymm: r.yymm || undefined,
		bodyType: inferBodyType(r.carName, r.type),
		fuelType: GAS_MAP[r.carGas] || undefined,
		km,
		price,
		monthlyPrice,
		noAccident: toBool(r.noAccident),
		raw: r,
	}
}

module.exports = { adaptRecord }
