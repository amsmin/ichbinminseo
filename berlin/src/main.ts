import './style.css'

const PASSWORD = 'willkommen'
const transitionSound = new Audio(new URL('../public/a.mp3', import.meta.url).href)
transitionSound.preload = 'auto'

type PracticeSentence = {
  german: string
  korean: string
  audio: string | null
}

const practiceSentences: PracticeSentence[] = [
  {
    german: 'Nächste Station: Alexanderplatz.',
    korean: '다음 역: 알렉산더플라츠.',
    audio: new URL('../public/1-1.mp3', import.meta.url).href,
  },
  {
    german: 'Übergang zu den U-Bahn-Linien U2, U5, U8 und zum Regionalverkehr.',
    korean: 'U2, U5, U8 및 지역열차로 환승할 수 있습니다.',
    audio: new URL('../public/1-2.mp3', import.meta.url).href,
  },
  {
    german: 'Achtung! Türen können automatisch öffnen.',
    korean: '주의! 문이 자동으로 열릴 수 있습니다.',
    audio: new URL('../public/1-3.mp3', import.meta.url).href,
  },
  {
    german: 'Ausstieg links.',
    korean: '왼쪽으로 내리세요.',
    audio: new URL('../public/1-4.mp3', import.meta.url).href,
  },
]

type PracticeStation = {
  image: string
  alt: string
  sentences: PracticeSentence[]
}

const practiceStations: PracticeStation[] = [
  {
    image: new URL('../public/2..png', import.meta.url).href,
    alt: 'Alexanderplatz station sign',
    sentences: practiceSentences,
  },
  {
    image: new URL('../public/3..png', import.meta.url).href,
    alt: 'Hackescher Markt station sign',
    sentences: [
      {
        german: 'Nächste Station: Hackescher Markt.',
        korean: '다음 역: 하케셔 마르크트.',
        audio: null,
      },
      {
        german: 'Achtung! Türen können automatisch öffnen.',
        korean: '주의! 문이 자동으로 열릴 수 있습니다.',
        audio: null,
      },
      {
        german: 'Ausstieg links.',
        korean: '왼쪽으로 내리세요.',
        audio: null,
      },
    ],
  },
  {
    image: new URL('../public/4..png', import.meta.url).href,
    alt: 'Friedrichstraße station sign',
    sentences: [
      {
        german: 'Nächste Station: Friedrichstraße.',
        korean: '다음 역: 프리드리히슈트라세.',
        audio: null,
      },
      {
        german: 'Übergang zu den S-Bahn-Linien S1, S2, S25, S26, zur U-Bahn-Linie U6 und zum Regionalverkehr.',
        korean: 'S1, S2, S25, S26, U6 및 지역열차로 환승할 수 있습니다.',
        audio: null,
      },
      {
        german: 'Achtung! Türen können automatisch öffnen.',
        korean: '주의! 문이 자동으로 열릴 수 있습니다.',
        audio: null,
      },
      {
        german: 'Ausstieg links.',
        korean: '왼쪽으로 내리세요.',
        audio: null,
      },
    ],
  },
]

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root element was not found.')
}

app.innerHTML = `
  <main class="welcome-page">
    <img
      class="welcome-image"
      src="${new URL('../public/willkommen.png', import.meta.url).href}"
      alt="Willkommen in Berlin"
    />

    <form class="password-form" aria-label="Password entry">
      <div class="password-line">
        <span class="masked-value" aria-hidden="true"></span>
        <span class="typing-caret" aria-hidden="true"></span>
        <input
          class="password-input"
          type="text"
          aria-label="Password"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
      </div>
      <button class="enter-button" type="submit">enter</button>
    </form>
  </main>
`

const form = app.querySelector<HTMLFormElement>('.password-form')!
const passwordInput = app.querySelector<HTMLInputElement>('.password-input')!
const maskedValue = app.querySelector<HTMLSpanElement>('.masked-value')!
const enterButton = app.querySelector<HTMLButtonElement>('.enter-button')!

let password = ''

const renderMaskedValue = () => {
  maskedValue.textContent = '•'.repeat(password.length)
}

const focusPasswordInput = () => {
  passwordInput.focus()
}

const prepareNextPageTransition = () => {
  renderPracticePage()
}

const playTransitionSound = () => {
  transitionSound.currentTime = 0
  void transitionSound.play().catch((error) => {
    console.error('Transition sound could not be played.', error)
  })
}

const checkPassword = () => {
  if (password.toLowerCase() === PASSWORD) {
    playTransitionSound()
    prepareNextPageTransition()
  }
}

passwordInput.addEventListener('input', () => {
  password = passwordInput.value
  renderMaskedValue()
})

form.addEventListener('submit', (event) => {
  event.preventDefault()
  checkPassword()
  focusPasswordInput()
})

form.addEventListener('click', (event) => {
  if (event.target !== enterButton) {
    focusPasswordInput()
  }
})

renderMaskedValue()
focusPasswordInput()

function renderPracticePage() {
  const root = app!

  root.innerHTML = `
    <main class="practice-page">
      <img
        class="practice-image"
        src="${practiceStations[0].image}"
        alt="Alexanderplatz station sign"
      />

      <section class="practice-content" aria-live="polite">
        <div class="practice-text-wrap">
          <div class="practice-text">
            <span class="completed-text"></span><span class="remaining-text"></span>
          </div>
          <input
            class="practice-input"
            type="text"
            aria-label="Type the German sentence"
            autocomplete="off"
            autocapitalize="off"
            autofocus
            spellcheck="false"
          />
          <p class="practice-translation"></p>
        </div>

        <button class="audio-button" type="button" aria-label="Play German audio">
          <span aria-hidden="true">▶</span>
        </button>

      </section>
    </main>
  `

  const practicePage = root.querySelector<HTMLElement>('.practice-page')!
  const practiceImage = root.querySelector<HTMLImageElement>('.practice-image')!
  const completedText = root.querySelector<HTMLSpanElement>('.completed-text')!
  const remainingText = root.querySelector<HTMLSpanElement>('.remaining-text')!
  const practiceTranslation = root.querySelector<HTMLParagraphElement>('.practice-translation')!
  const audioButton = root.querySelector<HTMLButtonElement>('.audio-button')!
  const practiceInput = root.querySelector<HTMLInputElement>('.practice-input')!

  let typedText = ''
  let stationIndex = 0
  let sentenceIndex = 0
  let currentAudio: HTMLAudioElement | null = null

  const getCurrentStation = () => practiceStations[stationIndex]
  const getCurrentSentence = () => getCurrentStation().sentences[sentenceIndex]

  const renderSentence = () => {
    const station = getCurrentStation()
    const sentence = getCurrentSentence()
    completedText.replaceChildren()

    practiceImage.src = station.image
    practiceImage.alt = station.alt

    for (let index = 0; index < typedText.length; index += 1) {
      const character = document.createElement('span')
      character.textContent = typedText[index]

      if (typedText[index] !== sentence.german[index]) {
        character.className = 'typed-incorrect'
      }

      completedText.append(character)
    }

    remainingText.textContent = sentence.german.slice(typedText.length)
    practiceTranslation.textContent = sentence.korean
    audioButton.disabled = sentence.audio === null
  }

  const focusPracticeInput = () => {
    practiceInput.focus()
  }

  const stopCurrentAudio = () => {
    if (!currentAudio) {
      return
    }

    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }

  const playCurrentAudio = () => {
    stopCurrentAudio()

    const source = getCurrentSentence().audio

    if (!source) {
      return
    }

    currentAudio = new Audio(source)
    void currentAudio.play().catch(() => undefined)
  }

  const moveToNextSentence = () => {
    const sentence = getCurrentSentence()

    if (typedText !== sentence.german) {
      return
    }

    if (sentenceIndex < getCurrentStation().sentences.length - 1) {
      sentenceIndex += 1
    } else {
      if (stationIndex === practiceStations.length - 1) {
        return
      }

      stopCurrentAudio()
      stationIndex += 1
      sentenceIndex = 0
    }

    typedText = ''
    practiceInput.value = ''
    renderSentence()
    playCurrentAudio()
    focusPracticeInput()
  }

  practiceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      moveToNextSentence()
    }
  })

  practiceInput.addEventListener('input', () => {
    typedText = practiceInput.value
    renderSentence()
  })

  practicePage.addEventListener('click', (event) => {
    if (event.target !== audioButton) {
      focusPracticeInput()
    }
  })

  audioButton.addEventListener('mousedown', (event) => {
    event.preventDefault()
  })

  audioButton.addEventListener('click', () => {
    playCurrentAudio()
  })

  renderSentence()
  playCurrentAudio()
  focusPracticeInput()
  window.setTimeout(focusPracticeInput, 0)
}
