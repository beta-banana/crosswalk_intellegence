import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CalendarDays, Moon, Pause, Play, RotateCcw, SlidersHorizontal, Sun, Sunrise, Sunset, TrafficCone, Users } from 'lucide-react'
import type { Config, Phase, Report, Scenario, TrafficProfile } from './types'
import ThreeRoadScene from './ThreeRoadScene'
import { buildSignalPlan } from './roadTraffic'
import './simulator.css'

const phases: { key: Phase; label: string; hint: string; min: number; max: number }[] = [
  { key: 'vehicle_green', label: 'Зелёный для машин', hint: 'Проезд открыт', min: 5, max: 90 },
  { key: 'warning', label: 'Предупреждение', hint: 'Перед остановкой', min: 3, max: 10 },
  { key: 'all_red_to_ped', label: 'Общий красный', hint: 'Перед переходом', min: 2, max: 10 },
  { key: 'pedestrian_green', label: 'Зелёный для пешеходов', hint: 'Переход открыт', min: 8, max: 60 },
  { key: 'all_red_to_vehicle', label: 'Подготовка проезда', hint: 'Красный + жёлтый перед зелёным', min: 2, max: 10 },
]
const phaseLabels: Record<Phase, string> = {
  vehicle_green: 'Машины едут', warning: 'Предупреждение', all_red_to_ped: 'Все ждут', pedestrian_green: 'Пешеходы переходят', all_red_to_vehicle: 'Все ждут',
}
const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
const SIMULATOR_STORAGE_KEY = 'sc-simulator-v2'
const defaultProfile: TrafficProfile = { vehicle_rate: 45, pedestrian_rate: 30, time_of_day: 'day', day_type: 'weekday' }
const timeOptions = [
  { id: 'morning', label: 'Утро', icon: Sunrise }, { id: 'day', label: 'День', icon: Sun },
  { id: 'evening', label: 'Вечер', icon: Sunset }, { id: 'night', label: 'Ночь', icon: Moon },
] as const
const dayOptions = [
  { id: 'weekday', label: 'Будний' }, { id: 'weekend', label: 'Выходной' }, { id: 'holiday', label: 'Праздник' },
] as const
const fallbackScenarios: Scenario[] = [
  { id: 'custom', name: 'Свой поток', description: 'Настройте интенсивность и время', duration: 120, tone: 'custom', kind: 'simulation' },
  { id: 'normal', name: 'Обычное движение', description: 'Умеренный поток', duration: 90, tone: 'normal', kind: 'simulation' },
  { id: 'rush', name: 'Час пик', description: 'Плотный поток', duration: 110, tone: 'busy', kind: 'simulation' },
  { id: 'group', name: 'Группа пешеходов', description: 'Группа из семи человек', duration: 90, tone: 'group', kind: 'simulation' },
  { id: 'empty', name: 'Свободная дорога', description: 'Минимум машин', duration: 70, tone: 'clear', kind: 'simulation' },
  { id: 'failure', name: 'Отказ камеры', description: 'Резервный цикл', duration: 90, tone: 'fault', kind: 'simulation' },
]

function TrafficEditor({ profile, onChange, effective }: { profile: TrafficProfile; onChange: (next: TrafficProfile) => void; effective?: Report['profile'] }) {
  return <section className="sim-traffic-editor" aria-label="Настройки дорожного потока">
    <div className="sim-panel-head"><div><TrafficCone size={17}/><h2>Потоки и условия</h2></div><span>Настройте свой сценарий</span></div>
    <div className="sim-demand-fields">
      <label><span><TrafficCone size={17}/> Машины <strong>{profile.vehicle_rate} / мин</strong></span><input type="range" min="0" max="120" value={profile.vehicle_rate} onChange={event => onChange({ ...profile, vehicle_rate: Number(event.target.value) })}/><small>От пустой дороги до плотного потока</small></label>
      <label><span><Users size={17}/> Пешеходы <strong>{profile.pedestrian_rate} / мин</strong></span><input type="range" min="0" max="60" value={profile.pedestrian_rate} onChange={event => onChange({ ...profile, pedestrian_rate: Number(event.target.value) })}/><small>Число новых людей у перехода</small></label>
    </div>
    <div className="sim-condition-group"><h3><Sun size={16}/> Время суток</h3><div className="sim-time-options" role="group" aria-label="Время суток">{timeOptions.map(option => <button type="button" key={option.id} className={profile.time_of_day === option.id ? 'active' : ''} aria-pressed={profile.time_of_day === option.id} onClick={() => onChange({ ...profile, time_of_day: option.id })}><option.icon size={17}/>{option.label}</button>)}</div></div>
    <div className="sim-condition-group"><h3><CalendarDays size={16}/> Тип дня</h3><div className="sim-day-options" role="group" aria-label="Тип дня">{dayOptions.map(option => <button type="button" key={option.id} className={profile.day_type === option.id ? 'active' : ''} aria-pressed={profile.day_type === option.id} onClick={() => onChange({ ...profile, day_type: option.id })}>{option.label}</button>)}</div></div>
    <div className="sim-effective">{effective ? <>С учётом выбранных условий: <strong>{effective.effective_vehicle_rate} авто/мин</strong> и <strong>{effective.effective_pedestrian_rate} чел./мин</strong></> : 'Выберите «Свой поток», чтобы применить параметры.'}</div>
  </section>
}

function PhaseEditor({ config, onChange }: { config: Config; onChange: (config: Config) => void }) {
  const manual = config.control_mode === 'manual'
  const cycle = phases.reduce((total, phase) => total + config.phase_plan[phase.key], 0)
  return <section className="sim-editor" aria-label="Настройка фаз">
    <div className="sim-panel-head"><div><SlidersHorizontal size={17}/><h2>Настройка фаз</h2></div><span>Изменения применяются автоматически</span></div>
    <div className="sim-mode" role="group" aria-label="Режим управления">
      <button type="button" aria-pressed={!manual} className={!manual ? 'active' : ''} onClick={() => onChange({ ...config, control_mode: 'adaptive' })}>Адаптивный</button>
      <button type="button" aria-pressed={manual} className={manual ? 'active' : ''} onClick={() => onChange({ ...config, control_mode: 'manual' })}>Ручной план</button>
    </div>
    {manual ? <>
      <div className="sim-cycle"><span>Полный цикл</span><strong>{cycle} с</strong></div>
      <div className="sim-phase-preview" aria-label={`Длительность цикла ${cycle} секунд`}>{phases.map(phase => <span key={phase.key} className={`phase-${phase.key}`} style={{ flex: config.phase_plan[phase.key] }}/>)}</div>
      <div className="sim-phase-fields">{phases.map((phase, index) => <label key={phase.key} className="sim-phase-field"><span className="sim-phase-number">{index + 1}</span><span className="sim-phase-copy"><strong>{phase.label}</strong><small>{phase.hint}</small><input type="range" min={phase.min} max={phase.max} value={config.phase_plan[phase.key]} onChange={event => onChange({ ...config, phase_plan: { ...config.phase_plan, [phase.key]: Number(event.target.value) } })} aria-label={`${phase.label}, секунд`}/></span><span className="sim-phase-value">{config.phase_plan[phase.key]} с</span></label>)}</div>
    </> : <div className="sim-adaptive-fields">
      <p>Контроллер выбирает момент переключения по потоку и запросам пешеходов.</p>
      <label><span>Минимум зелёного для машин <strong>{config.min_vehicle_green} с</strong></span><input type="range" min="5" max="40" value={config.min_vehicle_green} onChange={event => onChange({ ...config, min_vehicle_green: Number(event.target.value) })}/></label>
      <label><span>Зелёный для пешеходов <strong>{config.pedestrian_green} с</strong></span><input type="range" min="8" max="30" value={config.pedestrian_green} onChange={event => onChange({ ...config, pedestrian_green: Number(event.target.value) })}/></label>
      <p>Остальные пороги доступны во вкладке «Настройки».</p>
    </div>}
    <div className="sim-editor-foot"><span>Минимумы модели: предупреждение 3 с, общий красный 2 с, пешеходы 8 с.</span></div>
  </section>
}

export default function Simulator({ initialConfig }: { initialConfig: Config }) {
  const [config, setConfig] = useState<Config>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SIMULATOR_STORAGE_KEY) || '{}')
      return { ...initialConfig, control_mode: 'manual', ...saved.config, phase_plan: { ...initialConfig.phase_plan, ...saved.config?.phase_plan } }
    } catch { return { ...initialConfig, control_mode: 'manual' } }
  })
  const [scenarioId, setScenarioId] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(SIMULATOR_STORAGE_KEY) || '{}'); return fallbackScenarios.some(item => item.id === saved.scenarioId) ? saved.scenarioId : 'custom' } catch { return 'custom' }
  })
  const [profile, setProfile] = useState<TrafficProfile>(() => {
    try { return { ...defaultProfile, ...JSON.parse(localStorage.getItem(SIMULATOR_STORAGE_KEY) || '{}').profile } } catch { return defaultProfile }
  })
  const [scenarios, setScenarios] = useState<Scenario[]>(fallbackScenarios)
  const [report, setReport] = useState<Report | null>(null)
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { localStorage.setItem(SIMULATOR_STORAGE_KEY, JSON.stringify({ config, scenarioId, profile })) }, [config, scenarioId, profile])
  useEffect(() => { fetch('/api/scenarios').then(response => response.ok ? response.json() : Promise.reject()).then((items: Scenario[]) => setScenarios([fallbackScenarios[0], ...items.filter(item => item.kind === 'simulation')])).catch(() => {}) }, [])
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true); setError('')
      fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario_id: scenarioId, config, profile }), signal: controller.signal })
        .then(response => response.ok ? response.json() : Promise.reject(new Error('Не удалось пересчитать сценарий. Проверьте подключение к серверу.')))
        .then((data: Report) => { setReport(data); setCurrent(0); setLoading(false) })
        .catch(err => { if (!controller.signal.aborted) { setError(err.message); setLoading(false) } })
    }, 220)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [scenarioId, config, profile])
  useEffect(() => {
    if (!playing || !report || loading) return
    const timer = window.setInterval(() => setCurrent(value => { if (value >= report.frames.length - 1) { setPlaying(false); return value } return value + 1 }), 1000 / speed)
    return () => window.clearInterval(timer)
  }, [playing, report, loading, speed])
  const signalPlan = useMemo(() => buildSignalPlan(report?.frames ?? []), [report])
  const vehicleSignals = signalPlan[current]
  const frame = report?.frames[Math.min(current, report.frames.length - 1)]
  const elapsed = useMemo(() => { if (!report || !frame) return 0; let i = current; while (i > 0 && report.frames[i - 1].phase === frame.phase) i--; return current - i }, [report, frame, current])
  const max = report ? report.frames.length - 1 : 0
  const scenario = scenarios.find(item => item.id === scenarioId)
  const restart = () => { setCurrent(0); setPlaying(true) }
  const updateProfile = (next: TrafficProfile) => { setProfile(next); setScenarioId('custom') }
  return <div className="simulator">
    <div className="sim-toolbar"><div className="sim-scenario-picker"><label htmlFor="sim-scenario">Дорожная обстановка</label><select id="sim-scenario" value={scenarioId} onChange={event => { setScenarioId(event.target.value); setCurrent(0) }}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{scenario?.description}</small></div><div className="sim-toolbar-note"><span className="sim-live-dot"/> Виртуальная сцена на данных сценария</div></div>
    <div className="sim-layout"><div className="sim-main-column">
      <section className="sim-stage" aria-label="Симуляция дорожной обстановки"><div className="sim-stage-header"><div><span>Переход № 01</span><strong>{frame ? phaseLabels[frame.phase] : 'Загрузка сцены'}</strong></div><span className={`sim-phase-chip ${frame?.phase ?? ''}`}>{frame ? frame.mode === 'fallback' ? 'Резервный цикл' : config.control_mode === 'manual' ? 'Ручной план' : 'Адаптивный режим' : 'Подготовка'}</span></div>{frame ? <ThreeRoadScene frames={report!.frames} current={current} playing={playing} speed={speed} profile={profile}/> : <div className="sim-stage-empty">Загрузка сценария…</div>}{loading && report && <div className="sim-updating" role="status">Пересчитываем фазы…</div>}</section>
      <div className="sim-transport"><button type="button" className="sim-play" onClick={() => { if (current >= max) restart(); else setPlaying(!playing) }} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>{playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button><button type="button" className="sim-reset" onClick={restart} aria-label="Начать заново"><RotateCcw size={17}/></button><span className="sim-time">{formatTime(current)}</span><input type="range" min="0" max={Math.max(1, max)} value={current} onChange={event => { setCurrent(Number(event.target.value)); setPlaying(false) }} aria-label="Перемотка симуляции"/><span className="sim-time">{formatTime(max)}</span><button type="button" className="sim-speed" onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)} aria-label={`Скорость ${speed} крат`}>{speed}×</button></div>
      {report && <div className="sim-timeline"><div className="sim-section-title"><h2>Ход симуляции</h2><span>Нажмите на шкалу, чтобы перейти к моменту</span></div><div className="sim-timeline-track">{report.frames.map((item, i) => <span key={i} className={`phase-${item.phase}`}/>)}<input type="range" min="0" max={max} value={current} onChange={event => { setCurrent(Number(event.target.value)); setPlaying(false) }} aria-label="Шкала фаз"/></div><div className="sim-timeline-axis"><span>00:00</span><span>{formatTime(Math.round(max / 2))}</span><span>{formatTime(max)}</span></div><div className="sim-current-reason"><Activity size={16}/><span>{frame?.reason}</span><strong>{elapsed} с в фазе</strong></div></div>}
    </div><div className="sim-side-column"><div className="sim-signals"><h2>Сигналы сейчас</h2><p className="sim-signal-detail">Направления едут по очереди, с паузой для освобождения перекрёстка.</p>{['Запад ↔ восток', 'Север ↔ юг'].map((direction, axis) => <div key={direction} className="sim-signal-row"><span className="sim-signal-icon"><TrafficCone size={19}/></span><span>{direction}</span><strong className={vehicleSignals?.[axis] === 'green' ? 'go' : vehicleSignals?.[axis] === 'amber' || vehicleSignals?.[axis] === 'red_amber' ? 'warn' : 'stop'}>{!vehicleSignals ? '—' : vehicleSignals[axis] === 'green' ? 'Зелёный' : vehicleSignals[axis] === 'amber' ? 'Жёлтый' : vehicleSignals[axis] === 'red_amber' ? 'Красный + жёлтый' : 'Красный'}</strong></div>)}<div className="sim-signal-row"><span className="sim-signal-icon"><Users size={19}/></span><span>Пешеходы</span><strong className={frame?.phase === 'pedestrian_green' ? 'go' : 'stop'}>{!frame ? '—' : frame.phase === 'pedestrian_green' ? 'Зелёный' : 'Красный'}</strong></div><div className="sim-signal-detail">{frame?.healthy === false ? 'Нет данных камеры · резервный цикл' : `${frame?.vehicles ?? '—'} авто в зоне · ${frame?.pedestrians ?? '—'} ${frame?.phase === 'pedestrian_green' ? 'пешеходов у перехода' : 'пешеходов ждут'}`}</div></div><TrafficEditor profile={profile} onChange={updateProfile} effective={scenarioId === 'custom' ? report?.profile : undefined}/><PhaseEditor config={config} onChange={setConfig}/></div></div>
    {error && <div className="sim-error" role="alert"><AlertTriangle size={18}/>{error}<button onClick={() => setConfig({ ...config })}>Повторить</button></div>}
    {report && <div className="sim-results"><div className="sim-section-title"><h2>Результат сценария</h2><span>Показатели модели после изменения фаз</span></div><div className="sim-result-grid"><div><span>Прибыло машин</span><strong>{report.summary.vehicles}</strong></div><div><span>Прибыло пешеходов</span><strong>{report.summary.pedestrians}</strong></div><div><span>Среднее ожидание</span><strong>{report.summary.mean_wait ?? '—'} <small>с</small></strong></div><div><span>Обслужено запросов</span><strong>{report.summary.served_requests}<small> / {report.summary.served_requests + report.summary.unserved_requests}</small></strong></div><div><span>Зелёный для машин</span><strong>{report.summary.vehicle_green_share ?? '—'}<small> % времени</small></strong></div><div><span>Смен фаз</span><strong>{report.summary.phase_switches}</strong></div></div></div>}
    <p className="sim-disclaimer">Это иллюстрация работы виртуального контроллера. Карта построена в 3D, движение участников схематично; расчёт фаз и показателей выполняется моделью, реальное оборудование не подключено.</p>
  </div>
}
