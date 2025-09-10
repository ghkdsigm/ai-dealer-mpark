// back/services/snapshot.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음
// 목적: 다양한 원본 JSON 포맷을 읽어 표준 스키마로 정규화한 스냅샷을 생성한다.

const fs = require('fs')
const path = require('path')
const { normalizeRow } = require('../lib/normalize')

/**
 * 다양한 JSON 포맷을 유연하게 읽는다.
 * 지원 포맷:
 *  - 배열 전체
 *  - { data: [...] }
 *  - { items: [...] }
 *  - NDJSON
 */
function readFlexibleJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return []
    const raw = fs.readFileSync(filePath, 'utf-8').trim()
    if (!raw) return []

    // NDJSON 감지
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

/**
 * 단일 원본 레코드를 정규화하고, 원본에만 있는 부가 필드를 안전하게 병합한다.
 */
function adaptRecordSafe(rawRow) {
  // 표준 스키마로 정규화
  const out = normalizeRow(rawRow)

  // 원본에만 있는 보조 필드 보존 병합
  if (out.transmission == null) out.transmission = rawRow.gear ?? rawRow.transmission ?? null
  if (out.segment == null) out.segment = rawRow.segment ?? null

  if ((!out.options || out.options.length === 0) && Array.isArray(rawRow.options)) {
    out.options = rawRow.options.slice()
  }
  if ((!out.tags || out.tags.length === 0) && Array.isArray(rawRow.tags)) {
    out.tags = rawRow.tags.slice()
  }

  // 필요시 원본 전체를 보관하려면 주석을 해제
  // out.raw = rawRow

  return out
}

/**
 * 배열을 스냅샷으로 변환한다.
 */
function buildSnapshotFromArray(arr) {
  const list = (Array.isArray(arr) ? arr : []).map(adaptRecordSafe)
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    list,
  }
}

/**
 * 대상 파일 변경을 감시하여 콜백을 호출한다.
 */
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
