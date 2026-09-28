import type { Frame, PedestrianGroup } from './types'

export type SignalColor = 'red' | 'red_amber' | 'amber' | 'green'
export type Vehicle = { lane: number; born: number; positions: number[] }
export type Walker = {
  route: number
  born: number
  start: number
  waitX: number
  waitZ: number
  crossX: number
  approachDuration: number
  crossDuration: number
  duration: number
  gaitPhase: number
}
type MotionFrame = Pick<Frame, 'time' | 'phase' | 'new_vehicles' | 'new_pedestrians' | 'pedestrian_groups'>

export const ROAD_HALF_WIDTH = 9
export const STOP_LINE = 8.5
export const streetLampXs = [-46, -32, -18, 18, 32, 46] as const
// Two marked lanes in each direction. The dashed lane dividers are at z = ±4.4.
export const vehicleLanes = [
  { direction: 1, z: 2.25 },
  { direction: -1, z: -2.25 },
  { direction: 1, z: 6.65 },
  { direction: -1, z: -6.65 },
] as const
// direction is the direction of travel along X; side is the road half along Z.
// All fixtures are placed before the zebra as seen by an approaching driver.
export const roadApproaches = ([1, -1] as const).map((direction, lane) => ({
  lane,
  direction,
  side: direction,
  stopX: -direction * STOP_LINE,
  signX: -direction * 10.7,
  signZ: direction * 10.8,
  overheadX: -direction * 6,
  signRotation: -direction * Math.PI / 2,
}))
// The two cameras share the overhead sign masts and cover the opposite bank.
export const cameraMounts = roadApproaches.map(approach => ({
  x: approach.overheadX,
  y: 5.28,
  z: approach.side * 4.75,
  targetX: 0,
  targetY: 0.35,
  targetZ: -approach.side * 10.4,
}))
const CAR_HALF_LENGTH = 2.25
const STOP_POSITION = -STOP_LINE - CAR_HALF_LENGTH - 0.5
const SPEED = 5.6
const HEADWAY = 6.6
const SAMPLES_PER_SECOND = 10

// One crossing: walkers use separate sides while moving in opposite directions.
export const pedestrianRoutes = [
  { startX: -1.15, startZ: -10.2, endX: -1.15, endZ: 10.2, signalX: -3.6, signalZ: 10.1, rotation: Math.PI },
  { startX: 1.15, startZ: 10.2, endX: 1.15, endZ: -10.2, signalX: 3.6, signalZ: -10.1, rotation: 0 },
] as const

function variation(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453
  return value - Math.floor(value)
}

export function sampleWalkerPosition(walker: Walker, time: number): { x: number; z: number } {
  const route = pedestrianRoutes[walker.route]
  if (time <= walker.start) return { x: walker.waitX, z: walker.waitZ }
  const age = time - walker.start
  if (age < walker.approachDuration) {
    const amount = age / walker.approachDuration
    return {
      x: walker.waitX + (walker.crossX - walker.waitX) * amount,
      z: walker.waitZ + (route.startZ - walker.waitZ) * amount,
    }
  }
  const amount = Math.min(1, (age - walker.approachDuration) / walker.crossDuration)
  return {
    x: walker.crossX,
    z: route.startZ + (route.endZ - route.startZ) * amount,
  }
}

export const signalLayout: { kind: 'vehicle' | 'pedestrian'; x: number; z: number; rotation: number }[] = [
  { kind: 'vehicle', x: -7.3, z: 10.5, rotation: -Math.PI / 2 },
  { kind: 'vehicle', x: 7.3, z: -10.5, rotation: Math.PI / 2 },
  ...pedestrianRoutes.map(route => ({ kind: 'pedestrian' as const, x: route.signalX, z: route.signalZ, rotation: route.rotation })),
]

/** All four lanes share one vehicle phase. */
export function buildSignalPlan(frames: MotionFrame[]): SignalColor[] {
  return frames.map(frame => {
    if (frame.phase === 'vehicle_green') return 'green'
    if (frame.phase === 'vehicle_yellow') return 'amber'
    return 'red'
  })
}

export function buildTraffic(frames: MotionFrame[]) {
  const vehicles: Vehicle[] = []
  const walkers: Walker[] = []
  const cohorts: Walker[][] = []
  const waitingCounts = [0, 0]
  const signals = buildSignalPlan(frames)
  for (const frame of frames) {
    const arrivals = frame.new_vehicles ?? 0
    for (let i = 0; i < arrivals; i++) {
      // Spread arrivals counted in one frame across its preceding second.
      const born = Math.max(0, frame.time - (arrivals - 1 - i) / arrivals)
      vehicles.push({ lane: vehicles.length % vehicleLanes.length, born, positions: [] })
    }
    const declaredGroups = frame.pedestrian_groups
    const groups: PedestrianGroup[] = declaredGroups?.length ? declaredGroups
      : Array.from({ length: frame.new_pedestrians ?? 0 }, (_, i) =>
          ({ count: 1, side: (walkers.length + i) % 2 === 0 ? 'south' : 'north' }))
    for (const group of groups) {
      const routeIndex = group.side === 'south' ? 0 : 1
      const route = pedestrianRoutes[routeIndex]
      const cohort: Walker[] = []
      for (let i = 0; i < group.count; i++) {
        const rank = waitingCounts[routeIndex]++
        const crossX = group.count > 1
          ? (i - (group.count - 1) / 2) * Math.min(0.68, 5.2 / Math.max(1, group.count - 1))
            + (variation(rank, 5) - 0.5) * 0.14
          : -2.45 + (rank % 8) * 0.7 + (variation(rank, routeIndex + 5) - 0.5) * 0.14
        // People wait at different depths, then take straight paths across the road.
        const depth = group.count > 1
          ? 1.3 + variation(rank, routeIndex + 6) * 2.1
          : 1.3 + Math.floor(rank / 8) * 0.75 + variation(rank, routeIndex + 6) * 0.18
        const waitZ = route.startZ + Math.sign(route.startZ) * depth
        const approachDuration = 0.55 + 0.12 * depth
        const duration = 6.6 + variation(rank, routeIndex + 7) * 0.9
        const crossDuration = duration - approachDuration
        const walker = { route: routeIndex, born: frame.time, start: Infinity,
          waitX: crossX, waitZ, crossX, approachDuration, crossDuration, duration,
          gaitPhase: variation(rank, routeIndex + 9) * Math.PI * 2 }
        cohort.push(walker)
        walkers.push(walker)
      }
      cohorts.push(cohort)
    }
  }
  const lanes: Vehicle[][] = vehicleLanes.map(() => [])
  vehicles.forEach(car => lanes[car.lane].push(car))
  const end = (frames.length - 1) * SAMPLES_PER_SECOND
  for (let tick = 0; tick <= end; tick++) {
    const time = tick / SAMPLES_PER_SECOND
    const color = signals[Math.floor(Math.max(0, tick - 1) / SAMPLES_PER_SECOND)]
    for (const lane of lanes) {
      let front = Infinity
      for (const car of lane) {
        if (time < car.born) { car.positions.push(-48); continue }
        const previous = car.positions[tick - 1] ?? -48
        let next = tick === 0 || time - 1 / SAMPLES_PER_SECOND < car.born ? -48 : previous + SPEED / SAMPLES_PER_SECOND
        if (color !== 'green' && previous <= STOP_POSITION + 1e-6) next = Math.min(next, STOP_POSITION)
        next = Math.min(next, front - HEADWAY)
        car.positions.push(next)
        front = next
      }
    }
  }
  const greenWindows: { start: number; end: number; clearEnd: number }[] = []
  for (const frame of frames) {
    const last = greenWindows[greenWindows.length - 1]
    if (frame.phase === 'pedestrian_walk') {
      if (last?.end === frame.time) last.end = last.clearEnd = frame.time + 1
      else greenWindows.push({ start: frame.time, end: frame.time + 1, clearEnd: frame.time + 1 })
    } else if (frame.phase === 'pedestrian_clearance' && last?.clearEnd === frame.time) {
      last.clearEnd = frame.time + 1
    }
  }
  const nextStart = Array<number>(pedestrianRoutes.length).fill(-Infinity)
  for (const [cohortIndex, cohort] of cohorts.entries()) {
    const routeIndex = cohort[0]?.route
    if (routeIndex === undefined) continue
    for (const window of greenWindows) {
      const firstStart = Math.max(cohort[0].born, window.start + 0.05,
        nextStart[routeIndex])
      const starts = cohort.map((_, index) => firstStart + index * 0.19
        + variation(cohortIndex + index, 11) * 0.12)
      if (cohort.some((walker, index) => starts[index] >= window.end
        || starts[index] + walker.duration > window.clearEnd + 1e-6)) continue
      cohort.forEach((walker, index) => { walker.start = starts[index] })
      nextStart[routeIndex] = starts[starts.length - 1] + 0.25
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
