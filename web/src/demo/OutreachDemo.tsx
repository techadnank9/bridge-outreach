import { useLayoutEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { Avatar, Badge, Bar, Button, Collapse, Spinner, Stage, Window, type Act } from '../stageshow/kit'
import './demo.css'

// The sign-in page's product shot, built from Stageshow's dark-hero gold.
// Story: a strong lead lands at the top of the review queue, the app
// researches why to write now, the draft is ready, the founder approves it,
// it sends, and a reply comes back. Beats: the row opens and pushes the list
// down (Researching, spinner); the why-now line resolves under the name and
// the pill turns Draft ready; the cursor travels to Approve and presses it;
// the pill turns Sent; a beat later it turns Replied, the one lit color.
// After a hold the row closes the way it opened and resets while closed.
//
// Real strings: the page title, the new person and their firm, the why-now
// line, the status, the button. Everything else is placeholder at real line
// heights, so the eye lands on the one row the story is about.

type Phase = 0 | 1 | 2 | 3
type S = { open: boolean; phase: Phase }

const initial: S = { open: false, phase: 0 }
const WORDS = ['Researching', 'Draft ready', 'Sent', 'Replied'] as const
const TONE = ['neutral', 'accent', 'neutral', 'success'] as const

async function script(a: Act<S>) {
  await a.wait(900)
  a.mark('lands')
  a.put({ open: true })
  await a.wait(1600)
  a.mark('ready')
  a.put({ phase: 1 })
  await a.wait(700)
  // On a phone the row has no room for the button: the status alone tells it
  if (a.layout === 'wide') {
    await a.move('approve')
    await a.click('approve')
  } else {
    await a.wait(900)
  }
  a.mark('sent')
  a.put({ phase: 2 })
  await a.wait(1500)
  a.mark('replied')
  a.put({ phase: 3 })
  await a.wait(2400)
  // The queue loses what the loop added in one motion; the closed row's
  // status goes back where nobody sees it
  a.put({ open: false })
  await a.wait(700)
  await a.snap({ phase: 0 })
}

export default function OutreachDemo() {
  return (
    <Stage<S>
      width={720}
      height={440}
      compact={{ below: 720, width: 358, height: 420 }}
      theme="dark"
      initial={initial}
      poster={{ open: true, phase: 3 }}
      script={script}
      cursor={{ at: { wide: { x: 640, y: 400 }, compact: { x: 320, y: 390 } }, ripple: true }}
      className="od">
      {(s, _rect, layout) => (
        <Window title="Today" className="od-win" sidebarWidth={156} sidebar={layout === 'compact' ? undefined : <Side />}>
          <div className="od-body">
            <div className="od-head">
              <div className="od-title">To review</div>
              <Bar w={46} h={7} r={3.5} tone={2} />
            </div>
            <div className="od-list">
              <Collapse open={s.open} reveal="drop">
                <div className="od-row od-row--lead">
                  <Avatar name="Maya Okafor" size={30} tone="accent" />
                  <span className="od-lines">
                    <span className="od-name">Maya Okafor<span className="od-firm">Harbor Seed</span></span>
                    <span className="od-why" data-on={s.phase >= 1 || undefined}>
                      <span className="od-why__text">New $120M fund for collaboration tools, October</span>
                      <span className="od-why__bar"><Bar w={180} h={7} r={3.5} tone={2} /></span>
                    </span>
                  </span>
                  <Badge tone={TONE[s.phase]} className="od-badge" icon={<Mark phase={s.phase} />}>
                    <Label phase={s.phase} />
                  </Badge>
                  <Button size="small" variant={s.phase >= 2 ? 'secondary' : 'primary'} icon={<Send size={12} strokeWidth={2.2} />} data-target="approve" data-cursor="pointer" className="od-approve">
                    {s.phase >= 2 ? 'Approved' : 'Approve'}
                  </Button>
                </div>
              </Collapse>
              {[170, 140, 190, 120].map((w, i) => (
                <div key={i} className="od-row od-row--filler">
                  <Avatar plain size={30} />
                  <span className="od-lines">
                    <Bar w={w} h={8} r={4} tone={2} />
                    <Bar w={w - 50} h={7} r={3.5} tone={1} />
                  </span>
                  <Bar w={64} h={18} r={9} tone={1} />
                  <Bar w={66} h={24} r={6} tone={1} />
                </div>
              ))}
            </div>
          </div>
        </Window>
      )}
    </Stage>
  )
}

// The status mark: spinner and dot share one 8px cell and crossfade, so the
// word beside it never moves
function Mark({ phase }: { phase: Phase }) {
  return (
    <span className="od-mark" data-done={phase > 0 || undefined}>
      <Spinner size={8} />
      <i className="od-dot" />
    </span>
  )
}

// The status word: every word is stacked in one cell whose width eases to
// the word showing, so the pill keeps its left edge and only its right edge
// moves; a word that would be cut has already faded
function Label({ phase }: { phase: Phase }) {
  const words = useRef<HTMLSpanElement[]>([])
  const [w, setW] = useState<number[]>([])
  useLayoutEffect(() => setW(words.current.map(e => e.offsetWidth)), [])
  return (
    <span className="od-label" style={w.length ? { width: w[phase] } : undefined}>
      {WORDS.map((t, i) => (
        <span key={t} ref={e => { if (e) words.current[i] = e }} className="od-word" data-on={i === phase || undefined}>{t}</span>
      ))}
    </span>
  )
}

function Side() {
  return (
    <nav className="od-side">
      {[58, 72, 50, 64, 44].map((w, i) => (
        <span key={i} className="od-nav" data-active={i === 0 || undefined}>
          <Bar w={12} h={12} r={3} tone={i === 0 ? 4 : 2} />
          <Bar w={w} h={6} tone={i === 0 ? 4 : 2} />
        </span>
      ))}
    </nav>
  )
}
