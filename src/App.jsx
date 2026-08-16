import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import { juniorQuestions } from './data/questions_junior'
import { seniorQuestions } from './data/questions_senior'

/* ============================================================
   ข้อมูลคำถาม — ดึงจากไฟล์ src/data/questions_junior.js และ questions_senior.js
   แต่ละไฟล์ export { main: [...30 ข้อ...], reserve: [...10 ข้อ...] }
   โครงสร้างคำถาม: { q: "คำถาม", choices: ["ก","ข","ค","ง"], a: index (0-3) }
   ============================================================ */
const QUESTIONS = {
  junior: juniorQuestions.main,
  senior: seniorQuestions.main,
}

// ข้อสอบสำรอง (ข้อ 31–40) — เก็บไว้ให้กรรมการใช้กรณีจำเป็น
// eslint-disable-next-line no-unused-vars
const RESERVE_QUESTIONS = {
  junior: juniorQuestions.reserve,
  senior: seniorQuestions.reserve,
}

const LEVEL_LABEL = { junior: 'ระดับ ม.ต้น', senior: 'ระดับ ม.ปลาย' }
const SECONDS_PER_QUESTION = 60
const BEEP_START = 15 // เริ่มบี๊บเตือนเมื่อเหลือ ≤ 15 วินาที

// ข้อตัวอย่างก่อนเริ่มข้อจริง — ใส่ null สำหรับระดับที่ไม่ต้องการข้อตัวอย่าง
const EXAMPLE_QUESTIONS = {
  junior: {
    q: 'สิ่งมีชีวิตในข้อใดจัดอยู่ในกลุ่มสัตว์เลี้ยงลูกด้วยนม (Mammal)',
    choices: ['ปลาฉลาม', 'จระเข้', 'โลมา', 'นกกระจอกเทศ'],
    a: 2,
  },
  senior: null,
}

// ไฟล์เสียงอ่านคำถาม: public/audio/{level}_{main|reserve}_q{เลขข้อ}.mp3 (เลขข้อนับจาก 1)
// ข้อตัวอย่าง: public/audio/{level}_example.mp3
function getQuestionAudioPath(level, isReserveRound, idx, showExample) {
  if (!level) return null
  if (showExample) return `/audio/${level}_example.mp3`
  return `/audio/${level}_${isReserveRound ? 'reserve' : 'main'}_q${idx + 1}.mp3`
}

/* ============================================================
   Web Audio API — สร้างเสียงทั้งหมดเอง ไม่ใช้ไฟล์เสียง
   ============================================================ */
function useAudio() {
  const ctxRef = useRef(null)

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext
      ctxRef.current = new AC()
    }
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume()
    return ctxRef.current
  }, [])

  // เสียงบี๊บสั้น แหลม (triangle) สำหรับนับถอยหลัง
  const beep = useCallback(
    (freq = 880, duration = 0.12, gain = 0.25, type = 'triangle') => {
      const ctx = getCtx()
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, now)
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(gain, now + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration)
      osc.connect(g).connect(ctx.destination)
      osc.start(now)
      osc.stop(now + duration + 0.02)
    },
    [getCtx],
  )

  // เสียงหมดเวลา: บี๊บสั้น 2 ครั้ง แล้วจบด้วยเสียงยาว
  const timeUp = useCallback(() => {
    const ctx = getCtx()
    const play = (freq, start, dur, gain = 0.3, type = 'square') => {
      const t0 = ctx.currentTime + start
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, t0)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(g).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + dur + 0.03)
    }
    play(660, 0.0, 0.16)
    play(660, 0.22, 0.16)
    play(392, 0.46, 0.8) // เสียงยาวต่ำจบท้าย
  }, [getCtx])

  return { beep, timeUp }
}

/* ============================================================
   Circuit divider — เส้นวงจรมีจุดพัลส์วิ่งผ่าน
   ============================================================ */
function CircuitDivider({ running = true }) {
  return (
    <div className="circuit-divider" aria-hidden="true">
      <span className="node" />
      <span className="line">
        <span className={`pulse ${running ? '' : 'paused'}`} />
      </span>
      <span className="node" />
    </div>
  )
}

/* ============================================================
   เนื้อหาหน้าเกณฑ์การแข่งขัน
   ============================================================ */
const RULE_TABS = [
  { id: 'level', label: 'ระดับ วัน และเวลา' },
  { id: 'qualify', label: 'คุณสมบัติผู้เข้าแข่งขัน' },
  { id: 'rules', label: 'กติกา' },
  { id: 'prize', label: 'รางวัล' },
]

const EXAM_TOPICS = {
  junior: [
    'ประวัติคอมพิวเตอร์',
    'องค์ประกอบของคอมพิวเตอร์',
    'ฮาร์ดแวร์',
    'ซอฟต์แวร์',
    'ข้อมูลและสารสนเทศ',
    'เครือข่ายคอมพิวเตอร์',
    'โซเชียลมีเดีย',
    'ความปลอดภัยในระบบคอมพิวเตอร์',
    'วิทยาการคำนวณ',
    'ความรู้รอบตัวเกี่ยวกับคอมพิวเตอร์และเทคโนโลยีสารสนเทศ',
    'เทคโนโลยีทางคอมพิวเตอร์ที่เกิดขึ้นใหม่',
  ],
  senior: [
    'วิทยาการคอมพิวเตอร์',
    'เทคโนโลยีสารสนเทศ',
    'เทคโนโลยีการจัดการข้อมูล',
    'เครือข่ายคอมพิวเตอร์',
    'โซเชียลมีเดีย',
    'ความปลอดภัยในระบบคอมพิวเตอร์',
    'วิทยาการคำนวณ',
    'อัลกอริทึม',
    'ปัญญาประดิษฐ์',
    'ความรู้รอบตัวเกี่ยวกับคอมพิวเตอร์และเทคโนโลยีสารสนเทศ',
    'เทคโนโลยีทางคอมพิวเตอร์ที่เกิดขึ้นใหม่',
  ],
}

/* ============================================================
   Component หลัก
   ============================================================ */
export default function App() {
  const [screen, setScreen] = useState('intro') // intro | cover | rules | quiz | finished
  const [level, setLevel] = useState(null) // junior | senior
  const [ruleTab, setRuleTab] = useState('level')

  // สถานะ Quiz
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [timeLeft, setTimeLeft] = useState(SECONDS_PER_QUESTION)
  const [running, setRunning] = useState(false)
  const [flash, setFlash] = useState(false) // เอฟเฟกต์กระพริบแดงตอนหมดเวลา
  const [showExample, setShowExample] = useState(false) // แสดงข้อตัวอย่างก่อนข้อจริงข้อที่ 1

  const rootRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { beep, timeUp } = useAudio()

  const isReserveRound = false // TODO: ผูกกับสวิตช์รอบข้อสอบสำรองเมื่อมี UI รองรับ
  const questions = level ? QUESTIONS[level] : []
  const current = showExample ? EXAMPLE_QUESTIONS[level] : questions[index]
  const total = questions.length

  /* ---------- เสียงอ่านคำถาม (เล่นตามสั่งเมื่อกด "เริ่มอ่าน" เท่านั้น) ---------- */
  const questionAudioRef = useRef(null)
  const startReading = useCallback(() => {
    if (screen !== 'quiz' || !level) return
    const path = getQuestionAudioPath(level, isReserveRound, index, showExample)
    if (!path) return
    if (!questionAudioRef.current) {
      questionAudioRef.current = new Audio()
      questionAudioRef.current.onerror = () => {
        // ไม่มีไฟล์เสียงสำหรับข้อนี้ ปล่อยผ่านเงียบ ๆ ไม่รบกวนกรรมการ
      }
    }
    const audio = questionAudioRef.current
    audio.pause()
    audio.currentTime = 0
    audio.src = path
    audio.play().catch((err) => {
      console.warn('เล่นเสียงคำถามไม่สำเร็จ (เบราว์เซอร์อาจบล็อก autoplay):', err)
    })
  }, [screen, level, isReserveRound, index, showExample])

  useEffect(() => {
    return () => {
      questionAudioRef.current?.pause()
    }
  }, [])

  /* ---------- Fullscreen ---------- */
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!document.fullscreenElement) {
      el?.requestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  /* ---------- ตัวจับเวลานับถอยหลัง ----------
     จัดการเสียง/หมดเวลาภายใน callback ของ interval (external system)
     เพื่อเลี่ยงการ setState แบบ cascading ใน effect body */
  const prevTimeRef = useRef(SECONDS_PER_QUESTION)
  const flashTimeoutRef = useRef(null)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setTimeLeft((t) => {
        const next = t - 1
        if (next <= 0) {
          setRunning(false)
          timeUp()
          setFlash(true)
          if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
          flashTimeoutRef.current = setTimeout(() => setFlash(false), 900)
          prevTimeRef.current = 0
          return 0
        }
        if (next <= BEEP_START) {
          beep(880, 0.12, 0.25, 'triangle')
        }
        prevTimeRef.current = next
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [running, beep, timeUp])

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    }
  }, [])

  /* ---------- การกระทำใน Quiz ---------- */
  const startLevel = useCallback((lv) => {
    setLevel(lv)
    setIndex(0)
    setRevealed(false)
    setTimeLeft(SECONDS_PER_QUESTION)
    prevTimeRef.current = SECONDS_PER_QUESTION
    setRunning(false)
    setFlash(false)
    setShowExample(!!EXAMPLE_QUESTIONS[lv])
    setScreen('quiz')
  }, [])

  const toggleTimer = useCallback(() => {
    setRunning((r) => {
      // ถ้าเวลาเป็น 0 อยู่ กดเริ่มใหม่ให้รีเซ็ตเป็นเต็มก่อน
      if (!r && timeLeft <= 0) {
        setTimeLeft(SECONDS_PER_QUESTION)
        prevTimeRef.current = SECONDS_PER_QUESTION
      }
      return !r
    })
  }, [timeLeft])

  const toggleReveal = useCallback(() => setRevealed((v) => !v), [])

  const nextQuestion = useCallback(() => {
    if (showExample) {
      // ออกจากข้อตัวอย่าง เข้าสู่ข้อจริงข้อที่ 1 (idx ยังคงเป็น 0 อยู่แล้ว)
      setShowExample(false)
      setRevealed(false)
      setRunning(false)
      setTimeLeft(SECONDS_PER_QUESTION)
      prevTimeRef.current = SECONDS_PER_QUESTION
      setFlash(false)
      return
    }
    setIndex((i) => {
      if (i + 1 >= total) {
        setScreen('finished')
        return i
      }
      return i + 1
    })
    setRevealed(false)
    setRunning(false)
    setTimeLeft(SECONDS_PER_QUESTION)
    prevTimeRef.current = SECONDS_PER_QUESTION
    setFlash(false)
  }, [total, showExample])

  const prevQuestion = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : i))
    setRevealed(false)
    setRunning(false)
    setTimeLeft(SECONDS_PER_QUESTION)
    prevTimeRef.current = SECONDS_PER_QUESTION
    setFlash(false)
  }, [])

  const goHome = useCallback(() => {
    setScreen('cover')
    setLevel(null)
    setRunning(false)
  }, [])

  /* ---------- คีย์ลัดทั้งหมด (listen ที่ window) ---------- */
  useEffect(() => {
    const onKey = (e) => {
      const key = e.key
      // F = fullscreen ทุกหน้า
      if (key === 'f' || key === 'F' || key === 'ฟ') {
        e.preventDefault()
        toggleFullscreen()
        return
      }
      if ((screen === 'rules' || screen === 'quiz') && key === 'Escape') {
        e.preventDefault()
        goHome()
        return
      }
      if (screen === 'quiz') {
        if (key === ' ' || key === 'Spacebar') {
          e.preventDefault()
          toggleTimer()
        } else if (key === 'Enter') {
          e.preventDefault()
          toggleReveal()
        } else if (key === 'n' || key === 'N' || key === 'ๆ' || key === 'ArrowRight') {
          e.preventDefault()
          nextQuestion()
        } else if (key === 'ArrowLeft') {
          e.preventDefault()
          prevQuestion()
        } else if (key === 'p' || key === 'P' || key === 'ผ') {
          e.preventDefault()
          startReading()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    screen,
    toggleFullscreen,
    goHome,
    toggleTimer,
    toggleReveal,
    nextQuestion,
    prevQuestion,
    startReading,
  ])

  /* ---------- Render ---------- */
  return (
    <div
      className={`app ${isFullscreen ? 'is-fullscreen' : ''}`}
      ref={rootRef}
    >
      <div className="bg-grid" aria-hidden="true" />
      <div className="bg-glow glow-1" aria-hidden="true" />
      <div className="bg-glow glow-2" aria-hidden="true" />
      {flash && <div className="flash-red" aria-hidden="true" />}

      {screen === 'intro' && (
        <IntroScreen onEnter={() => setScreen('cover')} />
      )}

      {screen === 'cover' && (
        <CoverScreen
          onStart={startLevel}
          onRules={() => {
            setRuleTab('level')
            setScreen('rules')
          }}
        />
      )}

      {screen === 'rules' && (
        <RulesScreen
          tab={ruleTab}
          setTab={setRuleTab}
          onHome={goHome}
        />
      )}

      {screen === 'quiz' && current && (
        <QuizScreen
          level={level}
          index={index}
          total={total}
          question={current}
          revealed={revealed}
          timeLeft={timeLeft}
          running={running}
          onToggleTimer={toggleTimer}
          onToggleReveal={toggleReveal}
          onPrev={prevQuestion}
          onNext={nextQuestion}
          onHome={goHome}
          onStartReading={startReading}
          showExample={showExample}
        />
      )}

      {screen === 'finished' && (
        <FinishedScreen level={level} total={total} onHome={goHome} />
      )}
    </div>
  )
}

/* ============================================================
   หน้า Cover
   ============================================================ */
/* ============================================================
   หน้า Intro — ภาพโปสเตอร์ คลิกเพื่อเข้าหน้าเลือกระดับ
   ============================================================ */
function IntroScreen({ onEnter }) {
  return (
    <main className="screen intro">
      <button
        className="intro-poster-btn"
        onClick={onEnter}
        aria-label="เข้าสู่หน้าการแข่งขัน"
      >
        <img
          className="intro-poster"
          src="/Gemini_Generated_Image_kbkuogkbkuogkbku.jpeg"
          alt="การแข่งขันตอบปัญหาทางคอมพิวเตอร์ เทคโนโลยีสารสนเทศ และวิทยาการคำนวณ"
        />
      </button>
    </main>
  )
}

function CoverScreen({ onStart, onRules }) {
  return (
    <main className="screen cover">
      <div className="cover-inner">
        <p className="eyebrow">SCI DAY · การแข่งขันวิชาการ</p>
        <h1 className="cover-title">
          การแข่งขันตอบปัญหาทางคอมพิวเตอร์
          <br />
          <span className="accent">เทคโนโลยีสารสนเทศ และวิทยาการคำนวณ</span>
        </h1>
        <CircuitDivider />
        <p className="cover-sub">
          เลือกระดับการแข่งขันเพื่อเริ่มต้น — คำถามข้อละ 1 คะแนน จับเวลาข้อละ 1 นาที
        </p>

        <div className="level-buttons">
          <button className="level-btn" onClick={() => onStart('junior')}>
            <span className="lv-name">มัธยมศึกษาตอนต้น</span>
            <span className="lv-text">ชั้น ม.1 – ม.3 · {QUESTIONS.junior.length} ข้อ</span>
          </button>
          <button className="level-btn" onClick={() => onStart('senior')}>
            <span className="lv-name">มัธยมศึกษาตอนปลาย</span>
            <span className="lv-text">ชั้น ม.4 – ม.6 · {QUESTIONS.senior.length} ข้อ</span>
          </button>
        </div>

        <button className="rules-link-btn" onClick={onRules}>
          📋 เกณฑ์การแข่งขัน · คุณสมบัติผู้เข้าแข่งขัน · กติกา · รางวัล
        </button>

        <div className="hotkey-bar">
          <Hotkey k="F" desc="เต็มจอ" />
          <Hotkey k="P" desc="เริ่มอ่าน" />
          <Hotkey k="Space" desc="เริ่ม/หยุดเวลา" />
          <Hotkey k="Enter" desc="เฉลย" />
          <Hotkey k="N / →" desc="ข้อถัดไป" />
          <Hotkey k="←" desc="ย้อนกลับ" />
          <Hotkey k="Esc" desc="กลับหน้าแรก" />
        </div>
      </div>
    </main>
  )
}

function Hotkey({ k, desc }) {
  return (
    <span className="hotkey">
      <kbd>{k}</kbd>
      <span>{desc}</span>
    </span>
  )
}

/* ============================================================
   หน้าเกณฑ์การแข่งขัน
   ============================================================ */
function RulesScreen({ tab, setTab, onHome }) {
  return (
    <main className="screen rules">
      <header className="rules-head">
        <div>
          <h2 className="rules-title">เกณฑ์การแข่งขัน</h2>
          <CircuitDivider />
        </div>
        <button className="ghost-btn small" onClick={onHome}>
          ← กลับหน้าแรก <kbd>Esc</kbd>
        </button>
      </header>

      <div className="rules-body">
        <nav className="rules-tabs">
          {RULE_TABS.map((t) => (
            <button
              key={t.id}
              className={`rule-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <section className="rules-content">
          {tab === 'level' && <RulesLevel />}
          {tab === 'qualify' && <RulesQualify />}
          {tab === 'rules' && <RulesGameplay />}
          {tab === 'prize' && <RulesPrize />}
        </section>
      </div>
    </main>
  )
}

function RulesLevel() {
  return (
    <div className="rc">
      <h3>ระดับ วัน และเวลา</h3>
      <ul className="rc-list">
        <li><strong>ระดับมัธยมศึกษาตอนต้น (ม.1–ม.3)</strong> — แข่งขันภาคเช้า เวลา 09.00–11.00 น.</li>
        <li><strong>ระดับมัธยมศึกษาตอนปลาย (ม.4–ม.6)</strong> — แข่งขันภาคบ่าย เวลา 13.00–15.00 น.</li>
        <li>
          จัดการแข่งขันในงานสัปดาห์วิทยาศาสตร์ ณ ห้องประชุมทางไกล
          อาคารศูนย์ภาษาและคอมพิวเตอร์ มหาวิทยาลัยราชภัฏเลย
        </li>
        <li>ผู้เข้าแข่งขันรายงานตัวก่อนเวลาเริ่มการแข่งขันอย่างน้อย 15 นาที</li>
      </ul>
    </div>
  )
}

function RulesQualify() {
  return (
    <div className="rc">
      <h3>คุณสมบัติผู้เข้าแข่งขัน</h3>
      <ul className="rc-list">
        <li>
          ระดับมัธยมศึกษาตอนต้น เป็นนักเรียนที่กำลังศึกษาอยู่ในระดับมัธยมศึกษาตอนต้น
          โดยโรงเรียนส่งผู้เข้าแข่งขันได้ 1 ทีม ทีมละ 2 คน
        </li>
        <li>
          ระดับมัธยมศึกษาตอนปลาย เป็นนักเรียนที่กำลังศึกษาอยู่ในระดับมัธยมศึกษาตอนปลาย
          โดยโรงเรียนส่งผู้เข้าแข่งขันได้ 1 ทีม ทีมละ 2 คน
        </li>
      </ul>
    </div>
  )
}

function RulesGameplay() {
  return (
    <div className="rc">
      <h3>กติกาการแข่งขัน</h3>
      <ul className="rc-list">
        <li>
          ผู้เข้าร่วมการแข่งขันระดับมัธยมศึกษาตอนต้น จะต้องตอบปัญหาทางคอมพิวเตอร์
          เทคโนโลยีสารสนเทศ และวิทยาการคำนวณ จำนวน 30 ข้อ ข้อละ 1 คะแนน
        </li>
        <li>
          ผู้เข้าร่วมการแข่งขันระดับมัธยมศึกษาตอนปลาย จะต้องตอบปัญหาทางคอมพิวเตอร์
          เทคโนโลยีสารสนเทศ และวิทยาการคำนวณ จำนวน 30 ข้อ ข้อละ 1 คะแนน
        </li>
        <li>
          กรณี (ถ้ามี) ที่มีผู้เข้าแข่งขันได้คะแนนเท่ากัน
          ให้ทำการแข่งขันตอบปัญหาข้อพิเศษเพิ่มเติมจากคำถามสำรองจนกว่าจะได้ทีมที่ชนะ
        </li>
      </ul>

      <h4 className="rc-subhead">ขอบเขตเนื้อหา ระดับมัธยมศึกษาตอนต้น</h4>
      <div className="topic-tags">
        {EXAM_TOPICS.junior.map((t) => (
          <span className="topic-tag" key={t}>
            {t}
          </span>
        ))}
      </div>

      <h4 className="rc-subhead">ขอบเขตเนื้อหา ระดับมัธยมศึกษาตอนปลาย</h4>
      <div className="topic-tags">
        {EXAM_TOPICS.senior.map((t) => (
          <span className="topic-tag" key={t}>
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}

function RulesPrize() {
  const rows = [
    ['มัธยมศึกษาตอนต้น', '1,500', '1,000', '700', '500'],
    ['มัธยมศึกษาตอนปลาย', '1,500', '1,000', '700', '500'],
  ]
  return (
    <div className="rc">
      <h3>รางวัล</h3>
      <div className="table-wrap">
        <table className="prize-table">
          <thead>
            <tr>
              <th rowSpan={2}>ระดับ</th>
              <th colSpan={4}>รางวัล (บาท)</th>
            </tr>
            <tr>
              <th>รางวัลที่ 1</th>
              <th>รางวัลที่ 2</th>
              <th>รางวัลที่ 3</th>
              <th>รางวัลชมเชย 3 รางวัล ๆ ละ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]}>
                <td className="prize-rank">{r[0]}</td>
                <td className="prize-amount">{r[1]}</td>
                <td className="prize-amount">{r[2]}</td>
                <td className="prize-amount">{r[3]}</td>
                <td className="prize-amount">{r[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ============================================================
   หน้า Quiz
   ============================================================ */
function QuizScreen({
  level,
  index,
  total,
  question,
  revealed,
  timeLeft,
  running,
  onToggleTimer,
  onToggleReveal,
  onPrev,
  onNext,
  onHome,
  onStartReading,
  showExample,
}) {
  const CHOICE_LABELS = ['A', 'B', 'C', 'D']
  const warn = timeLeft <= BEEP_START && timeLeft > 0
  const over = timeLeft <= 0
  const timerState = over ? 'over' : warn ? 'warn' : 'normal'

  return (
    <main className="screen quiz">
      <header className="quiz-head">
        <div className="quiz-head-left">
          <span className="level-chip">{LEVEL_LABEL[level]}</span>
          {!showExample && <ProgressDots total={total} index={index} />}
        </div>
        <div className="quiz-head-right">
          <span className="q-counter">
            {showExample ? (
              'ตัวอย่าง'
            ) : (
              <>
                ข้อ <strong>{index + 1}</strong> / {total}
              </>
            )}
          </span>
          <button className="ghost-btn small" onClick={onHome}>
            ← หน้าแรก
          </button>
        </div>
      </header>

      <div className="quiz-main">
        <section className="question-area">
          <div className="question-row">
            <div className="question-card">
              <span className="q-num-tag">
                {showExample ? 'ตัวอย่าง' : `ข้อ ${index + 1}`}
              </span>
              <p className="question-text">{question.q}</p>
            </div>
            <ChipTimer seconds={timeLeft} state={timerState} running={running} />
          </div>
          <CircuitDivider running={running} />

          <div className="choices-grid">
            {question.choices.map((c, i) => {
              const isAnswer = i === question.a
              let cls = 'choice-card'
              if (revealed && isAnswer) cls += ' correct'
              else if (revealed) cls += ' dim'
              return (
                <div className={cls} key={i}>
                  <span className="choice-label">{CHOICE_LABELS[i]}</span>
                  <span className="choice-text">{c}</span>
                  {revealed && isAnswer && (
                    <span className="choice-check">✓</span>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <div className="control-panel">
        <button className="btn" onClick={onStartReading}>
          ▶️ เริ่มอ่าน <kbd>P</kbd>
        </button>
        <button
          className={`btn ${running ? 'active' : ''}`}
          onClick={onToggleTimer}
        >
          {running ? '⏸ หยุดเวลา' : '▶ เริ่มเวลา'}
          <kbd>Space</kbd>
        </button>
        <button
          className={`btn ${revealed ? 'active' : ''}`}
          onClick={onToggleReveal}
        >
          {revealed ? '🙈 ซ่อนเฉลย' : '💡 เฉลย'}
          <kbd>Enter</kbd>
        </button>
        <button className="btn primary" onClick={onNext}>
          ข้อถัดไป → <kbd>N</kbd>
        </button>
        <button className="btn" onClick={onPrev} disabled={index === 0}>
          ← ย้อนกลับ
        </button>
      </div>
    </main>
  )
}

function ProgressDots({ total, index }) {
  return (
    <div className="progress-dots" aria-label={`ความคืบหน้า ${index + 1}/${total}`}>
      {Array.from({ length: total }).map((_, i) => {
        let cls = 'dot'
        if (i < index) cls += ' done'
        else if (i === index) cls += ' current'
        return <span className={cls} key={i} />
      })}
    </div>
  )
}

function ChipTimer({ seconds, state, running }) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return (
    <div className={`chip-timer state-${state} ${running ? 'ticking' : ''}`}>
      <span className="pin tl" />
      <span className="pin tr" />
      <span className="pin bl" />
      <span className="pin br" />
      <span className="chip-label">เวลา</span>
      <span className="chip-time">
        {mm}:{ss}
      </span>
      <span className="chip-status">
        {state === 'over' ? 'หมดเวลา' : running ? 'กำลังนับ' : 'พร้อม'}
      </span>
    </div>
  )
}

/* ============================================================
   หน้า Finished
   ============================================================ */
function FinishedScreen({ level, total, onHome }) {
  return (
    <main className="screen finished">
      <div className="finished-inner">
        <div className="finished-badge">✓</div>
        <h2 className="finished-title">จบการแข่งขัน</h2>
        <CircuitDivider />
        <p className="finished-sub">
          {LEVEL_LABEL[level]} — ทำครบทั้งหมด <strong>{total}</strong> ข้อเรียบร้อยแล้ว
        </p>
        <button className="level-btn solo" onClick={onHome}>
          <span className="lv-text">กลับหน้าแรก</span>
        </button>
      </div>
    </main>
  )
}
