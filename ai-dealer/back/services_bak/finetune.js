// back/services/finetune.js
// 파인튜닝: 훈련 JSONL 업로드 → FT Job 생성/상태 조회 → 완료 시 모델ID 저장
const fs = require('fs')
const path = require('path')
const { getClient } = require('./openai')
const { OPENAI_FT_BASE, FT_MODEL_FILE } = require('../config')

function saveFtModelId(model) {
	fs.writeFileSync(FT_MODEL_FILE, JSON.stringify({ fine_tuned_model: model }, null, 2), 'utf-8')
}
function loadFtModelId() {
	try {
		if (fs.existsSync(FT_MODEL_FILE)) {
			const j = JSON.parse(fs.readFileSync(FT_MODEL_FILE, 'utf-8'))
			return j.fine_tuned_model || null
		}
	} catch {}
	return null
}

/**
 * 학습 데이터 포맷(권장): chat fine-tune jsonl
 * 한 줄 예:
 * {"messages":[{"role":"system","content":"엠파크 AI딜러..."},{"role":"user","content":"2천만원 연비좋은 SUV"},{"role":"assistant","content":"..."}]}
 */
async function uploadJsonl(filePath) {
	const client = getClient()
	if (!client) throw new Error('OpenAI client not ready')
	const res = await client.files.create({
		file: fs.createReadStream(filePath),
		purpose: 'fine-tune',
	})
	return res
}

async function createJob(trainingFileId, suffix = 'empark-dealer') {
	const client = getClient()
	if (!client) throw new Error('OpenAI client not ready')
	const job = await client.fineTuning.jobs.create({
		training_file: trainingFileId,
		model: OPENAI_FT_BASE,
		suffix,
	})
	return job
}

async function retrieveJob(jobId) {
	const client = getClient()
	if (!client) throw new Error('OpenAI client not ready')
	return client.fineTuning.jobs.retrieve(jobId)
}

module.exports = {
	uploadJsonl,
	createJob,
	retrieveJob,
	saveFtModelId,
	loadFtModelId,
}
