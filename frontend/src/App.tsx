import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownToLine, ArrowRight, BarChart3, Camera, Check, ChevronDown, CircleHelp, Clock3, Gauge, LayoutDashboard, Menu, Pause, Play, RotateCcw, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, TrafficCone, Zap, TriangleAlert, Users } from 'lucide-react'
import type { Config, Event, Frame, Page, Phase, PhasePlan, Report, Scenario } from './types'
const Simulator = lazy(() => import('./Simulator'))

const defaultPhasePlan: PhasePlan = { vehicle_green: 30, warning: 3, all_red_to_ped: 2, pedestrian_green: 12, pedestrian_clearance: 6, all_red_to_vehicle: 2 }
const defaults: Config = { control_mode: 'adaptive', phase_plan: defaultPhasePlan, min_vehicle_green: 10, pedestrian_green: 8, pedestrian_clearance: 6, segment_length_km: 0.1, k_ref: 20, t_max_s: 90, density_window_s: 20 }
const CONFIG_STORAGE_KEY = 'sc-config-v3'
const fallbackVideo: Scenario = { id: 'video', name: 'Дневная запись', description: 'Дневные условия: основной эпизод с активным движением пешеходов по переходу', duration: 162, tone: 'day', kind: 'video', period: 'День', video_url: '/api/videos/video' }
const phaseName: Record<Phase, string> = { vehicle_green: 'Авто · зелёный', vehicle_yellow: 'Авто · жёлтый', all_red_to_pedestrian: 'Все · красный', pedestrian_walk: 'Пешеходы · зелёный', pedestrian_clearance: 'Пешеходы · освобождают переход', all_red_to_vehicle: 'Все · красный' }
const phaseShort: Record<Phase, string> = { vehicle_green: 'Авто', vehicle_yellow: 'Жёлтый', all_red_to_pedestrian: 'Стоп', pedestrian_walk: 'Пешеходы', pedestrian_clearance: 'Освобождение', all_red_to_vehicle: 'Стоп' }
const modeLabel: Record<Frame['mode'], string> = { adaptive: 'Адаптивный', manual: 'Ручной план', fallback: 'Резервный цикл', fixed: 'Постоянный цикл' }
const time = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
const displayNumber = (value: number | string) => typeof value === 'number' ? value.toLocaleString('ru-RU') : value
const visiblePhase = (frame: Frame) => frame.display_phase ?? frame.phase
const visibleReason = (frame: Frame) => frame.display_reason ?? frame.reason

function Signal({ label, active, type }: { label: string; active: boolean; type: 'car' | 'ped' }) {
  return <div className="signal"><span className="signal-label">{label}</span><div className="signal-head"><i className={!active ? 'lit red' : ''}/><i className={active ? `lit ${type === 'car' ? 'green' : 'cyan'}` : ''}/></div><span className="signal-state">{active ? 'ПРОХОД / ПРОЕЗД' : 'ОЖИДАНИЕ'}</span></div>
}

function CrossingView({ frame, scenario, videoRef, onVideoTimeUpdate, onVideoEnded, onVideoPlay, onVideoPause }: { frame: Frame; scenario: Scenario; videoRef: React.RefObject<HTMLVideoElement>; onVideoTimeUpdate: (second: number) => void; onVideoEnded: () => void; onVideoPlay: () => void; onVideoPause: () => void }) {
  const phase = visiblePhase(frame)
  const carGreen = phase === 'vehicle_green'
  const pedGreen = phase === 'pedestrian_walk'
  const people = frame.pedestrians ?? 0
  const isVideo = scenario.kind === 'video'
  return <div className={`crossing-view ${!frame.healthy ? 'is-fault' : ''}`}>
    <div className="view-top"><span className="view-label"><Camera size={15}/> Камера 01 · демонстрационный переход</span><span className={`live-pill ${frame.healthy ? '' : 'offline'}`}><span/>{!frame.healthy ? 'СИГНАЛ ПОТЕРЯН' : isVideo ? 'ЗАПИСЬ МОДУЛЯ КОМПЬЮТЕРНОГО ЗРЕНИЯ' : 'СИМУЛЯЦИЯ В РЕАЛЬНОМ ВРЕМЕНИ'}</span></div>
    <div className={`scene ${isVideo ? 'video-scene' : ''}`} role={isVideo ? undefined : 'img'} aria-label={isVideo ? undefined : `Схема перекрёстка для ситуации ${scenario.name}. Автомобилей: ${frame.vehicles ?? "нет данных"}, пешеходов: ${frame.pedestrians ?? "нет данных"}.`}>
      {isVideo ? <video ref={videoRef} className="cv-video" src={scenario.video_url} preload="metadata" playsInline aria-label="Обработанная запись пешеходного перехода" onTimeUpdate={event => onVideoTimeUpdate(Math.floor(event.currentTarget.currentTime))} onEnded={onVideoEnded} onPlay={onVideoPlay} onPause={onVideoPause}/> : <>
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
      <div className="scene-caption"><span>{isVideo ? 'Запись · данные компьютерного зрения' : `Схема объекта · ${scenario.name}`}</span><span>t = {time(frame.time)}</span></div>
    </div>
    <div className="signal-strip" aria-label="Модельные сигналы виртуального контроллера"><Signal label="ТРАНСПОРТ · МОДЕЛЬ" active={carGreen} type="car"/><div className="signal-divider"/><div className="center-phase"><span>МОДЕЛЬНАЯ ФАЗА</span><strong>{phaseName[phase]}</strong><small>{modeLabel[frame.mode]}</small></div><div className="signal-divider"/><Signal label="ПЕШЕХОДЫ · МОДЕЛЬ" active={pedGreen} type="ped"/></div>
  </div>
}

function Timeline({ frames, current, onChange, compact = false }: { frames: Frame[]; current: number; onChange: (t: number) => void; compact?: boolean }) {
  const segments = useMemo(() => frames.reduce<{ start: number; end: number; phase: Phase }[]>((all, f) => {
    const last = all[all.length - 1]
    const phase = visiblePhase(f)
    if (last?.phase === phase) last.end = f.time + 1
    else all.push({ start: f.time, end: f.time + 1, phase })
    return all
  }, []), [frames])
  const max = frames.length - 1
  const frame = frames[current]
  const phase = visiblePhase(frame)
  let phaseStart = current
  while (phaseStart > 0 && visiblePhase(frames[phaseStart - 1]) === phase) phaseStart -= 1
  const phaseElapsed = current - phaseStart
  return <div className={`timeline ${compact ? 'compact' : ''}`}><div className="timeline-head"><div><h3>Модельная шкала фаз</h3><p>Решения виртуального контроллера по данным записи; сигналы на видео не измерялись</p></div><span className="mono">{time(current)} / {time(max)}</span></div><div className="phase-track">{segments.map((s, i) => <button key={i} className={`segment phase-${s.phase}`} style={{ width: `${(s.end - s.start) / frames.length * 100}%` }} title={`${phaseName[s.phase]} с ${time(s.start)} по ${time(s.end - 1)}`} aria-label={`${phaseName[s.phase]}, с ${time(s.start)} по ${time(s.end - 1)}`} onClick={() => onChange(s.start)}><span>{s.end - s.start > 9 ? phaseShort[s.phase] : ''}</span></button>)}<div className="playhead" style={{ left: `${current / max * 100}%` }}/></div><input aria-label="Перемотка записи" type="range" min="0" max={max} value={current} onChange={e => onChange(Number(e.target.value))}/><div className="time-axis"><span>00:00</span><span>{time(Math.round(max / 4))}</span><span>{time(Math.round(max / 2))}</span><span>{time(Math.round(max * 3 / 4))}</span><span>{time(max)}</span></div><div className="legend"><span><i className="legend-car"/>Автомобили</span><span><i className="legend-warn"/>Предупреждение</span><span><i className="legend-stop"/>Защитный интервал</span><span><i className="legend-ped"/>Пешеходы</span></div><div className="timeline-reason"><Clock3 size={16}/><div><small>Модельное решение на {time(current)}</small><strong>{visibleReason(frame)}</strong></div><time>{phaseElapsed} с в фазе</time></div></div>
}

function FlowChart({ frames, current }: { frames: Frame[]; current: number }) {
  const values = frames.map(f => f.flow_per_min ?? 0)
  const max = Math.max(12, ...values)
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${72 - v / max * 62}`).join(' ')
  return <div className="flow-chart"><div className="chart-head"><div><h3>Интенсивность транспорта</h3><p>Авто/мин · предыдущее окно 30 с</p></div><span className="chart-value">{frames[current].flow_per_min ?? '—'} <small>авто/мин</small></span></div><svg viewBox="0 0 100 80" preserveAspectRatio="none" role="img" aria-label={`Интенсивность транспорта за ${time(frames.length - 1)}. В выбранный момент: ${frames[current].flow_per_min ?? 'нет данных'} автомобилей в минуту`}><line x1="0" y1="72" x2="100" y2="72" className="axis"/><line x1="0" y1="41" x2="100" y2="41" className="gridline"/><line x1="0" y1="10" x2="100" y2="10" className="gridline"/><polyline points={points} fill="none" className="flow-line"/><line x1={current / (frames.length - 1) * 100} y1="0" x2={current / (frames.length - 1) * 100} y2="76" className="chart-cursor"/></svg><div className="chart-axis"><span>00:00</span><span>{time(frames.length - 1)}</span></div></div>
}

function Metric({ icon: Icon, label, value, unit, foot }: { icon: typeof Activity; label: string; value: string | number; unit?: string; foot?: string }) {
  return <div className="metric"><div className="metric-icon"><Icon size={18}/></div><div className="metric-label">{label}</div><div className="metric-number">{displayNumber(value)}<small>{unit}</small></div>{foot && <div className="metric-foot">{foot}</div>}</div>
}

function TrafficStats({ summary, baseline }: { summary: Report['summary']; baseline: Report['baseline'] }) {
  const requests = summary.served_requests + summary.unserved_requests
  return <section className="traffic-stats" aria-label="Статистика потока и запросов">
    <div className="traffic-stats-heading"><div><h2>Поток и загрузка перехода</h2><p>Показатели рассчитаны по секундам с доступным изображением. Плотность — число автомобилей одновременно в зоне подъезда.</p></div></div>
    <div className="analytics-metrics traffic-stats-grid">
      <Metric icon={Gauge} label="Средняя интенсивность" value={summary.mean_flow_per_min ?? '—'} unit="авто/мин" foot="Окно потока 30 секунд"/>
      <Metric icon={Activity} label="Пик интенсивности" value={summary.peak_flow_per_min ?? '—'} unit="авто/мин" foot="Максимум за эпизод"/>
      <Metric icon={TrafficCone} label="Пик плотности" value={summary.peak_vehicles_in_zone ?? '—'} unit="авто" foot="Одновременно в зоне"/>
      <Metric icon={Clock3} label="Максимальное модельное ожидание" value={summary.max_wait ?? '—'} unit="с" foot="До модельного зелёного для пешеходов"/>
      <Metric icon={TrafficCone} label="Модельная доля зелёного для авто" value={summary.vehicle_green_share ?? '—'} unit="%" foot={`${summary.vehicle_closed_seconds} с модельный проезд закрыт · постоянный цикл ${baseline.vehicle_green_share ?? '—'}%`}/>
      <Metric icon={Users} label="Модельные запросы" value={`${summary.served_requests}/${requests}`} foot={`${summary.unserved_requests} не обслужено к концу записи`}/>
    </div>
  </section>
}

function DecisionLogicExplainer({ config }: { config: Config }) {
  const warningSeconds = 3
  const allRedSeconds = 2
  const protectionSeconds = warningSeconds + allRedSeconds
  const singlePreparationAt = Math.max(0, config.max_single_wait - protectionSeconds)
  const groupPreparationAt = Math.max(0, config.max_group_wait - protectionSeconds)
  const adaptiveActive = config.control_mode === 'adaptive'

  return <section className={`decision-explainer panel ${adaptiveActive ? '' : 'is-inactive'}`} aria-label="Логика включения пешеходного зелёного">
    <div className="decision-explainer-head">
      <div><span className="section-kicker"><Zap size={16}/> ЛОГИКА РЕШЕНИЯ</span><h2>Когда модель включает зелёный пешеходам</h2><p>{adaptiveActive ? `Сначала система фиксирует запрос от пешехода и ждёт минимум ${config.min_vehicle_green} с автомобильного зелёного. Затем достаточно выполнить одно из условий ниже.` : 'Ниже показана адаптивная формула, но сейчас она не применяется: в ручном режиме фазы переключаются по заданному плану.'}</p></div>
      <span className={`logic-mode-badge ${adaptiveActive ? '' : 'inactive'}`}>{adaptiveActive ? 'Адаптивный режим включён' : 'Сейчас выбран ручной план'}</span>
    </div>

    <div className="plain-formula" role="group" aria-label="Формула решения">
      <span className="formula-caption">ФОРМУЛА ПРОСТЫМИ СЛОВАМИ</span>
      <div className="formula-line"><strong>Начать переключение</strong><span>=</span><b>есть пешеход</b><span>И</span><b>прошло {config.min_vehicle_green} с</b><span>И</span><b>сработало любое условие</b></div>
      <div className="formula-conditions">
        <div><span>01</span><strong>Дорога свободна</strong><small>машин нет подряд 5 секунд</small></div>
        <div><span>02</span><strong>Человек ждёт долго</strong><small>подготовка с {singlePreparationAt} с, зелёный не позднее {config.max_single_wait} с</small></div>
        <div><span>03</span><strong>Собралась группа</strong><small>от {config.group_threshold} человек и ожидание от 8 секунд</small></div>
        <div><span>04</span><strong>Низкий поток</strong><small>не больше {config.low_flow_threshold} авто/мин и ожидание от 5 секунд</small></div>
      </div>
    </div>

    <div className="formula-details">
      <div><ShieldCheck size={20}/><p><strong>Безопасность важнее скорости.</strong> После решения идут {warningSeconds} с предупреждения и {allRedSeconds} с общего красного. Только потом включается пешеходный зелёный.</p></div>
      <div><Clock3 size={20}/><p><strong>Группа получает приоритет.</strong> Для {config.group_threshold}+ человек подготовка начинается не позднее {groupPreparationAt} с ожидания, чтобы зелёный включился не позднее {config.max_group_wait} с.</p></div>
      <div><Gauge size={20}/><p><strong>Поток считается за последние 30 секунд.</strong> Количество новых автомобилей умножается на два и переводится в показатель «авто в минуту».</p></div>
    </div>
    <p className="formula-disclaimer"><CircleHelp size={16}/> Это формула виртуального контроллера для демонстрации на записи. Она не управляет реальным светофором и требует отдельной проверки для реальной дороги.</p>
  </section>
}

function EventList({ events, current, onChange, limit = 5 }: { events: Event[]; current: number; onChange: (t: number) => void; limit?: number }) {
  const past = [...events].filter(e => e.time <= current).reverse().slice(0, limit)
  const upcoming = past.length ? [] : events.filter(e => e.time > current).slice(0, limit)
  const shown = past.length ? past : upcoming
  return <div className="event-list">{shown.length ? shown.map((event, i) => <button className={`event-row ${past.length ? '' : 'upcoming'}`} key={`${event.time}-${i}`} onClick={() => onChange(event.time)}><span className={`event-dot ${event.type}`}/><span className="event-copy">{event.text}</span><time>{time(event.time)}</time></button>) : <p className="empty-events">В этой записи пока нет модельных событий</p>}</div>
}

function AnalyticsOverview({ report, current, onChange, onSettings }: { report: Report; current: number; onChange: (t: number) => void; onSettings: () => void }) {
  const summary = report.summary
  const baselineWait = report.baseline.mean_wait
  const activeCycleName = report.config.control_mode === 'manual' ? 'Ручной план' : 'Адаптивный цикл'
  const comparisonText = 'Средние рассчитаны по разным модельным запросам. Запись не позволяет определить, какой режим эффективнее: очередь на видео не меняется после модельного переключения.'
  return <>
    <div className="section-note"><BarChart3 size={18}/><span>{report.disclaimer}</span></div>
    <section className="analytics-lead" aria-label="Главные показатели эпизода">
      <div className="wait-lead"><div><span className="section-kicker">МОДЕЛЬНОЕ ОЖИДАНИЕ</span><h2>Сравнение режимов пока некорректно</h2><p>От модельного запроса до модельного зелёного для пешеходов. Сигнал светофора на видео не измерялся.</p></div><div className="wait-number"><strong>{summary.served_requests}/{summary.served_requests + summary.unserved_requests}</strong><span>запросов обслужено в модели</span></div><div className="wait-compare"><div><span>{activeCycleName}</span><strong>{displayNumber(summary.mean_wait ?? '—')} с · {summary.served_requests} обслужено</strong></div><div><span>Постоянный цикл</span><strong>{displayNumber(baselineWait ?? '—')} с · {report.baseline.served_requests} обслужено</strong></div></div><div className="wait-delta"><CircleHelp size={19}/><span>{comparisonText}</span></div></div>
      <div className="analytics-side-stats"><div className="side-stat traffic-stat"><span className="side-stat-icon"><TrafficCone size={18}/></span><div><strong>{summary.vehicles}</strong><span>обнаружений авто</span></div><small>по данным компьютерного зрения</small></div><div className="side-stat"><span className="side-stat-icon"><Users size={18}/></span><div><strong>{summary.pedestrians}</strong><span>обнаружений пешеходов</span></div><small>пик ожидания: {summary.peak_pedestrians} человек</small></div><div className="side-stat"><span className="side-stat-icon"><ShieldCheck size={18}/></span><div><strong>{summary.safety_violations}</strong><span>нарушений в модели</span></div><small>не проверяет реальные сигналы</small></div></div>
      <div className="lead-performance"><CircleHelp size={28}/><div><strong>Запись и модель</strong><p>Видеоданные показывают поток и людей; переключения светофора здесь рассчитаны виртуально.</p></div></div>
    </section>
    <TrafficStats summary={summary} baseline={report.baseline}/>
    <DecisionLogicExplainer config={report.config}/>
    <div className="analytics-grid"><div className="panel"><FlowChart frames={report.frames} current={current}/></div><div className="panel compare-panel"><span className="section-kicker">МОДЕЛЬНЫЕ РЕЖИМЫ</span><h3>Одна запись, два расчёта</h3><p>Среднее ожидание только по обслуженным запросам</p><div className="compare-row"><span>{activeCycleName}</span><strong>{displayNumber(summary.mean_wait ?? '—')} с</strong><small>{summary.served_requests} обслужено</small></div><div className="compare-row fixed"><span>Постоянный цикл</span><strong>{displayNumber(baselineWait ?? '—')} с</strong><small>{report.baseline.served_requests} обслужено</small></div><div className="compare-result"><CircleHelp size={19}/><span>{comparisonText}</span></div></div></div>
    <div className="analytics-grid second"><div className="panel"><Timeline frames={report.frames} current={current} onChange={onChange} compact/></div><div className="panel recommendation"><span className="section-kicker"><Sparkles size={16}/> ПОЯСНЕНИЕ</span><h3>Что показывает модель на записи</h3><p>{report.recommendation}</p><button className="text-link" onClick={onSettings}>Настроить параметры <ArrowRight size={17}/></button></div></div>
  </>
}

const configMeta: { key: keyof Omit<Config, 'control_mode' | 'phase_plan'>; label: string; help: string; min: number; max: number; unit: string }[] = [
  { key: 'min_vehicle_green', label: 'Минимальная автомобильная фаза', help: 'Время до первого возможного переключения', min: 5, max: 40, unit: 'с' },
  { key: 'segment_length_km', label: 'Длина участка перед переходом', help: 'Размеченный участок для измерения плотности', min: 0.05, max: 0.5, unit: 'км' },
  { key: 'k_ref', label: 'Опорная дневная плотность', help: 'Калибруется для этого участка и числа полос', min: 1, max: 100, unit: 'авто/км' },
  { key: 't_max_s', label: 'Предельное ожидание запроса', help: 'До начала смены сигналов; для объекта требует утверждения', min: 30, max: 180, unit: 'с' },
  { key: 'density_window_s', label: 'Окно сглаживания плотности', help: 'Среднее число машин на участке', min: 5, max: 60, unit: 'с' },
  { key: 'pedestrian_green', label: 'Пешеходная фаза', help: 'Продолжительность зелёного сигнала', min: 8, max: 30, unit: 'с' },
  { key: 'pedestrian_clearance', label: 'Освобождение перехода', help: 'Обязательный защитный интервал', min: 3, max: 30, unit: 'с' },
]

const phaseMeta: { key: keyof PhasePlan; label: string; min: number; max: number; help: string }[] = [
  { key: 'vehicle_green', label: 'Автомобили · зелёный', min: 5, max: 90, help: 'Проезд открыт' },
  { key: 'warning', label: 'Предупреждение', min: 3, max: 10, help: 'Не менее 3 с' },
  { key: 'all_red_to_ped', label: 'Все · красный', min: 2, max: 10, help: 'Перед пешеходами, не менее 2 с' },
  { key: 'pedestrian_green', label: 'Пешеходы · зелёный', min: 8, max: 60, help: 'Не менее 8 с' },
  { key: 'pedestrian_clearance', label: 'Освобождение перехода', min: 3, max: 60, help: 'Обязательное время освобождения' },
  { key: 'all_red_to_vehicle', label: 'Все · красный', min: 2, max: 10, help: 'Перед автомобилями, не менее 2 с' },
]

function PhaseBuilder({ draft, onChange }: { draft: Config; onChange: (next: Config) => void }) {
  const manual = draft.control_mode === 'manual'
  const total = phaseMeta.reduce((sum, item) => sum + draft.phase_plan[item.key], 0)
  return <section className="panel phase-builder" aria-label="Конструктор фаз">
    <div className="phase-builder-head"><div><span className="section-kicker"><SlidersHorizontal size={16}/> КОНСТРУКТОР ФАЗ</span><h2>Модельный план фаз</h2><p>Выберите режим и длительности. В модели последовательность фаз фиксирована.</p></div><strong>{total} с <small>ручной цикл</small></strong></div>
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
  const [videoScenarios, setVideoScenarios] = useState<Scenario[]>([fallbackVideo])
  const [scenarioId, setScenarioId] = useState(fallbackVideo.id)
  const [config, setConfig] = useState<Config>(() => { try { const saved = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || '{}'); return { ...defaults, ...saved, phase_plan: { ...defaultPhasePlan, ...saved.phase_plan } } } catch { return defaults } })
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
  const activeScenario = videoScenarios.find(item => item.id === scenarioId) ?? fallbackVideo
  const isVideoScenario = true
  useEffect(() => {
    let cancelled = false
    fetch('/api/scenarios')
      .then(response => response.ok ? response.json() : Promise.reject())
      .then((items: Scenario[]) => {
        if (cancelled) return
        const videos = items.filter(item => item.kind === 'video')
        if (videos.length) setVideoScenarios(videos)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setPlaying(false); setCurrent(0)
    fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario_id: scenarioId, config }) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Служба демонстрации недоступна. Запустите сервер на порту 8000.')))
      .then(data => { if (!cancelled) { setReport(data); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [config, scenarioId])
  useEffect(() => { if (!playing || !report || isVideoScenario) return; const id = window.setInterval(() => setCurrent(t => { if (t >= report.frames.length - 1) { setPlaying(false); return t } return t + 1 }), 1000 / speed); return () => clearInterval(id) }, [playing, speed, report, isVideoScenario])
  useEffect(() => {
    if (!isVideoScenario || page !== 'dashboard' || !report || !videoRef.current) return
    const video = videoRef.current
    video.playbackRate = speed
    if (Math.abs(video.currentTime - current) > 1) video.currentTime = current
    if (playing) void video.play().catch(() => setPlaying(false))
    else video.pause()
  }, [page, playing, report, isVideoScenario, speed])
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
  const framePhase = frame ? visiblePhase(frame) : 'vehicle_green'
  const frameReason = frame ? visibleReason(frame) : ''
  const frameMode = frame?.display_phase ? 'Резервный цикл · запись' : frame ? modeLabel[frame.mode] : ''
  const displayEvents = report?.display_events ?? report?.events ?? []
  const scenario = report?.scenario ?? activeScenario
  const seekToSecond = (second: number) => { setCurrent(second); if (isVideoScenario && videoRef.current) videoRef.current.currentTime = second }
  const togglePlayback = () => { if (report && current >= report.frames.length - 1 && !playing) seekToSecond(0); setPlaying(!playing) }
  const replay = () => { setConfig({ ...draft }); localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(draft)); setPage('dashboard'); setToast('Параметры сохранены. Модель пересчитана по записи.') }
  const resetSettings = () => { setDraft(defaults); setConfig(defaults); localStorage.removeItem(CONFIG_STORAGE_KEY); localStorage.removeItem('sc-config'); setToast('Настройки восстановлены') }
  const downloadCSV = () => { if (!report) return; const rows = ['second,phase,mode,camera_healthy,vehicles,pedestrians,flow_per_min,reason', ...report.frames.map(f => `${f.time},${f.phase},${f.mode},${f.healthy},${f.vehicles ?? ''},${f.pedestrians ?? ''},${f.flow_per_min ?? ''},"${f.reason.replace(/"/g, '""')}"`)]; const blob = new Blob(['\uFEFF', rows.join('\n')], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'запись-перехода.csv'; link.click(); URL.revokeObjectURL(link.href); setToast('Таблица отчёта загружена') }
  const nav: { id: Page; label: string; icon: typeof Activity }[] = [{ id: 'dashboard', label: 'Обзор', icon: LayoutDashboard }, { id: 'simulator', label: 'Симулятор', icon: TrafficCone }, { id: 'analytics', label: 'Аналитика', icon: BarChart3 }, { id: 'logic', label: 'Логика решений', icon: Activity }, { id: 'settings', label: 'Настройки', icon: Settings2 }]

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Перейти к содержимому</a>
    <aside id="navigation-drawer" className={`sidebar ${mobileNav ? 'open' : ''}`}><div className="brand"><div className="brand-mark" role="img" aria-label="Логотип"><span/><span/><span/></div></div><div className="side-section-label">УПРАВЛЕНИЕ</div><nav aria-label="Основная навигация">{nav.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setMobileNav(false) }}><item.icon size={19}/><span>{item.label}</span></button>)}</nav><div className="sidebar-bottom"><div className="system-card"><span className="system-pulse"/><div><strong>Источник: {page === 'simulator' ? 'виртуальный сценарий' : 'видеозапись'}</strong><small>{page === 'simulator' ? 'Синтетические данные · виртуальный контроллер' : isVideoScenario ? 'Видео и данные компьютерного зрения' : 'Виртуальный контроллер · демоданные'}</small></div></div><div className="side-foot">ЛАБОРАТОРИЯ УМНОГО ГОРОДА <span>Демо · версия 1.1.0</span></div></div></aside>
    {mobileNav && <button className="mobile-backdrop" tabIndex={-1} aria-label="Закрыть меню" onClick={() => setMobileNav(false)}/>}
    <main ref={mainContent} className="main" id="main-content"><header className="topbar"><button ref={menuTrigger} className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Открыть меню" aria-controls="navigation-drawer" aria-expanded={mobileNav}><Menu size={21}/></button><div className="breadcrumb">Система управления <span>/</span> <strong>{nav.find(x => x.id === page)?.label}</strong></div><div className="top-actions"><span className="demo-badge"><span/> ДЕМО-РЕЖИМ</span><span className="top-separator"/><span className="operator-avatar">О</span><div className="operator-name"><strong>Оператор</strong></div></div></header>
      <div className="content">
        <div className="page-intro"><div><span className="eyebrow">ПЕШЕХОДНЫЙ ПЕРЕХОД № 01 <span>/</span> {page === 'simulator' ? 'ВИРТУАЛЬНЫЙ СЦЕНАРИЙ' : `${activeScenario.period?.toUpperCase() ?? 'ЗАПИСЬ'} · КОМПЬЮТЕРНОЕ ЗРЕНИЕ`}</span><h1>{page === 'dashboard' ? 'Просмотр записи перехода' : page === 'simulator' ? 'Симулятор дорожной обстановки' : page === 'analytics' ? 'Данные записи и модель' : page === 'logic' ? 'Логика виртуального контроллера' : 'Настройки контроллера'}</h1><p>{page === 'dashboard' ? activeScenario.description : page === 'simulator' ? 'Меняйте фазы и наблюдайте, как движутся машины и пешеходы.' : page === 'analytics' ? 'Наблюдения компьютерного зрения и расчёт виртуального контроллера.' : page === 'logic' ? 'Как виртуальный контроллер рассчитывает фазы на данных записи.' : 'Выберите режим, настройте фазы и пересчитайте запись.'}</p></div><div className="intro-actions">{page !== 'simulator' && <div className="scenario-select"><span>ВИДЕОЗАПИСЬ</span><select value={scenarioId} onChange={event => setScenarioId(event.target.value)} aria-label="Выбрать видеозапись">{videoScenarios.map(item => <option key={item.id} value={item.id}>{item.name} · {item.period}</option>)}</select><ChevronDown size={16}/></div>}{page === 'analytics' && <button className="button secondary" onClick={downloadCSV}><ArrowDownToLine size={17}/> Выгрузить таблицу</button>}</div></div>
        {page === 'simulator' && <Suspense fallback={<div className="loading-state">Загрузка симулятора…</div>}><Simulator initialConfig={config}/></Suspense>}
        {page !== 'simulator' && loading && <div className="loading-state" role="status" aria-live="polite"><div className="spinner"/>Загрузка записи компьютерного зрения…</div>}
        {page !== 'simulator' && error && <div className="error-state" role="alert"><TriangleAlert size={22}/><div><strong>Не удалось загрузить данные</strong><p>{error}</p></div><button className="button" onClick={() => setConfig({ ...config })}>Повторить</button></div>}
        {page !== 'simulator' && report && frame && !loading && !error && <>
          {page === 'dashboard' && <><div className="status-ribbon"><div className={`ribbon-status ${frame.healthy ? '' : 'fault'}`}><span className="ribbon-icon">{frame.healthy ? <ShieldCheck size={18}/> : <TriangleAlert size={18}/>}</span><div><strong>{frame.healthy ? 'Данные записи доступны' : 'Потеря изображения камеры'}</strong><small>{frame.healthy ? `Данные CV доступны · ${frameMode}` : 'Модель использует резервный цикл'}</small></div></div><span className="ribbon-time"><Clock3 size={16}/> {time(current)} записи</span></div><div className="dashboard-grid"><div className="workspace"><CrossingView frame={frame} scenario={scenario} videoRef={videoRef} onVideoTimeUpdate={second => setCurrent(Math.min(second, report.frames.length - 1))} onVideoEnded={() => { setPlaying(false); setCurrent(report.frames.length - 1) }} onVideoPlay={() => setPlaying(true)} onVideoPause={() => setPlaying(false)}/><div className="playback-bar"><button className="round-play" onClick={togglePlayback} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>{playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button><span className="mono playback-time">{time(current)}</span><input aria-label="Перемотка воспроизведения" type="range" min="0" max={report.frames.length - 1} value={current} onChange={e => seekToSecond(Number(e.target.value))}/><span className="mono duration">{time(isVideoScenario ? report.frames.length : report.frames.length - 1)}</span><button className="speed" onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)} aria-label={`Скорость воспроизведения: ${speed}×`}>{speed}×</button></div></div><div className="insight-column"><div className="decision-card"><div className="card-top"><span className="section-kicker"><Zap size={16}/> МОДЕЛЬНОЕ РЕШЕНИЕ</span><span className="decision-time">{time(current)}</span></div><div className={`decision-symbol phase-bg-${framePhase}`}>{framePhase === 'pedestrian_walk' ? <Users size={27}/> : framePhase === 'vehicle_green' ? <TrafficCone size={27}/> : <Clock3 size={27}/>}</div><h2>{phaseName[framePhase]}</h2><p>{frameReason}</p><div className="decision-divider"/><div className="decision-details"><span>РЕЖИМ</span><strong>{frameMode}</strong></div><div className="decision-details"><span>КАМЕРА</span><strong className={frame.healthy ? 'healthy' : 'unhealthy'}>{frame.healthy ? 'Данные доступны' : 'Нет данных'}</strong></div></div><div className="live-metrics"><div><span><TrafficCone size={16}/> В зоне</span><strong>{frame.vehicles ?? '—'} <small>авто</small></strong></div><div><span><Users size={16}/> Ожидают</span><strong>{frame.pedestrians ?? '—'} <small>чел.</small></strong></div>{isVideoScenario && <div><span><Users size={16}/> На дороге</span><strong>{frame.on_road ?? '—'} <small>чел.</small></strong></div>}<div><span><Gauge size={16}/> Поток</span><strong>{frame.flow_per_min ?? '—'} <small>авто/мин</small></strong></div></div><div className="mini-callout"><Sparkles size={18}/><p>{report.recommendation}</p></div></div></div><div className="lower-grid"><Timeline frames={report.frames} current={current} onChange={seekToSecond}/><div className="event-panel"><div className="panel-heading"><div><h3>Модельные события</h3><p>Отметки появляются по мере воспроизведения</p></div><button onClick={() => setPage('logic')}>Все события <ArrowRight size={15}/></button></div><EventList events={displayEvents} current={current} onChange={seekToSecond}/></div></div><div className="bottom-grid"><FlowChart frames={report.frames} current={current}/><div className="summary-panel"><div className="panel-heading"><div><h3>Итог эпизода</h3><p>Наблюдения и модельная оценка</p></div><button onClick={() => setPage('analytics')}>Подробнее <ArrowRight size={15}/></button></div><div className="summary-stats"><Metric icon={TrafficCone} label="Обнаружения авто" value={report.summary.vehicles} unit="авто"/><Metric icon={Users} label="Обнаружения людей" value={report.summary.pedestrians} unit="чел."/><Metric icon={Clock3} label="Модельное ожидание" value={report.summary.mean_wait ?? '—'} unit="с"/></div></div></div></>}
          {page === 'analytics' && <AnalyticsOverview report={report} current={current} onChange={seekToSecond} onSettings={() => setPage('settings')}/> }
          {page === 'logic' && <><div className="logic-overview"><div className="logic-intro"><span className="section-kicker"><Activity size={16}/> КАК ЭТО РАБОТАЕТ</span><h2>Наблюдение → модельный запрос → расчёт фаз</h2><p>Виртуальный контроллер использует текущие и предыдущие CV-наблюдения. Фазы на этой странице рассчитаны моделью, а не измерены на светофоре.</p></div><div className="logic-facts"><div><strong>20 с</strong><span>сглаживание плотности</span></div><div><strong>90 с</strong><span>демонстрационный предел ожидания</span></div><div><strong>0</strong><span>конфликтов фаз в модели</span></div></div></div><div className="logic-steps"><div><span>01</span><Camera size={24}/><h3>Наблюдение</h3><p>{isVideoScenario ? 'Посекундные данные компьютерного зрения о машинах, пешеходах и состоянии камеры.' : 'Демонстрационные данные о машинах, ожидающих людях и состоянии камеры.'}</p></div><div><span>02</span><SlidersHorizontal size={24}/><h3>Оценка условий</h3><p>Плотность машин на участке, уникальные ожидающие люди и время самого раннего запроса.</p></div><div><span>03</span><ShieldCheck size={24}/><h3>Защитный переход</h3><p>После минимального зелёного: жёлтый сигнал и общий красный по плану фаз.</p></div><div><span>04</span><Users size={24}/><h3>Пешеходная фаза</h3><p>Открытый переход и обязательный интервал освобождения перед автомобильным зелёным.</p></div></div><div className="logic-grid"><div className="panel"><div className="panel-heading"><div><h3>Журнал модельных решений</h3><p>Нажмите на событие, чтобы перейти к моменту</p></div><span className="mono">{displayEvents.length} событий</span></div><div className="logic-events">{displayEvents.map((event, i) => <button key={i} className={`logic-event ${current === event.time ? 'selected' : ''}`} onClick={() => seekToSecond(event.time)}><time>{time(event.time)}</time><span className={`event-dot ${event.type}`}/><span>{event.text}</span><ArrowRight size={15}/></button>)}</div></div><div className="logic-side"><div className="panel selected-moment"><span className="section-kicker">ВЫБРАННЫЙ МОМЕНТ · {time(current)}</span><h3>{phaseName[framePhase]}</h3><p>{frameReason}</p><div><span>Поток</span><strong>{frame.flow_per_min ?? 'нет данных'} {frame.flow_per_min !== null && 'авто/мин'}</strong></div><div><span>Ожидают</span><strong>{frame.pedestrians ?? 'нет данных'} {frame.pedestrians !== null && 'чел.'}</strong></div><div><span>Камера</span><strong>{frame.healthy ? 'Данные доступны' : 'Нет данных'}</strong></div><div><span>Режим</span><strong>{frameMode}</strong></div></div><div className="fault-note"><TriangleAlert size={20}/><div><strong>Потеря изображения в модели</strong><p>Модель не считает пропавшие объекты признаком пустой дороги и переходит на резервный цикл. Реальный контроллер к этой записи не подключён.</p></div></div></div></div></>}
          {page === 'settings' && <><div className="settings-layout"><div className="settings-main"><PhaseBuilder draft={draft} onChange={setDraft}/><div className={`panel settings-panel ${draft.control_mode === 'manual' ? 'inactive' : ''}`}><div className="settings-heading"><div><span className="section-kicker"><SlidersHorizontal size={16}/> ПАРАМЕТРЫ УПРАВЛЕНИЯ</span><h2>Адаптивные параметры</h2><p>Применяются только к виртуальному адаптивному контроллеру после пересчёта.</p></div><span className="settings-count">7 параметров</span></div><div className="settings-list">{configMeta.map(item => <div className="setting-row" key={item.key}><div><strong>{item.label}</strong><p>{item.help}</p></div><div className="setting-control"><input type="range" min={item.min} max={item.max} step={item.key === "segment_length_km" ? 0.01 : 1} value={draft[item.key]} disabled={draft.control_mode === 'manual'} onChange={e => setDraft({ ...draft, [item.key]: Number(e.target.value) })} aria-label={item.label}/><span>{draft[item.key]} <small>{item.unit}</small></span></div></div>)}</div><div className="settings-actions"><button className="button primary" onClick={replay}><RotateCcw size={17}/> Сохранить и пересчитать</button><button className="button ghost" onClick={resetSettings}>Сбросить настройки</button></div></div></div><div className="settings-aside"><div className="settings-info"><CircleHelp size={23}/><h3>Что изменится?</h3><p>Виртуальный контроллер повторно обработает ту же запись с выбранными параметрами. Управление реальным светофором не выполняется.</p></div><div className="safety-panel"><ShieldCheck size={22}/><h3>Защитные интервалы модели</h3><p>В модели ручной план не позволяет уменьшить предупреждение ниже 3 с и общий красный ниже 2 с. Для реального объекта времена должны быть рассчитаны и утверждены отдельно.</p><div><span>Минимум пешеходного зелёного</span><strong>8 с</strong></div><div><span>Резервная автофаза модели</span><strong>30 с</strong></div></div></div></div></>}

          <footer className="footer"><span>{isVideoScenario ? 'Запись и данные компьютерного зрения' : 'Демонстрационный интерфейс на тестовых данных'}</span><span>Фазы виртуального контроллера не управляют дорожным оборудованием</span></footer>
        </>}
      </div>
    </main>{toast && <div className="toast" role="status"><Check size={17}/>{toast}</div>}
  </div>
}

export default App
