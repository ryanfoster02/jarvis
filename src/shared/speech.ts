// Pure helpers for speaking streamed text through a TTS engine. Unit-tested.

/** Below this, wait for more text unless the reply has finished (avoids choppy one-word clips). */
const MIN_CHUNK = 24
/** Above this without a sentence end, break at the last comma/semicolon/dash or space. */
const MAX_CHUNK = 220

const SENTENCE_END = /[.!?…]["'”’)\]]*(?=\s)/g

/**
 * Splits streaming text into speakable chunks. Call with the accumulated, not-yet-spoken buffer.
 * Returns complete chunks to speak now and the remainder to keep buffering.
 * With `final` true (reply finished), everything left is returned.
 */
export function takeSpeakable(buffer: string, final: boolean): { chunks: string[]; rest: string } {
  const chunks: string[] = []
  let rest = buffer

  for (;;) {
    let cut = -1
    SENTENCE_END.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = SENTENCE_END.exec(rest)) !== null) {
      const end = m.index + m[0].length
      if (end >= MIN_CHUNK) {
        cut = end
        break
      }
    }
    if (cut < 0 && rest.length > MAX_CHUNK) {
      const window = rest.slice(0, MAX_CHUNK)
      const soft = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' – '), window.lastIndexOf(' — '))
      cut = soft > MIN_CHUNK ? soft + 1 : window.lastIndexOf(' ') > MIN_CHUNK ? window.lastIndexOf(' ') : MAX_CHUNK
    }
    if (cut < 0) break
    const piece = rest.slice(0, cut).trim()
    if (piece) chunks.push(piece)
    rest = rest.slice(cut).replace(/^\s+/, '')
  }

  if (final) {
    const tail = rest.trim()
    if (tail) chunks.push(tail)
    rest = ''
  }
  return { chunks, rest }
}

/** Strip things a TTS voice shouldn't read aloud if the model slips (markdown, URLs, emoji). */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/[*_`#>]+/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
