// back/services/snapshot.js
const fs = require('fs')
const path = require('path')
const { adaptRecord } = require('../lib/adapt')

function readFlexibleJson(filePath) {
	try {
		if (!fs.existsSync(filePath)) return []
		const raw = fs.readFileSync(filePath, 'utf-8').trim()
		if (!raw) return []
		const isNdjson = !raw.startsWith('[') && raw.includes('\n') && raw.includes('{')
		if (isNdjson) {
			return raw
				.split('\n')
				.map(l => l.trim())
				.filter(Boolean)
				.map(l => JSON.parse(l))
		}
		const parsed = JSON.parse(raw)
		if (Array.isArray(parsed)) return parsed
		if (parsed && Array.isArray(parsed.data)) return parsed.data
		if (parsed && Array.isArray(parsed.items)) return parsed.items
		return []
	} catch (e) {
		console.warn('[snapshot] read fail:', e.message)
		return []
	}
}

function buildSnapshotFromArray(arr) {
	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		list: arr.map(adaptRecord),
	}
}

function watchFile(DATA_FILE, onReload) {
	try {
		const dir = path.dirname(DATA_FILE)
		if (!fs.existsSync(dir)) return
		fs.watch(dir, { recursive: false }, (evt, fname) => {
			const isTarget = fname && path.resolve(dir, fname) === DATA_FILE
			if (isTarget || fname === path.basename(DATA_FILE)) {
				try {
					onReload()
				} catch (e) {
					console.warn('[snapshot] reload error:', e.message)
				}
			}
		})
	} catch (e) {
		console.warn('[snapshot] watch unsupported:', e.message)
	}
}

module.exports = { readFlexibleJson, buildSnapshotFromArray, watchFile }
