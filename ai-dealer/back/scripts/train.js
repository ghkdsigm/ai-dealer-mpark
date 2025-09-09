// back/scripts/train.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음

const fs = require('fs')
const path = require('path')
const _ = require('lodash')
const BUDGET_STEP_MAN = 100 // 100만원 단위
const BUDGET_MAX_MAN = 100_000 // 10억 = 100,000만

let tf // TensorFlow 핸들
let backend = '' // 최종 사용 백엔드 이름

// 경로 상수
const DATA_DIR = path.resolve(__dirname, '../_data')
const TRAIN_FILE = path.join(DATA_DIR, 'train_samples.json')
const VEHICLE_FILE = path.join(DATA_DIR, 'vehicles.json')
const WEIGHT_FILE = path.join(DATA_DIR, 'weights.json')

// 토크나이저
function tokenize(text) {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(Boolean)
}

// 라벨 공간
const LABEL_SPACE = {
	budget: Array.from(
		{ length: Math.floor(BUDGET_MAX_MAN / BUDGET_STEP_MAN) },
		(_, i) => `≤${(i + 1) * BUDGET_STEP_MAN}만`,
	),
	body: ['SUV', 'Sedan', 'Hatch', 'Van', 'Truck'],
	fuel: ['Gasoline', 'Diesel', 'Hybrid', 'EV', 'LPG'],
	mileage: ['≤50k', '≤100k', '>100k'],
	usage: ['family', 'commute', 'offroad', 'business'],
	priority: ['fuel_efficiency', 'trunk', 'safety', 'price', 'maintenance'],
}

// 학습 샘플의 budget 라벨이 숫자(만원)로 와도 버킷 문자열로 정규화
function toBudgetBucketLabel(manWon) {
	const n = Number(manWon)
	if (!Number.isFinite(n) || n <= 0) return null
	const idx = Math.min(LABEL_SPACE.budget.length, Math.max(1, Math.ceil(n / BUDGET_STEP_MAN)))
	const upper = idx * BUDGET_STEP_MAN
	return `≤${upper}만`
}

// 라벨 인코딩
function encodeLabel(sample) {
	const y = {}

	// budget: 숫자(만원) 또는 '≤XXXX만' 둘 다 허용
	let bLabel = sample.labels.budget
	if (typeof bLabel === 'number') {
		bLabel = toBudgetBucketLabel(bLabel)
	}
	if (typeof bLabel === 'string' && /^\s*\d+\s*만\s*$/.test(bLabel)) {
		const man = parseInt(bLabel.replace(/\D/g, ''), 10)
		bLabel = toBudgetBucketLabel(man)
	}
	y.budget = LABEL_SPACE.budget.map(v => (bLabel === v ? 1 : 0))

	y.body = LABEL_SPACE.body.map(v => (sample.labels.body === v ? 1 : 0))
	y.fuel = LABEL_SPACE.fuel.map(v => (sample.labels.fuel === v ? 1 : 0))
	y.mileage = LABEL_SPACE.mileage.map(v => (sample.labels.mileage === v ? 1 : 0))

	const usageSet = new Set([sample.labels.usage].flat().filter(Boolean))
	y.usage = LABEL_SPACE.usage.map(v => (usageSet.has(v) ? 1 : 0))

	const prioSet = new Set([...(sample.labels.priority || [])])
	y.priority = LABEL_SPACE.priority.map(v => (prioSet.has(v) ? 1 : 0))

	return y
}

async function initTF() {
	// 1순위: tfjs-node (네이티브). 설치되어 있으면 자동 사용
	try {
		tf = require('@tensorflow/tfjs-node')
		backend = tf.getBackend() // 'tensorflow'
		console.log('[TF] using native backend =', backend)
		return
	} catch (e) {
		// 무시하고 CPU 폴백으로 진행
	}

	// 2순위: 순수 JS + CPU 백엔드
	tf = require('@tensorflow/tfjs') // tfjs-core + tfjs-backend-cpu 포함
	await tf.setBackend('cpu') // 명시적으로 cpu 선택
	await tf.ready()
	backend = tf.getBackend() // 'cpu'
	console.log('[TF] fallback backend =', backend)
}

async function main() {
	await initTF() // 백엔드가 준비되기 전에는 어떤 TF 연산도 하지 않아야 한다

	// 데이터 로드
	const samples = JSON.parse(fs.readFileSync(TRAIN_FILE, 'utf8'))
	const vehicles = JSON.parse(fs.readFileSync(VEHICLE_FILE, 'utf8')) // 현재 예제에서는 미사용

	// 어휘 사전 생성
	const allTokens = []
	for (const s of samples) allTokens.push(...tokenize(s.q))
	const tokenFreq = _.countBy(allTokens)
	const vocab = Object.entries(tokenFreq)
		.filter(([w, c]) => c >= 1)
		.sort((a, b) => b[1] - a[1])
		.map(([w]) => w)
	const tokenToIdx = new Map(vocab.map((w, i) => [w, i]))

	// 문서 토큰
	const docs = samples.map(s => tokenize(s.q))

	// DF, IDF 계산
	const df = new Array(vocab.length).fill(0)
	for (const d of docs) {
		const set = new Set(d)
		for (const w of set) {
			const idx = tokenToIdx.get(w)
			if (idx !== undefined) df[idx] += 1
		}
	}
	const N = docs.length
	const idf = df.map(dfi => Math.log((N + 1) / (dfi + 1)) + 1)

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

	// 입력 텐서 X
	const X = tf.tensor2d(
		samples.map(s => docToTfidf(tokenize(s.q))),
		[samples.length, vocab.length],
	)

	// 헤드 학습 함수
	async function trainHead(name, k, activation = 'sigmoid', epochs = 200, lr = 0.1) {
		const model = tf.sequential()
		model.add(tf.layers.dense({ inputShape: [vocab.length], units: k, activation }))
		model.compile({
			optimizer: tf.train.adam(lr),
			loss: activation === 'softmax' ? 'categoricalCrossentropy' : 'binaryCrossentropy',
		})

		const yMat = tf.tensor2d(
			samples.map(s => encodeLabel(s)[name]),
			[samples.length, k],
		)

		await model.fit(X, yMat, { epochs, verbose: 0, batchSize: Math.min(16, samples.length) })

		const dense = model.layers[0]
		const weights = dense.getWeights()
		const W = await weights[0].array()
		const b = await weights[1].array()

		yMat.dispose()
		model.dispose()
		return { W, b }
	}

	// 실제 학습
	const heads = {}
	heads.budget = await trainHead('budget', LABEL_SPACE.budget.length, 'softmax', 300, 0.05)
	heads.body = await trainHead('body', LABEL_SPACE.body.length, 'softmax', 300, 0.05)
	heads.fuel = await trainHead('fuel', LABEL_SPACE.fuel.length, 'softmax', 300, 0.05)
	heads.mileage = await trainHead('mileage', LABEL_SPACE.mileage.length, 'softmax', 250, 0.05)
	heads.usage = await trainHead('usage', LABEL_SPACE.usage.length, 'sigmoid', 200, 0.05)
	heads.priority = await trainHead('priority', LABEL_SPACE.priority.length, 'sigmoid', 200, 0.05)

	// 결과 저장
	const weights = {
		createdAt: new Date().toISOString(),
		backend,
		vocab,
		idf,
		labelSpace: LABEL_SPACE,
		heads,
	}
	fs.writeFileSync(WEIGHT_FILE, JSON.stringify(weights, null, 2), 'utf8')
	console.log('Saved:', WEIGHT_FILE)

	X.dispose()
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
