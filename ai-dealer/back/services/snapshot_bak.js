// back/services/snapshot.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음

const fs = require('fs')
const path = require('path')

function toIntOrNull(x) {
	if (x == null) return null
	const s = String(x).replace(/[^0-9-]/g, '')
	if (!s) return null
	const n = Number(s)
	return Number.isFinite(n) ? n : null
}

function boolFromString(x) {
	if (typeof x === 'boolean') return x
	const s = String(x || '').trim()
	if (!s) return null
	if (/^(true|yes|y|1|무사고)$/i.test(s)) return true
	if (/^(false|no|n|0|사고)$/i.test(s)) return false
	return null
}

function mapFuel(x) {
	const s = String(x || '').toLowerCase()
	if (/diesel|디젤/.test(s)) return 'diesel'
	if (/gasoline|휘발유|가솔린/.test(s)) return 'gasoline'
	if (/hybrid|하이브리드/.test(s)) return 'hybrid'
	if (/(^|[^a-z])ev([^a-z]|$)|전기|electric/.test(s)) return 'ev'
	if (/lpg|엘피지/.test(s)) return 'lpg'
	return undefined
}

function mapBody(x) {
	const s = String(x || '').toLowerCase()
	if (/suv/.test(s)) return 'suv'
	if (/세단|sedan/.test(s)) return 'sedan'
	if (/해치|hatch/.test(s)) return 'hatch'
	if (/밴|승합|van/.test(s)) return 'van'
	if (/트럭|truck/.test(s)) return 'truck'
	return undefined
}

function parseYearFromYYMM(yymm) {
	if (!yymm) return null
	// 20년06월(21년형) 같은 문자열에서 괄호 안의 년형 우선
	let m = String(yymm).match(/\((\d{2}|\d{4})년형\)/)
	if (m) {
		const yy =
			m[1].length === 2
				? parseInt(m[1], 10) < 30
					? 2000 + parseInt(m[1], 10)
					: 1900 + parseInt(m[1], 10)
				: parseInt(m[1], 10)
		if (Number.isFinite(yy)) return yy
	}
	// 그 외 "20년06월" 같은 앞부분에서 연도 추출
	m = String(yymm).match(/(20\d{1,2}|19\d{2})\s*년/)
	if (m) {
		const y = parseInt(m[1], 10)
		if (Number.isFinite(y)) return y
	}
	return null
}

function deriveMakeModel(carName) {
	if (!carName) return {}
	const s = String(carName).trim()
	// 괄호가 포함된 제조사 표기 보정 예: "쉐보레(대우) 트레일블레이저 ..."
	const parts = s.split(/\s+/)
	if (!parts.length) return {}
	let make = parts[0]
	let model = parts.slice(1, 3).join(' ')
	return { make, model: model || undefined }
}

function readFlexibleJson(filePath) {
	try {
		if (!fs.existsSync(filePath)) return []
		const raw = fs.readFileSync(filePath, 'utf-8').trim()
		if (!raw) return []
		const isNdjson = !raw.startsWith('[') && raw.includes('\n') && raw.includes('{')
		if (isNdjson) {
			return raw
				.split('\n')
				.map(l => l.trim())
				.filter(Boolean)
				.map(l => JSON.parse(l))
		}
		const parsed = JSON.parse(raw)
		if (Array.isArray(parsed)) return parsed
		if (parsed && Array.isArray(parsed.data)) return parsed.data
		if (parsed && Array.isArray(parsed.items)) return parsed.items
		return []
	} catch (e) {
		console.warn('[snapshot] read fail:', e.message)
		return []
	}
}

function adaptRecord(r, i) {
	const id = r.demoNo || r.id || String(i)

	const year = toIntOrNull(r.year ?? r.yyyy) ?? parseYearFromYYMM(r.yymm)

	// 주행거리: km -> mileage 로 통일
	const mileage = toIntOrNull(r.mileage ?? r.km)

	// 가격: 만원 단위로 저장 가정
	const price = toIntOrNull(r.price ?? r.demoAmt)
	const monthlyPrice = toIntOrNull(r.monthlyPrice ?? r.monthlyDemoAmt)

	const fuelType = mapFuel(r.fuel ?? r.carGas)
	const bodyType = mapBody(r.bodyType ?? r.type)
	const noAccident = boolFromString(r.noAccident)
	const color = r.color ?? r.colorCode ?? null

	// 제조사/모델 보정
	let make = r.make
	let model = r.model
	if (!make || !model) {
		const mm = deriveMakeModel(r.carName)
		make = make || mm.make
		model = model || mm.model
	}

	return {
		id,
		demoNo: r.demoNo,
		demoDay: r.demoDay,
		carNo: r.carNo,
		carName: r.carName,
		yymm: r.yymm,
		make,
		model,
		year,
		mileage, // 숫자 km
		price, // 만원
		monthlyPrice, // 만원
		fuelType,
		bodyType,
		segment: r.segment,
		transmission: r.gear ?? r.transmission,
		noAccident,
		color,
		options: r.carOption || r.options || [],
		tags: r.tags || [],
		raw: r,
	}
}

function buildSnapshotFromArray(arr) {
	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		list: (Array.isArray(arr) ? arr : []).map((r, i) => adaptRecord(r, i)),
	}
}

function watchFile(DATA_FILE, onReload) {
	try {
		const dir = path.dirname(DATA_FILE)
		if (!fs.existsSync(dir)) return
		fs.watch(dir, { recursive: false }, (evt, fname) => {
			const isTarget = fname && path.resolve(dir, fname) === DATA_FILE
			if (isTarget || fname === path.basename(DATA_FILE)) {
				try {
					onReload()
				} catch (e) {
					console.warn('[snapshot] reload error:', e.message)
				}
			}
		})
	} catch (e) {
		console.warn('[snapshot] watch unsupported:', e.message)
	}
}

module.exports = { readFlexibleJson, buildSnapshotFromArray, watchFile }
