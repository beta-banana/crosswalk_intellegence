import { Activity, Users } from 'lucide-react'
import type { Config, Frame } from './types'
import { singlePedestrianProjection } from './pedestrianWeight'

const number = (value: number, digits = 1) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits })

export default function PedestrianWeightPanel({ frame, config }: { frame: Frame; config: Config }) {
  const hasData = frame.data_quality === 'ok' && frame.k !== null
  const current = hasData ? singlePedestrianProjection(frame.k!, config.k_ref, config.t_max_s) : null
  const examples = [0, 1, 3].map(ratio => ({
    ratio,
    density: ratio * config.k_ref,
    ...singlePedestrianProjection(ratio * config.k_ref, config.k_ref, config.t_max_s),
  }))

  return <section className="sim-weight-panel" aria-label="Вес одного пешехода">
    <div className="sim-section-title"><h2><Users size={18}/> Вес одного пешехода</h2><span>По алгоритму адаптивного управления</span></div>
    <p className="sim-weight-intro">Плотность <strong>k</strong> — среднее число машин на контрольном участке за окно наблюдения, делённое на его длину. Вес = 1 / (1 + k / k<sub>ref</sub>).</p>
    <div className="sim-weight-live">
      <div><span>Один человек, без других ожидающих</span><strong>{current ? number(current.weight, 2) : '—'}</strong><small>его вес при текущей плотности</small></div>
      <div><span>До запроса фазы</span><strong>{current ? `${number(current.requestAfterSeconds)} с` : '—'}</strong><small>при неизменной плотности и ожидании с нуля</small></div>
      <div><span>Плотность на участке</span><strong>{hasData ? `${number(frame.k!)} авто/км` : '—'}</strong><small>{hasData ? `≈ ${number(frame.k! * config.segment_length_km)} авто одновременно · поток ${frame.flow_per_min ?? '—'} авто/мин` : 'Данные камеры недоступны'}</small></div>
    </div>
    <div className="sim-weight-examples" aria-label="Примеры влияния плотности машин">
      {examples.map(example => <div className="sim-weight-example" key={example.ratio}>
        <div className="sim-weight-example-top"><strong>{example.ratio === 0 ? 'Пустой участок' : example.ratio === 1 ? 'Опорная плотность' : 'Высокая плотность'}</strong><span>k / k<sub>ref</sub> = {example.ratio}</span></div>
        <div className="sim-weight-bar"><span style={{ width: `${example.weight * 100}%` }}/></div>
        <div className="sim-weight-example-values"><span>Вес <strong>{number(example.weight, 2)}</strong></span><span>Запрос через <strong>{number(example.requestAfterSeconds)} с</strong></span></div>
        <small>≈ {number(example.density * config.segment_length_km)} авто на участке длиной {number(config.segment_length_km, 2)} км</small>
      </div>)}
    </div>
    <p className="sim-weight-foot"><Activity size={16}/> Порог запроса: вес + ожидание / {number(config.t_max_s, 0)} с ≥ 1. После запроса контроллер соблюдает минимум зелёного для машин, жёлтый и общий красный; зелёный для пешеходов включается позже. Поток авто/мин показан для контекста, в формулу входит плотность.</p>
    {config.control_mode === 'manual' && <p className="sim-weight-note">В ручном плане вес показан для сравнения и не меняет длительность фаз.</p>}
    {!hasData && <p className="sim-weight-note">При потере данных адаптивный расчёт приостановлен, работает резервный цикл.</p>}
  </section>
}
