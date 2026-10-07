import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import './guestbook.css'

type GuestbookEntry = {
  id: string
  name: string
  message: string
  created_at: string
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <main class="guestbook-page">
    <div class="guestbook-glow guestbook-glow-one" aria-hidden="true"></div>
    <div class="guestbook-glow guestbook-glow-two" aria-hidden="true"></div>

    <header class="guestbook-header">
      <button id="guestbook-home" class="guestbook-home" type="button" aria-label="메인으로 돌아가기">
        <span aria-hidden="true">←</span> lemon experiments
      </button>
      <div class="guestbook-kicker"><span class="guestbook-kicker-dot"></span>LEMON COMMUNITY</div>
      <h1>방명록</h1>
      <p>당신의 오늘을 짧게 남겨주세요.<br />누군가의 하루에 작은 레몬빛이 될 거예요.</p>
    </header>

    <section class="guestbook-layout" aria-label="방명록">
      <form id="guestbook-form" class="guestbook-form" novalidate>
        <div class="form-topline"><span>WRITE A NOTE</span><span class="form-spark" aria-hidden="true">✦</span></div>
        <label for="guestbook-name">이름</label>
        <input id="guestbook-name" name="name" type="text" maxlength="20" autocomplete="name" placeholder="어떻게 불러드릴까요?" required />
        <div class="field-heading"><label for="guestbook-message">하고 싶은 말</label><span id="guestbook-count">0 / 300</span></div>
        <textarea id="guestbook-message" name="message" maxlength="300" rows="6" placeholder="오늘의 한마디를 남겨보세요." required></textarea>
        <button id="guestbook-submit" class="guestbook-submit" type="submit">작성하기 <span aria-hidden="true">↗</span></button>
        <p id="guestbook-status" class="guestbook-status" role="status" aria-live="polite"></p>
      </form>

      <section class="notes-section" aria-labelledby="notes-title">
        <div class="notes-heading">
          <div>
            <span class="notes-kicker">ON THE WALL</span>
            <h2 id="notes-title">남겨진 이야기</h2>
          </div>
          <span id="guestbook-total" class="notes-total">0 notes</span>
        </div>
        <div id="guestbook-list" class="guestbook-list" aria-live="polite">
          <div class="notes-loading">메모를 불러오는 중이에요…</div>
        </div>
      </section>
    </section>

    <footer class="guestbook-footer">made with a little sunshine · <span>✦</span></footer>
  </main>
`

const form = document.querySelector<HTMLFormElement>('#guestbook-form')!
const nameInput = document.querySelector<HTMLInputElement>('#guestbook-name')!
const messageInput = document.querySelector<HTMLTextAreaElement>('#guestbook-message')!
const count = document.querySelector<HTMLSpanElement>('#guestbook-count')!
const submitButton = document.querySelector<HTMLButtonElement>('#guestbook-submit')!
const status = document.querySelector<HTMLParagraphElement>('#guestbook-status')!
const list = document.querySelector<HTMLDivElement>('#guestbook-list')!
const total = document.querySelector<HTMLSpanElement>('#guestbook-total')!
const homeButton = document.querySelector<HTMLButtonElement>('#guestbook-home')!

let entries: GuestbookEntry[] = []
let realtimeChannel: RealtimeChannel | null = null

function setStatus(message: string, kind: 'error' | 'success' | '') {
  status.textContent = message
  status.dataset.kind = kind
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function noteColor(index: number) {
  return ['yellow', 'pink', 'blue', 'green'][index % 4]
}

function renderEntries() {
  list.replaceChildren()
  total.textContent = `${entries.length} notes`

  if (entries.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'notes-empty'
    empty.textContent = '첫 번째 메모를 남겨보세요 ✦'
    list.append(empty)
    return
  }

  entries.forEach((entry, index) => {
    const note = document.createElement('article')
    note.className = `guest-note note-${noteColor(index)}`
    note.style.setProperty('--note-tilt', `${[-2, 1.5, -1, 2.2][index % 4]}deg`)

    const pin = document.createElement('span')
    pin.className = 'note-pin'
    pin.setAttribute('aria-hidden', 'true')
    const text = document.createElement('p')
    text.className = 'note-message'
    text.textContent = entry.message
    const meta = document.createElement('div')
    meta.className = 'note-meta'
    const author = document.createElement('strong')
    author.textContent = entry.name
    const date = document.createElement('time')
    date.dateTime = entry.created_at
    date.textContent = formatDate(entry.created_at)
    meta.append(author, date)
    note.append(pin, text, meta)
    list.append(note)
  })
}

async function loadEntries() {
  if (!supabase) {
    list.replaceChildren()
    const setupMessage = document.createElement('div')
    setupMessage.className = 'notes-empty notes-error'
    setupMessage.textContent = 'Supabase 연결 설정이 아직 필요해요.'
    list.append(setupMessage)
    setStatus('VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 설정해 주세요.', 'error')
    return
  }

  const { data, error } = await supabase
    .from('guestbook_entries')
    .select('id, name, message, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    list.replaceChildren()
    const errorMessage = document.createElement('div')
    errorMessage.className = 'notes-empty notes-error'
    errorMessage.textContent = '메모를 불러오지 못했어요. Supabase 설정을 확인해 주세요.'
    list.append(errorMessage)
    setStatus(error.message, 'error')
    return
  }

  entries = (data ?? []) as GuestbookEntry[]
  renderEntries()
  subscribeToNewEntries()
}

function subscribeToNewEntries() {
  if (!supabase || realtimeChannel) return

  realtimeChannel = supabase
    .channel('guestbook-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guestbook_entries' }, (payload) => {
      const entry = payload.new as GuestbookEntry
      if (!entries.some((existing) => existing.id === entry.id)) {
        entries = [entry, ...entries].slice(0, 100)
        renderEntries()
      }
    })
    .subscribe()
}

async function submitEntry(event: SubmitEvent) {
  event.preventDefault()
  if (!supabase) {
    setStatus('먼저 Supabase 환경변수를 설정해 주세요.', 'error')
    return
  }

  const name = nameInput.value.trim()
  const message = messageInput.value.trim()
  if (!name || !message) {
    setStatus('이름과 하고 싶은 말을 모두 입력해 주세요.', 'error')
    return
  }

  submitButton.disabled = true
  submitButton.textContent = '저장하는 중…'
  setStatus('', '')

  const { data, error } = await supabase
    .from('guestbook_entries')
    .insert({ name, message })
    .select('id, name, message, created_at')
    .single()

  submitButton.disabled = false
  submitButton.innerHTML = '작성하기 <span aria-hidden="true">↗</span>'

  if (error) {
    setStatus('저장하지 못했어요. 잠시 후 다시 시도해 주세요.', 'error')
    console.error('Could not save guestbook entry.', error)
    return
  }

  if (data && !entries.some((entry) => entry.id === data.id)) {
    entries = [data as GuestbookEntry, ...entries].slice(0, 100)
    renderEntries()
  }
  form.reset()
  count.textContent = '0 / 300'
  setStatus('방명록이 포스트잇으로 붙었어요 ✦', 'success')
}

messageInput.addEventListener('input', () => {
  count.textContent = `${messageInput.value.length} / 300`
})
form.addEventListener('submit', (event) => void submitEntry(event))
homeButton.addEventListener('click', () => {
  const url = new URL(window.location.href)
  url.searchParams.delete('page')
  window.location.assign(url.href)
})

void loadEntries()

window.addEventListener('pagehide', () => {
  if (realtimeChannel) void realtimeChannel.unsubscribe()
})
