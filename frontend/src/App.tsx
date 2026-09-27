import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownToLine, ArrowRight, BarChart3, Camera, Check, ChevronDown, CircleHelp, Clock3, Gauge, LayoutDashboard, Menu, Pause, Play, RotateCcw, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, TrafficCone, TriangleAlert, Users, Volume2, Zap } from 'lucide-react'
import type { Config, Event, Frame, Page, Phase, PhasePlan, Report, Scenario } from './types'

const defaultPhasePlan: PhasePlan = { vehicle_green: 30, warning: 3, all_red_to_ped: 2, pedestrian_green: 12, all_red_to_vehicle: 2 }
const defaults: Config = { control_mode: 'adaptive', phase_plan: defaultPhasePlan, min_vehicle_green: 15, low_flow_threshold: 6, group_threshold: 5, max_single_wait: 45, max_group_wait: 30, pedestrian_green: 12 }
const fallbackScenarios: Scenario[] = [
  { id: 'video', name: 'Видео перехода', description: 'Запись CV-модуля и посекундные наблюдения из JSON', duration: 194, tone: 'video' },
  { id: 'normal', name: 'Normal traffic', description: 'Умеренный поток и одиночный запрос', duration: 90, tone: 'normal' },
  { id: 'rush', name: 'Rush hour', description: 'Плотный поток, ожидание до безопасного окна', duration: 110, tone: 'busy' },
  { id: 'group', name: 'Large pedestrian group', description: 'Группа из 7 человек получает приоритет', duration: 90, tone: 'group' },
  { id: 'empty', name: 'Empty road', description: 'Свободная дорога и быстрый отклик', duration: 70, tone: 'clear' },
  { id: 'failure', name: 'Camera failure', description: 'Потеря изображения и резервный цикл', duration: 90, tone: 'fault' },
]
const phaseName: Record<Phase, string> = { vehicle_green: 'Авто · зелёный', warning: 'Авто · предупреждение', all_red_to_ped: 'Все · красный', pedestrian_green: 'Пешеходы · зелёный', all_red_to_vehicle: 'Все · красный' }
const phaseShort: Record<Phase, string> = { vehicle_green: 'Авто', warning: 'Переход', all_red_to_ped: 'Стоп', pedestrian_green: 'Пешеходы', all_red_to_vehicle: 'Стоп' }
const modeLabel: Record<Frame['mode'], string> = { adaptive: 'Адаптивный', manual: 'Ручной план', fallback: 'Резервный цикл', fixed: 'Фиксированный цикл' }
const time = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

function Signal({ label, active, type }: { label: string; active: boolean; type: 'car' | 'ped' }) {
  return <div className="signal"><span className="signal-label">{label}</span><div className="signal-head"><i className={!active ? 'lit red' : ''}/><i className={active ? `lit ${type === 'car' ? 'green' : 'cyan'}` : ''}/></div><span className="signal-state">{active ? 'ПРОХОД / ПРОЕЗД' : 'ОЖИДАНИЕ'}</span></div>
}

function CrossingView({ frame, scenario, videoRef, onVideoTimeUpdate, onVideoEnded, onVideoPlay, onVideoPause }: { frame: Frame; scenario: Scenario; videoRef: React.RefObject<HTMLVideoElement>; onVideoTimeUpdate: (second: number) => void; onVideoEnded: () => void; onVideoPlay: () => void; onVideoPause: () => void }) {
  const carGreen = frame.phase === 'vehicle_green'
  const pedGreen = frame.phase === 'pedestrian_green'
  const people = frame.pedestrians ?? 0
  const isVideo = scenario.id === 'video'
  return <div className={`crossing-view ${!frame.healthy ? 'is-fault' : ''}`}>
    <div className="view-top"><span className="view-label"><Camera size={15}/> Камера 01 · Северный переход</span><span className={`live-pill ${frame.healthy ? '' : 'offline'}`}><span/>{!frame.healthy ? 'СИГНАЛ ПОТЕРЯН' : isVideo ? 'ЗАПИСЬ CV-МОДУЛЯ' : 'СИМУЛЯЦИЯ В ЭФИРЕ'}</span></div>
    <div className={`scene ${isVideo ? 'video-scene' : ''}`} role={isVideo ? undefined : 'img'} aria-label={isVideo ? undefined : `Схема перекрёстка для сценария ${scenario.name}. Автомобилей: ${frame.vehicles ?? "нет данных"}, пешеходов: ${frame.pedestrians ?? "нет данных"}.`}>
      {isVideo ? <video ref={videoRef} className="cv-video" src="/api/video" preload="metadata" playsInline aria-label="Запись работы CV-модуля на пешеходном переходе" onTimeUpdate={event => onVideoTimeUpdate(Math.floor(event.currentTarget.currentTime))} onEnded={onVideoEnded} onPlay={onVideoPlay} onPause={onVideoPause}/> : <>
      <div className="scene-grid"/>
      <div className="sidewalk sidewalk-left"/><div className="sidewalk sidewalk-right"/>
      <div className="road road-top"/><div className="road road-bottom"/>
      <div className="lane-dashes lane-top"/><div className="lane-dashes lane-bottom"/>
      <div className="crosswalk">{Array.from({ length: 8 }, (_, i) => <span key={i}/>)}</div>
      <div className="zone zone-wait"><span>ЗОНА ОЖИДАНИЯ</span></div>
      <div className="zone zone-approach"><span>КОНТРОЛЬ ПОТОКА</span></div>
      <div className="count-line"/>
      {frame.healthy && frame.vehicle_positions.map((position, i) => <div className="car" key={i} style={{ left: `${Math.min(87, 43 + position * 43)}%`, top: `${i % 2 ? 61 : 34}%` }}><span/></div>)}
      {frame.healthy && Array.from({ length: Math.min(people, 7) }, (_, i) => <div className="person" key={i} style={{ left: `${19 + (i % 4) * 4}%`, top: `${34 + Math.floor(i / 4) * 12}%` }}><span/></div>)}
      {!frame.healthy && <div className="fault-overlay"><TriangleAlert size={29}/><strong>Видеосигнал недоступен</strong><span>Решения по изображению приостановлены</span></div>}
      </>}
      <div className="scene-caption"><span>{isVideo ? 'Видео CV · демонстрационные наблюдения' : `Схема объекта · ${scenario.name}`}</span><span>t = {time(frame.time)}</span></div>
    </div>
    <div className="signal-strip"><Signal label="ТРАНСПОРТ" active={carGreen} type="car"/><div className="signal-divider"/><div className="center-phase"><span>ТЕКУЩАЯ ФАЗА</span><strong>{phaseName[frame.phase]}</strong><small>{modeLabel[frame.mode]}</small></div><div className="signal-divider"/><Signal label="ПЕШЕХОДЫ" active={pedGreen} type="ped"/></div>
  </div>
}

function Timeline({ frames, current, onChange, compact = false }: { frames: Frame[]; current: number; onChange: (t: number) => void; compact?: boolean }) {
  const segments = useMemo(() => frames.reduce<{ start: number; end: number; phase: Phase }[]>((all, f) => {
    const last = all[all.length - 1]
    if (last?.phase === f.phase) last.end = f.time + 1
    else all.push({ start: f.time, end: f.time + 1, phase: f.phase })
    return all
  }, []), [frames])
  const max = frames.length - 1
  const frame = frames[current]
  let phaseStart = current
  while (phaseStart > 0 && frames[phaseStart - 1].phase === frame.phase) phaseStart -= 1
  const phaseElapsed = current - phaseStart
  return <div className={`timeline ${compact ? 'compact' : ''}`}><div className="timeline-head"><div><h3>Временная шкала фаз</h3><p>Решения виртуального контроллера по секундам</p></div><span className="mono">{time(current)} / {time(max)}</span></div><div className="phase-track">{segments.map((s, i) => <button key={i} className={`segment phase-${s.phase}`} style={{ width: `${(s.end - s.start) / frames.length * 100}%` }} title={`${phaseName[s.phase]} с ${time(s.start)} по ${time(s.end - 1)}`} aria-label={`${phaseName[s.phase]}, с ${time(s.start)} по ${time(s.end - 1)}`} onClick={() => onChange(s.start)}><span>{s.end - s.start > 9 ? phaseShort[s.phase] : ''}</span></button>)}<div className="playhead" style={{ left: `${current / max * 100}%` }}/></div><input aria-label="Перемотка сценария" type="range" min="0" max={max} value={current} onChange={e => onChange(Number(e.target.value))}/><div className="time-axis"><span>00:00</span><span>{time(Math.round(max / 4))}</span><span>{time(Math.round(max / 2))}</span><span>{time(Math.round(max * 3 / 4))}</span><span>{time(max)}</span></div><div className="legend"><span><i className="legend-car"/>Автомобили</span><span><i className="legend-warn"/>Предупреждение</span><span><i className="legend-stop"/>Защитный интервал</span><span><i className="legend-ped"/>Пешеходы</span></div><div className="timeline-reason"><Clock3 size={16}/><div><small>Решение на {time(current)}</small><strong>{frame.reason}</strong></div><time>{phaseElapsed} с в фазе</time></div></div>
}

function FlowChart({ frames, current }: { frames: Frame[]; current: number }) {
  const values = frames.map(f => f.flow_per_min ?? 0)
  const max = Math.max(12, ...values)
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${72 - v / max * 62}`).join(' ')
  return <div className="flow-chart"><div className="chart-head"><div><h3>Интенсивность транспорта</h3><p>Авто/мин · предыдущее окно 30 с</p></div><span className="chart-value">{frames[current].flow_per_min ?? '—'} <small>авто/мин</small></span></div><svg viewBox="0 0 100 80" preserveAspectRatio="none" role="img" aria-label={`Интенсивность транспорта за ${time(frames.length - 1)}. В выбранный момент: ${frames[current].flow_per_min ?? 'нет данных'} автомобилей в минуту`}><line x1="0" y1="72" x2="100" y2="72" className="axis"/><line x1="0" y1="41" x2="100" y2="41" className="gridline"/><line x1="0" y1="10" x2="100" y2="10" className="gridline"/><polyline points={points} fill="none" className="flow-line"/><line x1={current / (frames.length - 1) * 100} y1="0" x2={current / (frames.length - 1) * 100} y2="76" className="chart-cursor"/></svg><div className="chart-axis"><span>00:00</span><span>{time(frames.length - 1)}</span></div></div>
}

function Metric({ icon: Icon, label, value, unit, foot }: { icon: typeof Activity; label: string; value: string | number; unit?: string; foot?: string }) {
  return <div className="metric"><div className="metric-icon"><Icon size={18}/></div><div className="metric-label">{label}</div><div className="metric-number">{value}<small>{unit}</small></div>{foot && <div className="metric-foot">{foot}</div>}</div>
}

function TrafficStats({ summary }: { summary: Report['summary'] }) {
  const requests = summary.served_requests + summary.unserved_requests
  return <section className="traffic-stats" aria-label="Статистика потока и запросов">
    <div className="traffic-stats-heading"><div><h2>Поток и загрузка перехода</h2><p>Показатели рассчитаны по секундам с доступным изображением. Плотность — число автомобилей одновременно в зоне подъезда.</p></div></div>
    <div className="analytics-metrics traffic-stats-grid">
      <Metric icon={Gauge} label="Средняя интенсивность" value={summary.mean_flow_per_min ?? '—'} unit="авто/мин" foot="Окно потока 30 секунд"/>
      <Metric icon={Activity} label="Пик интенсивности" value={summary.peak_flow_per_min ?? '—'} unit="авто/мин" foot="Максимум за эпизод"/>
      <Metric icon={TrafficCone} label="Средняя плотность" value={summary.mean_vehicles_in_zone ?? '—'} unit="авто" foot="В зоне подъезда одновременно"/>
      <Metric icon={TrafficCone} label="Пик плотности" value={summary.peak_vehicles_in_zone ?? '—'} unit="авто" foot="Одновременно в зоне"/>
      <Metric icon={Clock3} label="Максимальное ожидание" value={summary.max_wait ?? '—'} unit="с" foot="До пешеходного зелёного"/>
      <Metric icon={Users} label="Обслужено запросов" value={`${summary.served_requests}/${requests}`} foot="Запросы за эпизод"/>
    </div>
  </section>
}

function EventList({ events, current, onChange, limit = 5 }: { events: Event[]; current: number; onChange: (t: number) => void; limit?: number }) {
  const past = [...events].filter(e => e.time <= current).reverse().slice(0, limit)
  const upcoming = past.length ? [] : events.filter(e => e.time > current).slice(0, limit)
  const shown = past.length ? past : upcoming
  return <div className="event-list">{shown.length ? shown.map((event, i) => <button className={`event-row ${past.length ? '' : 'upcoming'}`} key={`${event.time}-${i}`} onClick={() => onChange(event.time)}><span className={`event-dot ${event.type}`}/><span className="event-copy">{event.text}</span><time>{time(event.time)}</time></button>) : <p className="empty-events">В этом сценарии пока нет событий</p>}</div>
}

function AnalyticsOverview({ report, current, onChange, onSettings }: { report: Report; current: number; onChange: (t: number) => void; onSettings: () => void }) {
  const summary = report.summary
  const difference = report.modeled_wait_difference
  const baselineWait = report.baseline.mean_wait
  const waitChangePercent = difference !== null && baselineWait ? Math.round(difference / baselineWait * 100) : null
  const ringFill = waitChangePercent === null ? 0 : Math.max(0, Math.min(100, waitChangePercent))
  const activeCycleName = report.config.control_mode === 'manual' ? 'Ручной план' : 'Адаптивный цикл'
  const comparisonText = difference === null ? 'Сравнение недоступно: часть запросов не обслужена в пределах эпизода' : difference > 0 ? `Ожидание короче на ${difference} с по сравнению с фиксированным циклом` : difference < 0 ? `Ожидание дольше на ${Math.abs(difference)} с по сравнению с фиксированным циклом` : 'Ожидание одинаковое в обоих режимах'
  return <>
    <div className="section-note"><BarChart3 size={18}/><span>{report.disclaimer}</span></div>
    <section className="analytics-lead" aria-label="Главные показатели эпизода">
      <div className="wait-lead"><div><span className="section-kicker">СРЕДНЕЕ ОЖИДАНИЕ</span><h2>{difference === null ? 'Недостаточно данных для сравнения' : difference > 0 ? 'Пешеходы ждут меньше' : difference < 0 ? 'Пешеходы ждут дольше' : 'Ожидание совпадает'}</h2><p>Время от запроса до начала зелёной фазы</p></div><div className="wait-number"><strong>{summary.mean_wait ?? '—'}</strong><span>секунд</span></div><div className="wait-compare"><div className="wait-meter" aria-hidden="true"><span style={{ width: `${baselineWait ? Math.max(4, Math.min(100, (summary.mean_wait ?? 0) / baselineWait * 100)) : 0}%` }}/></div><div><span>{activeCycleName}</span><strong>{summary.mean_wait ?? '—'} с</strong></div><div><span>Фиксированный цикл</span><strong>{baselineWait ?? '—'} с</strong></div></div><div className="wait-delta"><Sparkles size={19}/><span>{comparisonText}</span></div></div>
      <div className="analytics-side-stats"><div className="side-stat traffic-stat"><span className="side-stat-icon"><TrafficCone size={18}/></span><div><strong>{summary.vehicles}</strong><span>авто за эпизод</span></div><small>{report.scenario_id === 'video' ? 'по данным JSON' : 'смоделированные появления'}</small></div><div className="side-stat"><span className="side-stat-icon"><Users size={18}/></span><div><strong>{summary.pedestrians}</strong><span>пешеходов</span></div><small>пик группы: {summary.peak_pedestrians} человек</small></div><div className="side-stat"><span className="side-stat-icon"><ShieldCheck size={18}/></span><div><strong>{summary.safety_violations}</strong><span>нарушений фаз</span></div><small>защитные интервалы сохранены</small></div></div>
      <div className="lead-performance"><div className="performance-ring" style={{ '--ring-fill': `${ringFill * 3.6}deg` } as React.CSSProperties}><span>{waitChangePercent === null ? '—' : `${waitChangePercent > 0 ? '+' : ''}${waitChangePercent}`}<small>{waitChangePercent === null ? '' : '%'}</small></span></div><div><strong>изменение ожидания</strong><p>относительно фиксированного цикла</p></div></div>
    </section>
    <TrafficStats summary={summary}/>
    <div className="analytics-grid"><div className="panel"><FlowChart frames={report.frames} current={current}/></div><div className="panel compare-panel"><span className="section-kicker">ПОЛИТИКИ УПРАВЛЕНИЯ</span><h3>Один поток, два режима</h3><p>Показатели для текущего эпизода</p><div className="compare-row"><span>{activeCycleName}</span><div className="compare-bar"><i style={{ width: `${Math.min(100, (summary.mean_wait ?? 0) / Math.max(report.baseline.mean_wait ?? 1, 1) * 100)}%` }}/></div><strong>{summary.mean_wait ?? '—'} с</strong></div><div className="compare-row fixed"><span>Фиксированный</span><div className="compare-bar"><i style={{ width: '100%' }}/></div><strong>{report.baseline.mean_wait ?? '—'} с</strong></div><div className="compare-result"><Sparkles size={19}/><span>{comparisonText}</span></div></div></div>
    <div className="analytics-grid second"><div className="panel"><Timeline frames={report.frames} current={current} onChange={onChange} compact/></div><div className="panel recommendation"><span className="section-kicker"><Sparkles size={16}/> РЕКОМЕНДАЦИЯ</span><h3>Что показывает этот эпизод</h3><p>{report.recommendation}</p><button className="text-link" onClick={onSettings}>Настроить параметры <ArrowRight size={17}/></button></div></div>
  </>
}

const configMeta: { key: keyof Omit<Config, 'control_mode' | 'phase_plan'>; label: string; help: string; min: number; max: number; unit: string }[] = [
  { key: 'min_vehicle_green', label: 'Минимальная автомобильная фаза', help: 'Время до первого возможного переключения', min: 5, max: 40, unit: 'с' },
  { key: 'low_flow_threshold', label: 'Порог низкой интенсивности', help: 'Автомобилей в минуту за предыдущее окно', min: 0, max: 30, unit: 'авто/мин' },
  { key: 'group_threshold', label: 'Порог большой группы', help: 'Приоритет включается от этого числа людей', min: 2, max: 10, unit: 'чел.' },
  { key: 'max_single_wait', label: 'Ожидание одного пешехода', help: 'Целевой предел до начала зелёного', min: 20, max: 90, unit: 'с' },
  { key: 'max_group_wait', label: 'Ожидание группы', help: 'Целевой предел для группы', min: 15, max: 60, unit: 'с' },
  { key: 'pedestrian_green', label: 'Пешеходная фаза', help: 'Продолжительность зелёного сигнала', min: 8, max: 30, unit: 'с' },
]

const phaseMeta: { key: Phase; label: string; min: number; max: number; help: string }[] = [
  { key: 'vehicle_green', label: 'Автомобили · зелёный', min: 5, max: 90, help: 'Проезд открыт' },
  { key: 'warning', label: 'Предупреждение', min: 3, max: 10, help: 'Не менее 3 с' },
  { key: 'all_red_to_ped', label: 'Все · красный', min: 2, max: 10, help: 'Перед пешеходами, не менее 2 с' },
  { key: 'pedestrian_green', label: 'Пешеходы · зелёный', min: 8, max: 60, help: 'Не менее 8 с' },
  { key: 'all_red_to_vehicle', label: 'Все · красный', min: 2, max: 10, help: 'Перед автомобилями, не менее 2 с' },
]

function PhaseBuilder({ draft, onChange }: { draft: Config; onChange: (next: Config) => void }) {
  const manual = draft.control_mode === 'manual'
  const total = phaseMeta.reduce((sum, item) => sum + draft.phase_plan[item.key], 0)
  return <section className="panel phase-builder" aria-label="Конструктор фаз">
    <div className="phase-builder-head"><div><span className="section-kicker"><SlidersHorizontal size={16}/> КОНСТРУКТОР ФАЗ</span><h2>План светофора</h2><p>Выберите режим и настройте длительность каждой фазы. Порядок остаётся безопасным.</p></div><strong>{total} с <small>ручной цикл</small></strong></div>
    <div className="mode-toggle" role="group" aria-label="Режим управления">
      <button type="button" className={!manual ? 'selected' : ''} aria-pressed={!manual} onClick={() => onChange({ ...draft, control_mode: 'adaptive' })}>Адаптивный</button>
      <button type="button" className={manual ? 'selected' : ''} aria-pressed={manual} onClick={() => onChange({ ...draft, control_mode: 'manual' })}>Ручной план</button>
    </div>
    <div className="phase-preview" aria-label={`План фаз, полный цикл ${total} секунд`}>
      {phaseMeta.map(item => <span key={item.key} className={`phase-${item.key}`} style={{ flexGrow: draft.phase_plan[item.key] }} title={`${item.label}: ${draft.phase_plan[item.key]} с`}/>)}
    </div>
    <div className="phase-controls">
      {phaseMeta.map((item, index) => <label className={`phase-control ${manual ? '' : 'inactive'}`} key={item.key}>
        <span className="phase-control-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="phase-control-body"><strong>{item.label}</strong><small>{item.help}</small><input type="range" min={item.min} max={item.max} value={draft.phase_plan[item.key]} disabled={!manual} onChange={event => onChange({ ...draft, phase_plan: { ...draft.phase_plan, [item.key]: Number(event.target.value) } })} aria-label={`Длительность: ${item.label}`}/></span>
        <span className="phase-control-value">{draft.phase_plan[item.key]} <small>с</small></span>
      </label>)}
    </div>
    <p className="phase-builder-note">В ручном режиме длительности применяются к каждому циклу. При потере изображения включается резервный цикл.</p>
  </section>
}

function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [scenarios, setScenarios] = useState<Scenario[]>(fallbackScenarios)
  const [scenarioId, setScenarioId] = useState('video')
  const [config, setConfig] = useState<Config>(() => { try { const saved = JSON.parse(localStorage.getItem('sc-config') || '{}'); return { ...defaults, ...saved, phase_plan: { ...defaultPhasePlan, ...saved.phase_plan } } } catch { return defaults } })
  const [draft, setDraft] = useState<Config>(config)
  const [report, setReport] = useState<Report | null>(null)
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const mainContent = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const wasMobileNavOpen = useRef(false)

  useEffect(() => { fetch('/api/scenarios').then(r => r.ok ? r.json() : Promise.reject()).then(setScenarios).catch(() => {}) }, [])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setPlaying(false); setCurrent(0)
    fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario_id: scenarioId, config }) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Mock API недоступен. Запустите FastAPI на порту 8001.')))
      .then(data => { if (!cancelled) { setReport(data); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [scenarioId, config])
  useEffect(() => { if (!playing || !report || scenarioId === 'video') return; const id = window.setInterval(() => setCurrent(t => { if (t >= report.frames.length - 1) { setPlaying(false); return t } return t + 1 }), 1000 / speed); return () => clearInterval(id) }, [playing, speed, report, scenarioId])
  useEffect(() => {
    if (scenarioId !== 'video' || page !== 'dashboard' || !report || !videoRef.current) return
    const video = videoRef.current
    video.playbackRate = speed
    if (Math.abs(video.currentTime - current) > 1) video.currentTime = current
    if (playing) void video.play().catch(() => setPlaying(false))
    else video.pause()
  }, [page, playing, report, scenarioId, speed])
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(''), 3200); return () => clearTimeout(id) }, [toast])
  useEffect(() => {
    if (!mobileNav) {
      mainContent.current?.removeAttribute('inert')
      if (wasMobileNavOpen.current) menuTrigger.current?.focus()
      wasMobileNavOpen.current = false
      return
    }
    mainContent.current?.setAttribute('inert', '')
    wasMobileNavOpen.current = true
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar .nav-item'))
    items[0]?.focus()
    const handleDrawerKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileNav(false); return }
      if (event.key !== 'Tab' || items.length === 0) return
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', handleDrawerKeys)
    return () => window.removeEventListener('keydown', handleDrawerKeys)
  }, [mobileNav])

  const frame = report?.frames[current]
  const scenario = scenarios.find(s => s.id === scenarioId) || fallbackScenarios[0]
  const seekToSecond = (second: number) => { setCurrent(second); if (scenarioId === 'video' && videoRef.current) videoRef.current.currentTime = second }
  const togglePlayback = () => { if (report && current >= report.frames.length - 1 && !playing) seekToSecond(0); setPlaying(!playing) }
  const changeScenario = (id: string) => { setScenarioId(id); setPage('dashboard'); setMobileNav(false) }
  const replay = () => { setConfig({ ...draft }); localStorage.setItem('sc-config', JSON.stringify(draft)); setPage('dashboard'); setToast('Параметры сохранены. Сценарий пересчитан.') }
  const resetSettings = () => { setDraft(defaults); setConfig(defaults); localStorage.removeItem('sc-config'); setToast('Настройки восстановлены') }
  const downloadCSV = () => { if (!report) return; const rows = ['second,phase,mode,camera_healthy,vehicles,pedestrians,flow_per_min,reason', ...report.frames.map(f => `${f.time},${f.phase},${f.mode},${f.healthy},${f.vehicles ?? ''},${f.pedestrians ?? ''},${f.flow_per_min ?? ''},"${f.reason.replace(/"/g, '""')}"`)]; const blob = new Blob(['\uFEFF', rows.join('\n')], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `smart-crossing-${scenarioId}.csv`; link.click(); URL.revokeObjectURL(link.href); setToast('Отчёт CSV загружен') }
  const nav: { id: Page; label: string; icon: typeof Activity }[] = [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { id: 'analytics', label: 'Analytics', icon: BarChart3 }, { id: 'logic', label: 'Decision Logic', icon: Activity }, { id: 'settings', label: 'Settings', icon: Settings2 }, { id: 'demo', label: 'Demo / Simulation', icon: Play }]

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Перейти к содержимому</a>
    <aside id="navigation-drawer" className={`sidebar ${mobileNav ? 'open' : ''}`}><div className="brand"><div className="brand-mark"><span/><span/><span/></div><div><strong>smart<span>crossing</span></strong><small>INTELLIGENT TRAFFIC SYSTEM</small></div></div><div className="side-section-label">УПРАВЛЕНИЕ</div><nav aria-label="Основная навигация">{nav.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setMobileNav(false) }}><item.icon size={19}/><span>{item.label}</span>{item.id === 'demo' && <i/>}</button>)}</nav><div className="sidebar-bottom"><div className="system-card"><span className="system-pulse"/><div><strong>Система активна</strong><small>{scenarioId === 'video' ? 'Видео + CV JSON' : 'Виртуальный контроллер · mock'}</small></div></div><div className="side-foot">SMART CITY LAB <span>v1.0 demo</span></div></div></aside>
    {mobileNav && <button className="mobile-backdrop" tabIndex={-1} aria-label="Закрыть меню" onClick={() => setMobileNav(false)}/>}
    <main ref={mainContent} className="main" id="main-content"><header className="topbar"><button ref={menuTrigger} className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Открыть меню" aria-controls="navigation-drawer" aria-expanded={mobileNav}><Menu size={21}/></button><div className="breadcrumb">Smart Crossing <span>/</span> <strong>{nav.find(x => x.id === page)?.label}</strong></div><div className="top-actions"><span className="demo-badge"><span/> DEMO MODE</span><span className="top-separator"/><span className="operator-avatar">SC</span><div className="operator-name"><strong>Оператор</strong><small>Локальный доступ</small></div></div></header>
      <div className="content">
        <div className="page-intro"><div><span className="eyebrow">ПЕШЕХОДНЫЙ ПЕРЕХОД № 01 <span>/</span> МОСКВА, ДЕМО-ОБЪЕКТ</span><h1>{page === 'dashboard' ? 'Пульт управления переходом' : page === 'analytics' ? 'Аналитика движения' : page === 'logic' ? 'Логика принятия решений' : page === 'settings' ? 'Настройки контроллера' : 'Режим демонстрации'}</h1><p>{page === 'dashboard' ? 'Наблюдайте за фазами и дорожной ситуацией.' : page === 'analytics' ? 'Поток, ожидание и эффективность по выбранному эпизоду.' : page === 'logic' ? 'Каждое переключение подкреплено наблюдением и защитным интервалом.' : page === 'settings' ? 'Выберите режим, настройте фазы и пересчитайте тот же эпизод.' : 'Выберите дорожную ситуацию и покажите работу алгоритма жюри.'}</p></div><div className="intro-actions">{page !== 'settings' && <div className="scenario-select"><span>СЦЕНАРИЙ</span><select value={scenarioId} onChange={e => changeScenario(e.target.value)} aria-label="Выбрать сценарий">{scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><ChevronDown size={16}/></div>}{page === 'analytics' && <button className="button secondary" onClick={downloadCSV}><ArrowDownToLine size={17}/> Экспорт CSV</button>}</div></div>
        {loading && <div className="loading-state" role="status" aria-live="polite"><div className="spinner"/>Загрузка демонстрационного сценария…</div>}
        {error && <div className="error-state" role="alert"><TriangleAlert size={22}/><div><strong>Не удалось загрузить данные</strong><p>{error}</p></div><button className="button" onClick={() => setConfig({ ...config })}>Повторить</button></div>}
        {report && frame && !loading && !error && <>
          {page === 'dashboard' && <><div className="status-ribbon"><div className={`ribbon-status ${frame.healthy ? '' : 'fault'}`}><span className="ribbon-icon">{frame.healthy ? <ShieldCheck size={18}/> : <TriangleAlert size={18}/>}</span><div><strong>{frame.healthy ? 'Дорожная ситуация под контролем' : 'Потеря изображения камеры'}</strong><small>{frame.healthy ? `Камера исправна · ${modeLabel[frame.mode]}` : 'Активирован безопасный резервный цикл'}</small></div></div><span className="ribbon-time"><Clock3 size={16}/> {time(current)} сценария</span></div><div className="dashboard-grid"><div className="workspace"><CrossingView frame={frame} scenario={scenario} videoRef={videoRef} onVideoTimeUpdate={second => setCurrent(Math.min(second, report.frames.length - 1))} onVideoEnded={() => { setPlaying(false); setCurrent(report.frames.length - 1) }} onVideoPlay={() => setPlaying(true)} onVideoPause={() => setPlaying(false)}/><div className="playback-bar"><button className="round-play" onClick={togglePlayback} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>{playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button><span className="mono playback-time">{time(current)}</span><input aria-label="Перемотка воспроизведения" type="range" min="0" max={report.frames.length - 1} value={current} onChange={e => seekToSecond(Number(e.target.value))}/><span className="mono duration">{time(scenarioId === 'video' ? report.frames.length : report.frames.length - 1)}</span><button className="speed" onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)} aria-label={`Скорость воспроизведения: ${speed}×`}>{speed}×</button></div></div><div className="insight-column"><div className="decision-card"><div className="card-top"><span className="section-kicker"><Zap size={16}/> РЕШЕНИЕ СИСТЕМЫ</span><span className="decision-time">{time(current)}</span></div><div className={`decision-symbol phase-bg-${frame.phase}`}>{frame.phase === 'pedestrian_green' ? <Users size={27}/> : frame.phase === 'vehicle_green' ? <TrafficCone size={27}/> : <Clock3 size={27}/>}</div><h2>{phaseName[frame.phase]}</h2><p>{frame.reason}</p><div className="decision-divider"/><div className="decision-details"><span>РЕЖИМ</span><strong>{modeLabel[frame.mode]}</strong></div><div className="decision-details"><span>КАМЕРА</span><strong className={frame.healthy ? 'healthy' : 'unhealthy'}>{frame.healthy ? 'Сигнал стабильный' : 'Нет изображения'}</strong></div></div><div className="live-metrics"><div><span><TrafficCone size={16}/> В зоне</span><strong>{frame.vehicles ?? '—'} <small>авто</small></strong></div><div><span><Users size={16}/> Ожидают</span><strong>{frame.pedestrians ?? '—'} <small>чел.</small></strong></div>{scenarioId === 'video' && <div><span><Users size={16}/> На дороге</span><strong>{frame.on_road ?? '—'} <small>чел.</small></strong></div>}<div><span><Gauge size={16}/> Поток</span><strong>{frame.flow_per_min ?? '—'} <small>авто/мин</small></strong></div></div><div className="mini-callout"><Sparkles size={18}/><p>{report.recommendation}</p></div></div></div><div className="lower-grid"><Timeline frames={report.frames} current={current} onChange={seekToSecond}/><div className="event-panel"><div className="panel-heading"><div><h3>События сценария</h3><p>Отметки появляются по мере воспроизведения</p></div><button onClick={() => setPage('logic')}>Все события <ArrowRight size={15}/></button></div><EventList events={report.events} current={current} onChange={seekToSecond}/></div></div><div className="bottom-grid"><FlowChart frames={report.frames} current={current}/><div className="summary-panel"><div className="panel-heading"><div><h3>Итог эпизода</h3><p>Данные выбранного сценария</p></div><button onClick={() => setPage('analytics')}>Подробнее <ArrowRight size={15}/></button></div><div className="summary-stats"><Metric icon={TrafficCone} label="Транспорт" value={report.summary.vehicles} unit="авто"/><Metric icon={Users} label="Пешеходы" value={report.summary.pedestrians} unit="чел."/><Metric icon={Clock3} label="Ср. ожидание" value={report.summary.mean_wait ?? '—'} unit="с"/></div></div></div></>}
          {page === 'analytics' && <AnalyticsOverview report={report} current={current} onChange={seekToSecond} onSettings={() => setPage('settings')}/> }
          {page === 'logic' && <><div className="logic-overview"><div className="logic-intro"><span className="section-kicker"><Activity size={16}/> КАК ЭТО РАБОТАЕТ</span><h2>Наблюдение → запрос → безопасная фаза</h2><p>Контроллер использует только текущие и предыдущие наблюдения. Перед пешеходным зелёным всегда идут предупреждение и общий красный.</p></div><div className="logic-facts"><div><strong>30 с</strong><span>окно оценки потока</span></div><div><strong>5 с</strong><span>подтверждение пустой дороги</span></div><div><strong>0</strong><span>конфликтующих зелёных</span></div></div></div><div className="logic-steps"><div><span>01</span><Camera size={24}/><h3>Наблюдение</h3><p>{scenarioId === 'video' ? 'Посекундные данные CV о машинах, пешеходах и состоянии камеры.' : 'Mock-данные о машинах, ожидающих людях и состоянии камеры.'}</p></div><div><span>02</span><SlidersHorizontal size={24}/><h3>Оценка условий</h3><p>Поток за предыдущие 30 секунд, группа и время ожидания.</p></div><div><span>03</span><ShieldCheck size={24}/><h3>Защитный переход</h3><p>3 секунды предупреждения, 2 секунды общего красного.</p></div><div><span>04</span><Users size={24}/><h3>Пешеходная фаза</h3><p>Зелёный сигнал с заданной минимальной продолжительностью.</p></div></div><div className="logic-grid"><div className="panel"><div className="panel-heading"><div><h3>Лента решений</h3><p>Нажмите на событие, чтобы перейти к моменту</p></div><span className="mono">{report.events.length} событий</span></div><div className="logic-events">{report.events.map((event, i) => <button key={i} className={`logic-event ${current === event.time ? 'selected' : ''}`} onClick={() => seekToSecond(event.time)}><time>{time(event.time)}</time><span className={`event-dot ${event.type}`}/><span>{event.text}</span><ArrowRight size={15}/></button>)}</div></div><div className="logic-side"><div className="panel selected-moment"><span className="section-kicker">ВЫБРАННЫЙ МОМЕНТ · {time(current)}</span><h3>{phaseName[frame.phase]}</h3><p>{frame.reason}</p><div><span>Поток</span><strong>{frame.flow_per_min ?? 'нет данных'} {frame.flow_per_min !== null && 'авто/мин'}</strong></div><div><span>Ожидают</span><strong>{frame.pedestrians ?? 'нет данных'} {frame.pedestrians !== null && 'чел.'}</strong></div><div><span>Камера</span><strong>{frame.healthy ? 'Исправна' : 'Нет изображения'}</strong></div><div><span>Режим</span><strong>{modeLabel[frame.mode]}</strong></div></div><div className="fault-note"><TriangleAlert size={20}/><div><strong>При потере изображения</strong><p>Отсутствие детекций не считается пустой дорогой. Контроллер переходит на резервный цикл.</p></div></div></div></div></>}
          {page === 'settings' && <><div className="settings-layout"><div className="settings-main"><PhaseBuilder draft={draft} onChange={setDraft}/><div className={`panel settings-panel ${draft.control_mode === 'manual' ? 'inactive' : ''}`}><div className="settings-heading"><div><span className="section-kicker"><SlidersHorizontal size={16}/> ПАРАМЕТРЫ УПРАВЛЕНИЯ</span><h2>Адаптивные параметры</h2><p>Применяются только в адаптивном режиме после повторного расчёта.</p></div><span className="settings-count">6 параметров</span></div><div className="settings-list">{configMeta.map(item => <div className="setting-row" key={item.key}><div><strong>{item.label}</strong><p>{item.help}</p></div><div className="setting-control"><input type="range" min={item.min} max={item.max} value={draft[item.key]} disabled={draft.control_mode === 'manual'} onChange={e => setDraft({ ...draft, [item.key]: Number(e.target.value) })} aria-label={item.label}/><span>{draft[item.key]} <small>{item.unit}</small></span></div></div>)}</div><div className="settings-actions"><button className="button primary" onClick={replay}><RotateCcw size={17}/> Сохранить и пересчитать</button><button className="button ghost" onClick={resetSettings}>Сбросить настройки</button></div></div></div><div className="settings-aside"><div className="settings-info"><CircleHelp size={23}/><h3>Что изменится?</h3><p>Система повторно выполнит тот же сценарий с выбранным режимом и длительностями фаз. Входные наблюдения сохранятся.</p></div><div className="safety-panel"><ShieldCheck size={22}/><h3>Защитные интервалы</h3><p>Ручной план позволяет увеличивать защитные интервалы, но не сокращать их ниже 3 с предупреждения и 2 с общего красного.</p><div><span>Минимум пешеходного зелёного</span><strong>8 с</strong></div><div><span>Резервный автоцикл</span><strong>30 с</strong></div></div></div></div></>}
          {page === 'demo' && <><div className="demo-banner"><div><span className="section-kicker"><Sparkles size={16}/> ПРЕЗЕНТАЦИОННЫЙ РЕЖИМ</span><h2>Видео и пять ситуаций. Один алгоритм.</h2><p>Выберите сценарий и покажите, как контроллер реагирует на поток, группу или отказ камеры.</p></div><button className="button light" onClick={() => { setPage('dashboard'); setCurrent(0); setPlaying(true) }}><Play size={17} fill="currentColor"/> Запустить показ</button></div><div className="scenario-grid">{scenarios.map((s, i) => <button className={`scenario-card tone-${s.tone} ${scenarioId === s.id ? 'selected' : ''}`} key={s.id} aria-pressed={scenarioId === s.id} onClick={() => { setScenarioId(s.id); setCurrent(0); setPlaying(false) }}><span className="scenario-index">0{i + 1} / 0{scenarios.length}</span><span className="scenario-symbol">{s.id === 'video' ? <Camera size={27}/> : s.id === 'failure' ? <TriangleAlert size={27}/> : s.id === 'group' ? <Users size={27}/> : s.id === 'empty' ? <Zap size={27}/> : <TrafficCone size={27}/>}</span><strong>{s.name}</strong><p>{s.description}</p><span className="scenario-bottom"><span>{time(s.duration)} · {s.id === 'video' ? 'CV JSON' : 'mock-данные'}</span>{scenarioId === s.id ? <Check size={18}/> : <ArrowRight size={18}/>}</span></button>)}</div><div className="demo-bottom"><div><span className="section-kicker">ТЕКУЩИЙ СЦЕНАРИЙ</span><h3>{scenario.name}</h3><p>{scenario.description}</p></div><div className="demo-stat"><span>ТРАНСПОРТ</span><strong>{report.summary.vehicles}</strong></div><div className="demo-stat"><span>ПЕШЕХОДЫ</span><strong>{report.summary.pedestrians}</strong></div><div className="demo-stat"><span>РАБОТА КАМЕРЫ</span><strong>{report.summary.camera_uptime}%</strong></div><button className="button primary" onClick={() => { setPage('dashboard'); setCurrent(0); setPlaying(true) }}>Смотреть сценарий <ArrowRight size={17}/></button></div><div className="demo-disclaimer"><Volume2 size={16}/> Во время показа перемотайте видео или шкалу фаз и откройте Decision Logic для объяснения решения.</div></>}
          <footer className="footer"><span>Smart Crossing · {scenarioId === 'video' ? 'видео и демонстрационный CV JSON' : 'демонстрационный интерфейс на mock-данных'}</span><span>Фазы виртуального контроллера не управляют дорожным оборудованием</span></footer>
        </>}
      </div>
    </main>{toast && <div className="toast" role="status"><Check size={17}/>{toast}</div>}
  </div>
}

export default App
