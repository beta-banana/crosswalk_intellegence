import type { Frame } from './types'

export type Axis = 0 | 1 // West–east, north–south.
export type SignalColor = 'red' | 'red_amber' | 'amber' | 'green'
export type VehicleSignals = [SignalColor, SignalColor]
export type Vehicle = { lane: number; born: number; positions: number[] }
type Walker = { route: number; born: number; start: number }
type MotionFrame = Pick<Frame, 'time' | 'phase' | 'new_vehicles' | 'new_pedestrians'>

export const ROAD_HALF_WIDTH = 8.5
export const STOP_LINE = 15.2
const CAR_HALF_LENGTH = 2.25
const STOP_POSITION = -STOP_LINE - CAR_HALF_LENGTH - 0.5
const SPEED = 8.5
const HEADWAY = 6.6
const SAMPLES_PER_SECOND = 10
const GREEN_SECONDS = 12
const AMBER_SECONDS = 3
// Enough time to clear the far zebra, including the car's rear bumper.
const CLEARANCE_SECONDS = 5

// Each zebra has two separated walking lanes. A head at each destination
// looks back toward the people waiting on the opposite pavement.
export const pedestrianRoutes = [
  { axis: 0, startX: -12.65, startZ: -9.5, endX: -12.65, endZ: 9.5, signalX: -14.8, signalZ: 10.5, rotation: Math.PI },
  { axis: 0, startX: -10.95, startZ: 9.5, endX: -10.95, endZ: -9.5, signalX: -14.8, signalZ: -10.5, rotation: 0 },
  { axis: 0, startX: 10.95, startZ: 9.5, endX: 10.95, endZ: -9.5, signalX: 14.8, signalZ: -10.5, rotation: 0 },
  { axis: 0, startX: 12.65, startZ: -9.5, endX: 12.65, endZ: 9.5, signalX: 14.8, signalZ: 10.5, rotation: Math.PI },
  { axis: 1, startX: -9.5, startZ: -12.65, endX: 9.5, endZ: -12.65, signalX: 10.5, signalZ: -14.8, rotation: -Math.PI / 2 },
  { axis: 1, startX: 9.5, startZ: -10.95, endX: -9.5, endZ: -10.95, signalX: -10.5, signalZ: -14.8, rotation: Math.PI / 2 },
  { axis: 1, startX: 9.5, startZ: 12.65, endX: -9.5, endZ: 12.65, signalX: -10.5, signalZ: 14.8, rotation: Math.PI / 2 },
  { axis: 1, startX: -9.5, startZ: 10.95, endX: 9.5, endZ: 10.95, signalX: 10.5, signalZ: 14.8, rotation: -Math.PI / 2 },
] as const

export const signalLayout: { kind: 'vehicle' | 'pedestrian'; axis: Axis; x: number; z: number; rotation: number }[] = [
  { kind: 'vehicle', axis: 0, x: -16.5, z: 10.5, rotation: -Math.PI / 2 },
  { kind: 'vehicle', axis: 0, x: 16.5, z: -10.5, rotation: Math.PI / 2 },
  { kind: 'vehicle', axis: 1, x: -10.5, z: -16.5, rotation: Math.PI },
  { kind: 'vehicle', axis: 1, x: 10.5, z: 16.5, rotation: 0 },
  ...pedestrianRoutes.map(route => ({ kind: 'pedestrian' as const, axis: route.axis, x: route.signalX, z: route.signalZ, rotation: route.rotation })),
]

/** Divide the controller's vehicle window between conflicting road directions. */
export function buildSignalPlan(frames: MotionFrame[]): VehicleSignals[] {
  let start = 0
  let startAxis: Axis = 0
  let lastAxis: Axis = 1
  let warningAxis: Axis | null = null
  const plan: VehicleSignals[] = []
  for (const [index, frame] of frames.entries()) {
    const colors: VehicleSignals = ['red', 'red']
    if (frame.phase === 'vehicle_green') {
      if (frames[index - 1]?.phase !== 'vehicle_green') {
        start = frame.time
        startAxis = lastAxis === 0 ? 1 : 0
      }
      const cycle = GREEN_SECONDS + AMBER_SECONDS + CLEARANCE_SECONDS
      const elapsed = frame.time - start
      const axis = ((startAxis + Math.floor(elapsed / cycle)) % 2) as Axis
      const within = elapsed % cycle
      if (within < GREEN_SECONDS + AMBER_SECONDS) {
        colors[axis] = within < GREEN_SECONDS ? 'green' : 'amber'
        lastAxis = axis
      }
    } else if (frame.phase === 'warning') {
      if (frames[index - 1]?.phase !== 'warning') {
        warningAxis = plan[index - 1]?.[lastAxis] !== 'red' ? lastAxis : null
      }
      if (warningAxis !== null) colors[warningAxis] = 'amber'
    }
    plan.push(colors)
  }
  // During the last two seconds before a green, red and amber illuminate
  // together. Vehicles continue to wait until green is actually shown.
  for (let index = 1; index < plan.length; index++) {
    for (const axis of [0, 1] as const) {
      if (plan[index][axis] !== 'green' || plan[index - 1][axis] === 'green') continue
      for (let before = Math.max(0, index - 2); before < index; before++) {
        if (plan[before][axis] === 'red'
          && (frames[before].phase === 'vehicle_green' || frames[before].phase === 'all_red_to_vehicle')) {
          plan[before][axis] = 'red_amber'
        }
      }
    }
  }
  return plan
}

export function buildTraffic(frames: MotionFrame[]) {
  const vehicles: Vehicle[] = []
  const walkers: Walker[] = []
  const signals = buildSignalPlan(frames)
  for (const frame of frames) {
    for (let i = 0; i < (frame.new_vehicles ?? 0); i++) vehicles.push({ lane: vehicles.length % 4, born: frame.time, positions: [] })
    for (let i = 0; i < (frame.new_pedestrians ?? 0); i++) walkers.push({ route: walkers.length % pedestrianRoutes.length, born: frame.time, start: Infinity })
  }
  const lanes: Vehicle[][] = [[], [], [], []]
  vehicles.forEach(car => lanes[car.lane].push(car))
  const end = (frames.length - 1) * SAMPLES_PER_SECOND
  for (let tick = 0; tick <= end; tick++) {
    const time = tick / SAMPLES_PER_SECOND
    // Use the signal at the start of this motion interval, so interpolation
    // cannot move a waiting car before its green actually starts.
    const colors = signals[Math.floor(Math.max(0, tick - 1) / SAMPLES_PER_SECOND)]
    for (const [laneIndex, lane] of lanes.entries()) {
      let front = Infinity
      for (const car of lane) {
        if (time < car.born) { car.positions.push(-48); continue }
        const previous = car.positions[tick - 1] ?? -48
        let next = time === car.born ? -48 : previous + SPEED / SAMPLES_PER_SECOND
        if (colors[Math.floor(laneIndex / 2)] !== 'green' && previous <= STOP_POSITION + 1e-6) {
          next = Math.min(next, STOP_POSITION)
        }
        next = Math.min(next, front - HEADWAY)
        car.positions.push(next)
        front = next
      }
    }
  }
  const greenWindows: { start: number; end: number }[] = []
  for (const frame of frames) {
    const last = greenWindows[greenWindows.length - 1]
    if (frame.phase === 'pedestrian_green') {
      if (last?.end === frame.time) last.end = frame.time + 1
      else greenWindows.push({ start: frame.time, end: frame.time + 1 })
    }
  }
  const nextStart = Array<number>(pedestrianRoutes.length).fill(-Infinity)
  for (const walker of walkers) {
    // Keep people on the same walking lane apart. Wait for the next green if
    // less than 5.5 seconds remain in this one.
    for (const window of greenWindows) {
      const candidate = Math.max(walker.born, window.start, nextStart[walker.route])
      if (candidate + 5.5 > window.end + 1e-6) continue
      walker.start = candidate
      nextStart[walker.route] = candidate + 0.8
      break
    }
  }
  return { vehicles, walkers, signals }
}

export function sampleVehicle(car: Vehicle, time: number): number {
  const position = Math.max(0, Math.min(car.positions.length - 1, time * SAMPLES_PER_SECOND))
  const first = Math.floor(position)
  const base = car.positions[first]
  return base + ((car.positions[first + 1] ?? base) - base) * (position - first)
}
