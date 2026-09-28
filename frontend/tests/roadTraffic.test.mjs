import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Compile the pure motion module in memory; no browser or extra test dependency.
const path = new URL('../src/roadTraffic.ts', import.meta.url)
const source = readFileSync(path, 'utf8')
const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 })
const motion = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const sample = motion.sampleVehicle
const frames = (duration, phase, arrivals) => Array.from({ length: duration + 1 }, (_, time) => ({ time, phase: phase(time), new_vehicles: arrivals(time), new_pedestrians: 0 }))

function bounds(car, progress) {
  const positions = [[progress, 3.4], [-progress, -3.4], [-3.4, progress], [3.4, -progress]]
  return { x: positions[car.lane][0], z: positions[car.lane][1], hx: car.lane < 2 ? 2.25 : 1.17, hz: car.lane < 2 ? 1.17 : 2.25 }
}

test('a queued car remains behind the stop line throughout red', () => {
  const { vehicles } = motion.buildTraffic(frames(25, () => 'all_red_to_ped', t => t === 0 ? 1 : 0))
  for (let t = 0; t <= 25; t += 0.05) assert.ok(sample(vehicles[0], t) <= -17, `car crossed red at ${t.toFixed(2)}s`)
})

test('dense traffic has no intersecting car bodies, including between samples', () => {
  const { vehicles } = motion.buildTraffic(frames(100, t => t % 49 < 30 ? 'vehicle_green' : t % 49 < 33 ? 'warning' : t % 49 < 35 ? 'all_red_to_ped' : t % 49 < 47 ? 'pedestrian_green' : 'all_red_to_vehicle', t => t < 90 ? 3 : 0))
  for (let tick = 0; tick <= 2000; tick++) {
    const t = tick / 20
    const active = vehicles.filter(car => car.born <= t).map(car => bounds(car, sample(car, t))).filter(car => Math.abs(car.x) < 51 && Math.abs(car.z) < 51)
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j]
      assert.ok(Math.abs(a.x-b.x) >= a.hx+b.hx || Math.abs(a.z-b.z) >= a.hz+b.hz, `overlapping cars at ${t}s: ${JSON.stringify([a,b])}`)
    }
  }
})

test('all poles and signal housings lie fully on the sidewalk', () => {
  assert.ok(motion.signalLayout, 'signal positions need a shared explicit layout')
  for (const signal of motion.signalLayout) {
    assert.ok(Math.abs(signal.x) - 0.5 >= 9 && Math.abs(signal.z) - 0.5 >= 9, `signal on road at ${signal.x}, ${signal.z}`)
  }
})

test('long vehicle phases serve both roads without conflicting green signals', () => {
  const timeline = frames(80, () => 'vehicle_green', t => t === 0 ? 4 : 0)
  const { vehicles, signals } = motion.buildTraffic(timeline)
  assert.ok(signals.every(colors => colors.filter(color => color === 'green').length <= 1))
  assert.ok(vehicles.every(car => sample(car, 80) > 50), 'each approach must get a turn')
})

test('cars clear every zebra before the pedestrian phase begins', () => {
  const timeline = frames(48, t => t < 30 ? 'vehicle_green' : t < 33 ? 'warning' : t < 35 ? 'all_red_to_ped' : 'pedestrian_green', () => 3)
  const { vehicles } = motion.buildTraffic(timeline)
  for (let tick = 700; tick <= 960; tick++) {
    const time = tick / 20
    for (const car of vehicles.filter(car => car.born <= time)) {
      const progress = sample(car, time)
      assert.ok(progress <= -17 || progress >= 17, `car still on a crossing at ${time}s`)
    }
  }
})

test('each zebra carries pedestrians in both directions with a signal at each destination', () => {
  assert.equal(motion.pedestrianRoutes.length, 8)
  const heads = motion.signalLayout.filter(signal => signal.kind === 'pedestrian')
  assert.equal(heads.length, 8)
  for (let i = 0; i < 8; i += 2) {
    const outward = motion.pedestrianRoutes[i]
    const returning = motion.pedestrianRoutes[i + 1]
    assert.ok(Math.abs(outward.startX - returning.endX) < 2 && Math.abs(outward.startZ - returning.endZ) < 2)
    assert.ok(Math.abs(outward.endX - returning.startX) < 2 && Math.abs(outward.endZ - returning.startZ) < 2)
    assert.notEqual(outward.rotation, returning.rotation)
    for (const route of [outward, returning]) {
      assert.ok(heads.some(head => head.x === route.signalX && head.z === route.signalZ && head.rotation === route.rotation))
    }
  }
  const episode = frames(16, t => t >= 5 ? 'pedestrian_green' : 'vehicle_green', () => 0)
  episode[0].new_pedestrians = 8
  const { walkers } = motion.buildTraffic(episode)
  assert.deepEqual(walkers.map(walker => walker.route), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.ok(walkers.every(walker => walker.start >= 5 && walker.start <= 7))
  assert.equal(walkers[0].start, walkers[1].start)
  const leftLane = motion.pedestrianRoutes[0]
  const rightLane = motion.pedestrianRoutes[1]
  assert.ok(Math.hypot((leftLane.startX + leftLane.endX) / 2 - (rightLane.startX + rightLane.endX) / 2,
    (leftLane.startZ + leftLane.endZ) / 2 - (rightLane.startZ + rightLane.endZ) / 2) > 1.5)
})

test('queued pedestrians start far enough apart and finish before red', () => {
  const episode = frames(32, t => t >= 5 && t < 13 || t >= 23 ? 'pedestrian_green' : 'vehicle_green', () => 0)
  episode[0].new_pedestrians = 64
  const { walkers } = motion.buildTraffic(episode)
  const starts = walkers.filter(walker => walker.route === 0).map(walker => walker.start)
  assert.equal(starts.length, 8)
  assert.ok(starts.some(start => start >= 23))
  assert.ok(starts.every(Number.isFinite))
  assert.ok(starts.slice(1).every((start, index) => start - starts[index] >= 0.7))
  assert.ok(starts.every(start => start + 5.5 <= 13 || start >= 23 && start + 5.5 <= 33))
})

test('cars see amber before red and red plus amber before green', () => {
  const continuous = motion.buildSignalPlan(frames(24, () => 'vehicle_green', () => 0))
  assert.deepEqual(continuous[11], ['green', 'red'])
  assert.deepEqual(continuous[12], ['amber', 'red'])
  assert.deepEqual(continuous[15], ['red', 'red'])
  assert.deepEqual(continuous[18], ['red', 'red_amber'])
  assert.deepEqual(continuous[19], ['red', 'red_amber'])
  assert.deepEqual(continuous[20], ['red', 'green'])
  const afterPedestrians = motion.buildSignalPlan(frames(33, t => t < 12 ? 'vehicle_green' : t < 15 ? 'warning' : t < 17 ? 'all_red_to_ped' : t < 29 ? 'pedestrian_green' : t < 31 ? 'all_red_to_vehicle' : 'vehicle_green', () => 0))
  assert.deepEqual(afterPedestrians[29], ['red', 'red_amber'])
  assert.deepEqual(afterPedestrians[30], ['red', 'red_amber'])
  assert.deepEqual(afterPedestrians[31], ['red', 'green'])
})
