// back/services/openai.js
const { OPENAI_API_KEY } = require('../config')

// CommonJS용 OpenAI SDK
let OpenAI
try {
	OpenAI = require('openai')
} catch {
	console.error('[openai] please `npm i openai`')
	OpenAI = null
}

let client = null
function getClient() {
	if (!OpenAI) return null
	if (!client) client = new OpenAI({ apiKey: OPENAI_API_KEY })
	return client
}

module.exports = { getClient }
