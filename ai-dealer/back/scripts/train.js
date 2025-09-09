// back/scripts/train.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음
// 목적: train_samples.json을 학습해 weights.json(vocab/idf/라벨스페이스/헤드가중치) 생성
// 개선점:
// - @tensorflow/tfjs-node-gpu → tfjs-node → 순수 tfjs(cpu) 순으로 백엔드 선택
// - 환경변수로 하이퍼파라미터 제어(EPOCHS/LR/BATCH/MIN_DF/MAX_VOCAB 등)
// - 메모리 사용량을 줄이기 위해 Float32Array로 X 빌드
// - 학습 진행률 로그(onEpochEnd)와 총 소요시간 출력
// - 작은 데이터셋에서 과적합 방지를 위해 epochs 조정 가능

const fs = require('fs')
const path = require('path')
const _ = require('lodash')

// -----------------------------
// 하이퍼파라미터/설정 (ENV로 오버라이드 가능)
// -----------------------------
const BUDGET_STEP_MAN = parseInt(process.env.BUDGET_STEP_MAN || '100', 10) // 100만원 스텝
const BUDGET_MAX_MAN = parseInt(process.env.BUDGET_MAX_MAN || '100000', 10) // 10억=100,000만

const EPOCH_SOFTMAX = parseInt(process.env.EPOCH_SOFTMAX || '300', 10)
const EPOCH_SIGMOID = parseInt(process.env.EPOCH_SIGMOID || '200', 10)
const LR_MAIN = parseFloat(process.env.LR_MAIN || '0.05')
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '32', 10)

const MIN_DF = parseInt(process.env.MIN_DF || '1', 10)                 // 최소 문서빈도
const MAX_VOCAB = parseInt(process.env.MAX_VOCAB || '30000', 10)       // 최대 어휘 크기
const SHUFFLE = String(process.env.SHUFFLE || 'true') === 'true'

// 경로 상수
const DATA_DIR = path.resolve(__dirname, '../_data')
const TRAIN_FILE = path.join(DATA_DIR, 'train_samples.json')
const VEHICLE_FILE = path.join(DATA_DIR, 'vehicles.json')
const WEIGHT_FILE = path.join(DATA_DIR, 'weights.json')

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

// -----------------------------
// 토크나이저
// -----------------------------
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

// -----------------------------
// budget 라벨 정규화
// -----------------------------
function toBudgetBucketLabel(manWon) {
  const n = Number(manWon)
  if (!Number.isFinite(n) || n <= 0) return null
  const idx = Math.min(LABEL_SPACE.budget.length, Math.max(1, Math.ceil(n / BUDGET_STEP_MAN)))
  const upper = idx * BUDGET_STEP_MAN
  return `≤${upper}만`
}

// -----------------------------
// 라벨 인코딩
// -----------------------------
function encodeLabel(sample) {
  const y = {}

  // budget: 숫자(만원) 또는 '≤XXXX만' 둘 다 허용
  let bLabel = sample.labels.budget
  if (typeof bLabel === 'number') {
    bLabel = toBudgetBucketLabel(bLabel)
  }
  if (typeof bLabel === 'string') {
    const m = bLabel.match(/(\d+)\s*만/)
    if (m) {
      const man = parseInt(m[1], 10)
      bLabel = toBudgetBucketLabel(man)
    }
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

// -----------------------------
// TensorFlow 초기화
// -----------------------------
let tf // TensorFlow 핸들
let backend = '' // 최종 사용 백엔드 이름

async function initTF() {
	try {
	  tf = require('@tensorflow/tfjs-node-gpu')
	  backend = tf.getBackend()
	  console.log('[TF] using native GPU backend =', backend)
	  return
	} catch (e) {
	  console.warn('[TF] gpu load failed:', e.message)  // 임시 로그
	}
  
	try {
	  tf = require('@tensorflow/tfjs-node')
	  backend = tf.getBackend()
	  console.log('[TF] using native CPU backend =', backend)
	  return
	} catch (e) {
	  console.warn('[TF] cpu load failed:', e.message)  // 임시 로그
	}
  
	tf = require('@tensorflow/tfjs')
	await tf.setBackend('cpu')
	await tf.ready()
	backend = tf.getBackend()
	console.log('[TF] fallback backend =', backend)
  }

// -----------------------------
// 메인
// -----------------------------
async function main() {
  const t0 = process.hrtime.bigint()
  await initTF()

  // 데이터 로드
  const samples = JSON.parse(fs.readFileSync(TRAIN_FILE, 'utf8'))
  // vehicles은 현재 미사용이지만 향후 레이블 검증/보강에 활용 가능
  let vehicles = []
  try {
    vehicles = JSON.parse(fs.readFileSync(VEHICLE_FILE, 'utf8'))
  } catch {}

  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(`No training samples in ${TRAIN_FILE}`)
  }

  // 어휘 사전 생성
  const docs = samples.map(s => tokenize(s.q))
  const tokenFreq = _.countBy(docs.flat())
  let vocab = Object.entries(tokenFreq)
    .filter(([w, c]) => c >= 1) // 토큰 빈도
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)

  // DF 계산
  const tokenToIdxTemp = new Map(vocab.map((w, i) => [w, i]))
  const dfTemp = new Array(vocab.length).fill(0)
  for (const d of docs) {
    const set = new Set(d)
    for (const w of set) {
      const idx = tokenToIdxTemp.get(w)
      if (idx !== undefined) dfTemp[idx] += 1
    }
  }
  // MIN_DF 적용
  const filtered = []
  for (let i = 0; i < vocab.length; i++) {
    if (dfTemp[i] >= MIN_DF) filtered.push(vocab[i])
  }
  vocab = filtered.slice(0, MAX_VOCAB)
  const V = vocab.length
  if (V === 0) throw new Error('Empty vocabulary after MIN_DF/MAX_VOCAB filtering')

  const tokenToIdx = new Map(vocab.map((w, i) => [w, i]))

  // DF/IDF 재계산
  const df = new Array(V).fill(0)
  for (const d of docs) {
    const set = new Set(d)
    for (const w of set) {
      const idx = tokenToIdx.get(w)
      if (idx !== undefined) df[idx] += 1
    }
  }
  const N = docs.length
  const idf = df.map(dfi => Math.log((N + 1) / (dfi + 1)) + 1)

  // TF-IDF 변환 함수
  function docToTfidf(tokens) {
    const tfVec = new Float32Array(V)
    for (const t of tokens) {
      const idx = tokenToIdx.get(t)
      if (idx !== undefined) tfVec[idx] += 1
    }
    let maxTf = 1
    for (let i = 0; i < V; i++) if (tfVec[i] > maxTf) maxTf = tfVec[i]
    const out = new Float32Array(V)
    for (let i = 0; i < V; i++) out[i] = (tfVec[i] / maxTf) * idf[i]
    return out
  }

  // 입력 X 구성(Float32Array로 메모리 절약)
  const S = samples.length
  const Xbuf = new Float32Array(S * V)
  for (let i = 0; i < S; i++) {
    const row = docToTfidf(docs[i])
    Xbuf.set(row, i * V)
  }
  const X = tf.tensor2d(Xbuf, [S, V])

  console.log(`[TF] dataset: samples=${S}, vocab=${V}`)
  console.log(`[TF] hyper: softmax_epochs=${EPOCH_SOFTMAX}, sigmoid_epochs=${EPOCH_SIGMOID}, lr=${LR_MAIN}, batch=${Math.min(BATCH_SIZE, S)}, min_df=${MIN_DF}, max_vocab=${MAX_VOCAB}`)

  // 공통 학습 유틸
  function buildModel(k, activation) {
    const model = tf.sequential()
    model.add(tf.layers.dense({ inputShape: [V], units: k, activation }))
    model.compile({
      optimizer: tf.train.adam(LR_MAIN),
      loss: activation === 'softmax' ? 'categoricalCrossentropy' : 'binaryCrossentropy',
      metrics: activation === 'softmax' ? ['accuracy'] : ['binaryAccuracy'],
    })
    return model
  }

  async function trainHead(name, k, activation, epochs) {
    const yMat = tf.tensor2d(
      samples.map(s => encodeLabel(s)[name]),
      [S, k],
    )
    const model = buildModel(k, activation)

    console.log(`[TF] training head=${name}, k=${k}, activation=${activation}, epochs=${epochs}`)

    const t1 = process.hrtime.bigint()
    await model.fit(X, yMat, {
      epochs,
      verbose: 0,
      batchSize: Math.min(BATCH_SIZE, S),
      shuffle: SHUFFLE,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          if ((epoch + 1) % Math.max(1, Math.floor(epochs / 5)) === 0) {
            const loss = typeof logs?.loss === 'number' ? logs.loss.toFixed(4) : logs?.loss
            const acc = logs?.acc || logs?.accuracy || logs?.binaryAccuracy
            const accStr = typeof acc === 'number' ? acc.toFixed(4) : acc
            console.log(`  [${name}] epoch ${epoch + 1}/${epochs} loss=${loss} acc=${accStr}`)
          }
        }
      }
    })
    const t2 = process.hrtime.bigint()
    console.log(`[TF] done head=${name} in ${Number(t2 - t1) / 1e9}s`)

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
  heads.budget = await trainHead('budget', LABEL_SPACE.budget.length, 'softmax', EPOCH_SOFTMAX)
  heads.body = await trainHead('body', LABEL_SPACE.body.length, 'softmax', EPOCH_SOFTMAX)
  heads.fuel = await trainHead('fuel', LABEL_SPACE.fuel.length, 'softmax', EPOCH_SOFTMAX)
  heads.mileage = await trainHead('mileage', LABEL_SPACE.mileage.length, 'softmax', Math.max(150, Math.floor(EPOCH_SOFTMAX * 0.85)))
  heads.usage = await trainHead('usage', LABEL_SPACE.usage.length, 'sigmoid', EPOCH_SIGMOID)
  heads.priority = await trainHead('priority', LABEL_SPACE.priority.length, 'sigmoid', EPOCH_SIGMOID)

  // 결과 저장
  const weights = {
    createdAt: new Date().toISOString(),
    backend,
    config: {
      budgetStepMan: BUDGET_STEP_MAN,
      budgetMaxMan: BUDGET_MAX_MAN,
      epochs: { softmax: EPOCH_SOFTMAX, sigmoid: EPOCH_SIGMOID },
      lr: LR_MAIN,
      batch: Math.min(BATCH_SIZE, S),
      minDf: MIN_DF,
      maxVocab: MAX_VOCAB,
      shuffle: SHUFFLE,
    },
    vocab,
    idf,
    labelSpace: LABEL_SPACE,
    heads,
  }
  fs.writeFileSync(WEIGHT_FILE, JSON.stringify(weights, null, 2), 'utf8')
  console.log('Saved:', WEIGHT_FILE)

  X.dispose()
  if (tf.engine && tf.engine().memory) {
    const mem = tf.engine().memory()
    console.log('[TF] tensors:', mem.numTensors, 'bytes:', mem.numBytes)
  }

  const t9 = process.hrtime.bigint()
  console.log(`[TF] total time: ${Number(t9 - t0) / 1e9}s`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
