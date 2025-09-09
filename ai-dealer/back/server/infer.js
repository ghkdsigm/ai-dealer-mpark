// back/server/infer.js
const fs = require('fs')
const path = require('path')

const DATA_DIR = path.resolve(__dirname, '../_data')
const VEHICLE_FILE = path.join(DATA_DIR, 'vehicles.json')
const WEIGHT_FILE = path.join(DATA_DIR, 'weights.json')

const vehicles = JSON.parse(fs.readFileSync(VEHICLE_FILE, 'utf8'))
const weights = JSON.parse(fs.readFileSync(WEIGHT_FILE, 'utf8'))

const vocab = weights.vocab
const idf = weights.idf
const tokenToIdx = new Map(vocab.map((w, i) => [w, i]))

function tokenize(text) {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(Boolean)
}

function docToTfidf(tokens) {
	const tfVec = new Array(vocab.length).fill(0)
	for (const t of tokens) {
		const idx = tokenToIdx.get(t)
		if (idx !== undefined) tfVec[idx] += 1
	}
	const maxTf = Math.max(1, ...tfVec)
	const tfidf = tfVec.map((tfv, i) => (tfv / maxTf) * idf[i])
	return tfidf
}

function matVec(W, x, b) {
	const out = new Array(W[0].length).fill(0)
	for (let j = 0; j < out.length; j++) {
		let s = b[j] || 0
		for (let i = 0; i < x.length; i++) s += x[i] * W[i][j]
		out[j] = s
	}
	return out
}

function softmax(a) {
	const m = Math.max(...a)
	const exps = a.map(v => Math.exp(v - m))
	const s = exps.reduce((p, c) => p + c, 0)
	return exps.map(v => v / s)
}

function sigmoidVec(a) {
	return a.map(v => 1 / (1 + Math.exp(-v)))
}

function predictHeads(q) {
	const x = docToTfidf(tokenize(q))
	const out = {}
	for (const key of Object.keys(weights.heads)) {
		const { W, b } = weights.heads[key]
		const z = matVec(W, x, b)
		if (['budget', 'body', 'fuel', 'mileage'].includes(key)) {
			out[key] = softmax(z)
		} else {
			out[key] = sigmoidVec(z)
		}
	}
	return out
}

function chooseArgmax(dist) {
	let idx = 0,
		best = dist[0]
	for (let i = 1; i < dist.length; i++) {
		if (dist[i] > best) {
			best = dist[i]
			idx = i
		}
	}
	return idx
}

function inferFilters(q) {
	const pred = predictHeads(q)
	const ls = weights.labelSpace
	return {
		budget: ls.budget[chooseArgmax(pred.budget)],
		body: ls.body[chooseArgmax(pred.body)],
		fuel: ls.fuel[chooseArgmax(pred.fuel)],
		mileage: ls.mileage[chooseArgmax(pred.mileage)],
		usage: ls.usage.map((v, i) => (pred.usage[i] > 0.5 ? v : null)).filter(Boolean),
		priority: ls.priority
			.map((v, i) => ({ v, p: pred.priority[i] }))
			.sort((a, b) => b.p - a.p)
			.slice(0, 3)
			.map(x => x.v),
	}
}

function scoreVehicle(v, filt) {
	let score = 0

	if (filt.body && v.body === filt.body) score += 2
	if (filt.fuel && v.fuel === filt.fuel) score += 1.5

	if (filt.budget) {
		const price = v.price || 0
		if (filt.budget === '≤10m' && price <= 10000000) score += 2
		if (filt.budget === '≤15m' && price <= 15000000) score += 2
		if (filt.budget === '≤20m' && price <= 20000000) score += 2
		if (filt.budget === '≤30m' && price <= 30000000) score += 2
		if (filt.budget === '>30m' && price > 30000000) score += 2
	}

	if (filt.mileage) {
		const m = v.mileage || 0
		if (filt.mileage === '≤50k' && m <= 50000) score += 1.5
		if (filt.mileage === '≤100k' && m <= 100000) score += 1.0
		if (filt.mileage === '>100k' && m > 100000) score += 0.5
	}

	if (filt.usage?.includes('family') && v.trunkVolume) score += Math.min(2, v.trunkVolume / 500)
	if (filt.priority?.includes('fuel_efficiency') && v.fuelEff) score += Math.min(2, v.fuelEff / 20)
	if (filt.priority?.includes('safety') && v.safetyScore) score += v.safetyScore
	if (filt.priority?.includes('price')) score += 0.5
	if (filt.priority?.includes('maintenance') && v.maintCostScore) score += v.maintCostScore

	return score
}

function recommend(q, limit = 10) {
	const filt = inferFilters(q)
	const ranked = vehicles
		.map(v => ({ v, s: scoreVehicle(v, filt) }))
		.sort((a, b) => b.s - a.s)
		.slice(0, limit)
		.map(x => x.v)
	return { filters: filt, results: ranked }
}

module.exports = { recommend, inferFilters }
