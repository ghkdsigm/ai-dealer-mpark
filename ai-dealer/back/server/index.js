// back/server/index.js
const express = require('express')
const cors = require('cors')
const path = require('path')
const { recommend, inferFilters } = require('./infer')

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.post('/api/recommend', (req, res) => {
	const { q, limit } = req.body || {}
	if (!q) return res.status(400).json({ error: 'q is required' })
	const out = recommend(q, limit || 8)
	res.json(out)
})

app.post('/api/parse', (req, res) => {
	const { q } = req.body || {}
	if (!q) return res.status(400).json({ error: 'q is required' })
	res.json({ filters: inferFilters(q) })
})

const PORT = 3000
app.listen(PORT, () => {
	console.log(`API server on http://localhost:${PORT}`)
	console.log('DATA_FILE:', path.resolve(__dirname, '../_data/vehicles.json'))
	console.log('WEIGHT_FILE:', path.resolve(__dirname, '../_data/weights.json'))
})
