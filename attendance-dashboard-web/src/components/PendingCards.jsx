import { useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'
import { watchRecords } from '../data'
import { dateKey, formatTime } from '../utils/attendanceTime'

export default function PendingCards({ onLink }) {
  const [events,setEvents] = useState([]), [error,setError] = useState(''), [retry,setRetry] = useState(0)
  useEffect(()=>watchRecords('pending_card_events',{isNull:['linked_officer_key'],orderBy:'timestamp'},rows=>{setEvents(rows);setError('')},e=>setError(e.message)),[retry])
  const cards = new Map()
  for (const event of events) {
    if (!cards.has(event.card_uid)) cards.set(event.card_uid,{uid:event.card_uid,events:0,latest:event.timestamp})
    cards.get(event.card_uid).events++
  }
  if (error) return <div role="alert" className="card p-4 text-sm text-amber-300">Pending card scans are unavailable: {error}. If the updated migration has not run, apply it first.<button className="btn-secondary ml-2" onClick={()=>setRetry(value=>value+1)}>Retry</button></div>
  if (!cards.size) return null
  return <section className="card p-5 space-y-4 animate-fade-in" aria-labelledby="pending-cards-title">
    <div><h2 id="pending-cards-title" className="font-semibold text-white">Unlinked card scans</h2><p className="text-xs text-slate-400 mt-1">{cards.size} unlinked cards. Pending scans are excluded from officer analytics until you identify the card owner.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[...cards.values()].slice(0,30).map(card=><div key={card.uid} className="rounded-xl border border-white/10 bg-white/5 p-3 flex items-center justify-between gap-3">
      <div><p className="font-mono text-sm text-slate-200">{card.uid}</p><p className="text-xs text-slate-500 mt-1">{card.events} events · {dateKey(card.latest)} {formatTime(card.latest)}</p></div><button className="btn-secondary" onClick={()=>onLink(card.uid)}><Link2 className="w-4 h-4" />Link card</button>
    </div>)}</div>{cards.size>30 && <p className="text-xs text-slate-500">Showing the 30 most recently used cards. You can also scan a card while adding or linking an officer.</p>}
  </section>
}
