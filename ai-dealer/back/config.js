// back/config.js
const path = require('path')
const ROOT = __dirname

module.exports = {
	PORT: process.env.PORT || 3000,
	DATA_FILE: process.env.DATA_FILE || path.join(ROOT, '_data', 'merge-vehicles.json'),

	// 여기를 _data/weights.json 으로 변경
	WEIGHT_FILE: process.env.WEIGHT_FILE || path.join(ROOT, '_data', 'weights.json'),

	OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
	OPENAI_BASE_MODEL: process.env.OPENAI_BASE_MODEL || 'gpt-4o-mini',
	OPENAI_FT_BASE: process.env.OPENAI_FT_BASE || 'gpt-4o-mini',
	PREFER_FINETUNE: process.env.PREFER_FINETUNE !== 'false',
	ALLOW_BASE_FALLBACK: process.env.ALLOW_BASE_FALLBACK !== 'false',
	USE_CLOUD_LLM: process.env.USE_CLOUD_LLM !== 'false',
	LOCAL_LLM_URL: process.env.LOCAL_LLM_URL || '',
	LOCAL_LLM_MODEL: process.env.LOCAL_LLM_MODEL || '',
	FT_MODEL_FILE: process.env.FT_MODEL_FILE || path.join(ROOT, 'ft-model.json'),
	FT_MODEL_ID: process.env.FT_MODEL_ID || '',
}
