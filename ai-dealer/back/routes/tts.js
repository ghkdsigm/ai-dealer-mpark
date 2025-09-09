// back/routes/tts.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음
const express = require('express')
const router = express.Router()

let GCloudTTS = null
try {
  GCloudTTS = require('@google-cloud/text-to-speech')
} catch (_) {
  // 구글 클라우드 모듈이 없어도 fallback으로 진행
}

let fetchFn = global.fetch
if (!fetchFn) fetchFn = require('node-fetch')

const useGoogle = !!(process.env.GOOGLE_APPLICATION_CREDENTIALS && GCloudTTS)

router.post('/', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim()
    if (!text) return res.status(400).json({ error: 'no text' })

    if (useGoogle) {
      // Google Cloud TTS 경로
      const client = new GCloudTTS.TextToSpeechClient()

      const ssml =
        `<speak>` +
        `<prosody rate="95%" pitch="+3st">` +
        text.replace(/&/g, '&amp;') +
        `</prosody>` +
        `</speak>`

      const request = {
        input: { ssml },
        // ko-KR-Neural2-A: 자연스러운 여성 음성
        voice: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-A' },
        audioConfig: { audioEncoding: 'MP3' },
      }

      const [response] = await client.synthesizeSpeech(request)
      res.setHeader('Content-Type', 'audio/mpeg')
      return res.send(Buffer.from(response.audioContent, 'base64'))
    }

    // fallback: google-tts-api 사용 (키 불필요)
    const gtts = require('google-tts-api')
    const url = gtts.getAudioUrl(text, {
      lang: 'ko',
      slow: false,
      host: 'https://translate.google.com',
    })
    const r = await fetchFn(url)
    if (!r.ok) throw new Error('fallback fetch failed: ' + r.status)
    const buf = Buffer.from(await r.arrayBuffer())
    res.setHeader('Content-Type', 'audio/mpeg')
    return res.send(buf)
  } catch (e) {
    console.error('[tts] error:', e)
    return res.status(500).json({ error: 'tts_failed' })
  }
})

module.exports = router
