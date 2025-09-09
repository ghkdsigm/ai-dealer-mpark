// back/lib/util.js
function toIntOrNull(v) {
	if (v === null || v === undefined) return null
	const n = Number(String(v).replace(/[^\d.-]/g, ''))
	return Number.isFinite(n) ? n : null
}
function toBool(v) {
	if (typeof v === 'boolean') return v
	if (typeof v === 'string') return v.toLowerCase() === 'true'
	return Boolean(v)
}
function clamp01(x) {
	return Math.max(0, Math.min(1, x))
}
function norm(v, a, b) {
	if (v == null) return 0
	const c = Math.max(a, Math.min(b, v))
	return (c - a) / (b - a || 1)
}

module.exports = { toIntOrNull, toBool, clamp01, norm }
