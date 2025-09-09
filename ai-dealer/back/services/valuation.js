// back/services/valuation.js
const { simpleSim } = require('../lib/search')

const YEAR_DECAY = 0.05 // 연식 1년 차이당 5% 보정
const MILEAGE_DECAY_10K = 0.015 // 주행 1만km 차이당 1.5% 보정

function median(arr) {
	if (!arr.length) return 0
	const a = [...arr].sort((x, y) => x - y)
	const m = Math.floor(a.length / 2)
	return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
function quantile(arr, q) {
	if (!arr.length) return 0
	const a = [...arr].sort((x, y) => x - y)
	const i = Math.floor((a.length - 1) * q)
	return a[i]
}

function adjustToSubjectPrice(comp, subj) {
	let price = comp.price
	const ydiff = subj.year && comp.year ? subj.year - comp.year : 0
	price *= 1 + YEAR_DECAY * ydiff
	const kmDiff10k = subj.mileage != null && comp.mileage != null ? (subj.mileage - comp.mileage) / 10000 : 0
	price *= 1 - MILEAGE_DECAY_10K * kmDiff10k
	return Math.max(0, price)
}

function buildComps(inventory, subject) {
	let cand = inventory.filter(v => v.price != null)
	if (subject.fuelType) cand = cand.filter(v => v.fuelType === subject.fuelType)

	cand = cand.map(v => {
		let s = 0
		if (subject.carName) s += 0.7 * simpleSim(v, subject.carName)
		if (subject.year && v.year) s += 0.2 * Math.max(0, 1 - Math.abs(subject.year - v.year) / 5)
		if (subject.mileage != null && v.mileage != null)
			s += 0.1 * Math.max(0, 1 - Math.abs(subject.mileage - v.mileage) / 150000)
		return { v, s }
	})

	cand.sort((a, b) => b.s - a.s)
	const top = cand.slice(0, 12).map(x => x.v)

	const adjusted = top.map(c => adjustToSubjectPrice(c, subject))
	const mid = Math.round(median(adjusted))
	const low = Math.round(quantile(adjusted, 0.25))
	const high = Math.round(quantile(adjusted, 0.75))

	return { comps: top, estimate: { low, mid, high } }
}

module.exports = { buildComps }
