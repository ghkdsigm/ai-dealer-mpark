// back/routes/finetune.js
// 파인튜닝: JSONL 업로드 → Job 생성 → 상태 조회 → 모델ID 저장/조회
const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()

const { uploadJsonl, createJob, retrieveJob, saveFtModelId, loadFtModelId } = require('../services/finetune')

// JSONL 파일 업로드 후 FT Job 생성
// body: { jsonlPath?:string, jsonlInline?:string, suffix?:string }
router.post('/ft/train', async (req, res) => {
	try {
		let { jsonlPath, jsonlInline, suffix } = req.body || {}
		let filePath = jsonlPath

		if (!filePath && jsonlInline) {
			// 문자열로 온 JSONL을 임시 파일로 저장
			const tmp = path.resolve(process.cwd(), `back/_data/train_${Date.now()}.jsonl`)
			fs.writeFileSync(tmp, jsonlInline, 'utf-8')
			filePath = tmp
		}
		if (!filePath) return res.status(400).json({ ok: false, error: 'jsonlPath 또는 jsonlInline 필요' })

		const uploaded = await uploadJsonl(filePath)
		const job = await createJob(uploaded.id, suffix || 'empark-ft')

		res.json({ ok: true, job })
	} catch (e) {
		console.error(e)
		res.status(500).json({ ok: false, error: e.message })
	}
})

// FT Job 상태 확인 + 완료 시 모델 저장
// query: ?jobId=...
router.get('/ft/status', async (req, res) => {
	try {
		const jobId = req.query.jobId
		if (!jobId) return res.status(400).json({ ok: false, error: 'jobId required' })
		const job = await retrieveJob(jobId)

		// 완료되면 모델 아이디 저장
		const model = job?.fine_tuned_model
		if (model) saveFtModelId(model)

		res.json({ ok: true, job, fine_tuned_model: model || null })
	} catch (e) {
		console.error(e)
		res.status(500).json({ ok: false, error: e.message })
	}
})

// 현재 파인튜닝 모델 아이디 조회
router.get('/ft/model', (req, res) => {
	const model = loadFtModelId()
	res.json({ fine_tuned_model: model })
})

module.exports = router
