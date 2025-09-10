// back/services/infer.js
const fs = require('fs')
const path = require('path')
const cfg = require('../config')

// OpenAI SDK는 필요할 때만 로드 (클라우드 사용 OFF면 로드 안함)
function getOpenAI() {
	if (!cfg.USE_CLOUD_LLM) return null
	try {
		const OpenAI = require('openai')
		if (!cfg.OPENAI_API_KEY) return null
		return new OpenAI({ apiKey: cfg.OPENAI_API_KEY })
	} catch {
		return null
	}
}

// ft-model.json 또는 환경변수에서 파인튜닝 모델ID 찾기
function readFtModelId() {
	if (cfg.FT_MODEL_ID) return cfg.FT_MODEL_ID
	try {
		if (fs.existsSync(cfg.FT_MODEL_FILE)) {
			const j = JSON.parse(fs.readFileSync(cfg.FT_MODEL_FILE, 'utf-8'))
			// 다양한 키 대응
			return j.fine_tuned_model || j.model || j.id || ''
		}
	} catch {}
	return ''
}

async function callLocalLLM(messages) {
	if (!cfg.LOCAL_LLM_URL || !cfg.LOCAL_LLM_MODEL) return null
	const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')
	try {
		const r = await fetch(`${cfg.LOCAL_LLM_URL}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: cfg.LOCAL_LLM_MODEL, prompt, stream: false }),
		})
		const data = await r.json().catch(() => ({}))
		return data.response || null
	} catch {
		return null
	}
}

/**
 * chatAnswer
 * 우선순위:
 *  (1) FT 모델(클라우드) — cfg.PREFER_FINETUNE=true && FT 존재 && USE_CLOUD_LLM=true
 *  (2) 로컬 LLM — cfg.LOCAL_LLM_URL/MODEL 지정 시
 *  (3) 기본모델(클라우드) — cfg.ALLOW_BASE_FALLBACK=true && USE_CLOUD_LLM=true
 *  (4) 모두 불가 → 안내 문구
 */
async function chatAnswer(messages) {
	// (1) FT 우선
	if (cfg.PREFER_FINETUNE) {
		const ftId = readFtModelId()
		if (ftId && cfg.USE_CLOUD_LLM) {
			const client = getOpenAI()
			if (client) {
				const res = await client.chat.completions.create({
					model: ftId,
					messages,
					temperature: 0.2,
				})
				return res.choices?.[0]?.message?.content || ''
			}
		}
	}

	// (2) 로컬 LLM (있으면 사용)
	const local = await callLocalLLM(messages)
	if (local) return local

	// (3) 기본모델 폴백 (허용된 경우만)
	if (cfg.ALLOW_BASE_FALLBACK && cfg.USE_CLOUD_LLM) {
		const client = getOpenAI()
		if (client) {
			const res = await client.chat.completions.create({
				model: cfg.OPENAI_BASE_MODEL,
				messages,
				temperature: 0.3,
			})
			return res.choices?.[0]?.message?.content || ''
		}
	}

	// (4) 전부 불가
	return '(모델 미설정) 현재는 사전 학습한 FT 모델이나 로컬 LLM이 설정되어야 일반 질문에 답할 수 있어요.'
}

module.exports = { chatAnswer, readFtModelId }
