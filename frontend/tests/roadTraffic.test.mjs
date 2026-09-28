import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/roadTraffic.ts', import.meta.url), 'utf8')
const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 })
const motion = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const frames = (duration, phase, arrivals = () => 0) => Array.from({ length: duration + 1 }, (_, time) => ({ time, phase: phase(time), new_vehicles: arrivals(time), new_pedestrians: 0 }))

const carBounds = (car, time) => ({
  x: motion.vehicleLanes[car.lane].direction * motion.sampleVehicle(car, time),
  z: motion.vehicleLanes[car.lane].z,
})

test('walkers may finish during clearance but never enter during clearance', () => {
  const episode = frames(23, t => t < 5 ? 'vehicle_green' : t < 13 ? 'pedestrian_walk' : t < 19 ? 'pedestrian_clearance' : 'all_red_to_vehicle')
  episode[0].new_pedestrians = 12
  const { walkers } = motion.buildTraffic(episode)
  assert.ok(walkers.some(person => person.start + person.duration > 13))
  assert.ok(walkers.every(person => person.start < 13 && person.start + person.duration <= 19))
})

test('one arriving group crosses together from its own bank in straight paths', () => {
  const episode = frames(35, t => t < 15 ? 'vehicle_green' : t < 23 ? 'pedestrian_walk' : t < 29 ? 'pedestrian_clearance' : 'vehicle_green')
  episode[8].new_pedestrians = 9
  episode[8].pedestrian_groups = [{ count: 9, side: 'south' }]
  const { walkers } = motion.buildTraffic(episode)
  assert.equal(walkers.length, 9)
  assert.ok(walkers.every(walker => walker.route === 0))
  assert.ok(walkers.every(walker => Number.isFinite(walker.start) && walker.start < 23 && walker.start + walker.duration <= 29))
  assert.ok(Math.max(...walkers.map(walker => walker.start)) - Math.min(...walkers.map(walker => walker.start)) < 3)
  for (const walker of walkers) {
    const atCurb = motion.sampleWalkerPosition(walker, walker.start + walker.approachDuration)
    const midRoad = motion.sampleWalkerPosition(walker, walker.start + walker.approachDuration + walker.crossDuration / 2)
    const otherCurb = motion.sampleWalkerPosition(walker, walker.start + walker.duration)
    assert.ok(Math.abs(atCurb.x - midRoad.x) < 0.01)
    assert.ok(Math.abs(midRoad.x - otherCurb.x) < 0.01)
  }
})

test('cars follow the centers of four marked lanes on one straight road', () => {
  const episode = frames(16, () => 'vehicle_green', time => time === 0 ? 4 : 0)
  episode[0].new_pedestrians = 4
  const { vehicles, walkers } = motion.buildTraffic(episode)
  assert.deepEqual(vehicles.map(car => car.lane), [0, 1, 2, 3])
  assert.deepEqual(motion.vehicleLanes.map(lane => lane.direction), [1, -1, 1, -1])
  assert.deepEqual(motion.vehicleLanes.map(lane => lane.z), [2.25, -2.25, 6.65, -6.65])
  assert.deepEqual(walkers.map(walker => walker.route), [0, 1, 0, 1])
  assert.equal(motion.pedestrianRoutes.length, 2)
  assert.ok(motion.pedestrianRoutes.every(route => Math.abs(route.startX) < 3 && Math.abs(route.endX) < 3))
  assert.ok(motion.pedestrianRoutes.every(route => route.startZ * route.endZ < 0))
})

test('both directions share one vehicle signal through the pedestrian cycle', () => {
  const colors = motion.buildSignalPlan(frames(22, t => t < 8 ? 'vehicle_green' : t < 11 ? 'vehicle_yellow' : t < 13 ? 'all_red_to_pedestrian' : t < 17 ? 'pedestrian_walk' : t < 20 ? 'all_red_to_vehicle' : 'vehicle_green'))
  assert.equal(colors[3], 'green')
  assert.equal(colors[9], 'amber')
  assert.equal(colors[14], 'red')
  assert.equal(colors[19], 'red')
  assert.ok(motion.signalLayout.filter(signal => signal.kind === 'vehicle').length >= 2)
})

test('cars wait before the sole crossing during red and keep safe spacing', () => {
  const episode = frames(25, () => 'all_red_to_pedestrian', time => time < 5 ? 2 : 0)
  const { vehicles } = motion.buildTraffic(episode)
  for (let time = 0; time <= 25; time += 0.05) {
    for (const car of vehicles.filter(item => item.born <= time)) {
      assert.ok(motion.sampleVehicle(car, time) <= -8.5, `car crossed red at ${time}`)
    }
    for (let lane = 0; lane < motion.vehicleLanes.length; lane++) {
      const active = vehicles.filter(car => car.lane === lane && car.born <= time)
      for (let i = 1; i < active.length; i++) {
        const front = carBounds(active[i - 1], time)
        const rear = carBounds(active[i], time)
        assert.ok(Math.abs(front.x - rear.x) >= 4.6, `cars overlap at ${time}`)
      }
    }
  }
})

test('the last car clears the crossing before pedestrians receive green', () => {
  const episode = frames(40, t => t < 24 ? 'vehicle_green' : t < 27 ? 'vehicle_yellow' : t < 29 ? 'all_red_to_pedestrian' : 'pedestrian_walk', time => time < 8 ? 2 : 0)
  const { vehicles } = motion.buildTraffic(episode)
  for (let time = 29; time <= 40; time += 0.1) {
    for (const car of vehicles.filter(item => item.born <= time)) {
      const progress = motion.sampleVehicle(car, time)
      assert.ok(progress <= -8.5 || progress >= 8.5, `car still on crossing at ${time}`)
    }
  }
})

test('opposing walkers use one zebra and only start when green lasts long enough', () => {
  const episode = frames(42, t => t >= 5 && t < 18 || t >= 26 ? 'pedestrian_walk' : 'vehicle_green')
  episode[0].new_pedestrians = 16
  const { walkers } = motion.buildTraffic(episode)
  assert.ok(walkers.every(walker => walker.start >= 5 && Number.isFinite(walker.start)))
  assert.ok(walkers.every(walker => walker.start + walker.duration <= 18 || walker.start >= 26 && walker.start + walker.duration <= 43))
  assert.ok(new Set(walkers.map(walker => walker.waitX.toFixed(2))).size >= 12)
  assert.ok(new Set(walkers.map(walker => walker.waitZ.toFixed(2))).size >= 12)
  assert.ok(new Set(walkers.map(walker => walker.duration.toFixed(2))).size >= 12)
  assert.ok(walkers.every(walker => Math.abs(walker.waitZ) > 10.2 && Math.abs(walker.waitZ) < 13.9))
  assert.ok(walkers.every(walker => Math.abs(walker.crossX) < 3.35))
  for (const route of [0, 1]) {
    const waiting = walkers.filter(walker => walker.route === route)
    for (let i = 0; i < waiting.length; i++) for (let j = i + 1; j < waiting.length; j++) {
      assert.ok(Math.hypot(waiting[i].waitX - waiting[j].waitX, waiting[i].waitZ - waiting[j].waitZ) >= 0.48)
    }
  }
  for (const walker of walkers) {
    const waiting = motion.sampleWalkerPosition(walker, walker.start - 0.01)
    const starting = motion.sampleWalkerPosition(walker, walker.start)
    assert.ok(Math.hypot(waiting.x - starting.x, waiting.z - starting.z) < 0.01, 'pedestrian jumps from queue to crossing')
    const end = motion.sampleWalkerPosition(walker, walker.start + walker.duration)
    assert.ok(Math.abs(end.z) > 10, 'pedestrian did not reach the opposite pavement')
  }
})

test('walkers can still cross during the shortest allowed pedestrian green', () => {
  const episode = frames(80, time => time % 15 >= 5 && time % 15 < 13 ? 'pedestrian_walk' : 'vehicle_green')
  episode[0].new_pedestrians = 8
  const { walkers } = motion.buildTraffic(episode)
  assert.ok(walkers.every(walker => Number.isFinite(walker.start)))
  for (const walker of walkers) {
    const greenStart = Math.floor(walker.start / 15) * 15 + 5
    assert.ok(walker.start >= greenStart && walker.start + walker.duration <= greenStart + 8)
  }
})

test('signs face incoming cars and stop lines precede the crossing on both approaches', () => {
  const approaches = motion.roadApproaches
  assert.equal(approaches.length, 2)
  for (const approach of approaches) {
    const towardsCrossing = approach.direction
    // The painted zebra starts near x = ±3.65; roadside and overhead signs
    // must be seen before a driver reaches it.
    assert.ok(towardsCrossing * approach.signX < -3.65)
    assert.ok(towardsCrossing * approach.overheadX < -3.65)
    assert.ok(towardsCrossing * approach.signX < towardsCrossing * approach.stopX)
    assert.ok(Math.abs(Math.sin(approach.signRotation) + towardsCrossing) < 1e-6)
    assert.ok(approach.side * towardsCrossing > 0)
    const vehicleSignal = motion.signalLayout.find(signal => signal.kind === 'vehicle' && signal.z * approach.side > 0)
    assert.ok(towardsCrossing * approach.signX < towardsCrossing * vehicleSignal.x - 2, 'roadside sign must precede the traffic light')
    assert.ok(Math.abs(approach.signZ - vehicleSignal.z) < 0.6, 'roadside sign must stand in front of the traffic light, not beside it')
    assert.ok(Math.abs(approach.signZ) < 13.9, 'roadside sign must remain on the pavement')
  }
  const { vehicles } = motion.buildTraffic(frames(25, () => 'all_red_to_pedestrian', time => time === 0 ? 2 : 0))
  for (const car of vehicles) {
    const approach = approaches[car.lane % approaches.length]
    const frontX = approach.direction * (motion.sampleVehicle(car, 25) + 2.25)
    assert.ok(approach.direction * (approach.stopX - frontX) >= 0.49)
  }
})

test('street lamps line both pavements without crowding crossing signs', () => {
  assert.deepEqual(motion.streetLampXs, [-46, -32, -18, 18, 32, 46])
  assert.ok(motion.streetLampXs.every(x => Math.abs(x) >= 10))
  assert.ok(motion.streetLampXs.every(x => motion.roadApproaches.every(approach => Math.abs(x - approach.signX) >= 5)))
})

test('dense arrivals are staggered within each second and keep the road occupied', () => {
  let balance = 0
  const episode = frames(40, () => 'vehicle_green', time => {
    if (!time) return 0
    balance += 97 / 60
    const count = Math.floor(balance)
    balance -= count
    return count
  })
  const { vehicles } = motion.buildTraffic(episode)
  assert.equal(vehicles.length, Math.floor(40 * 97 / 60))
  assert.ok(vehicles.some(car => !Number.isInteger(car.born)))
  const visible = vehicles.filter(car => car.born <= 20 && motion.sampleVehicle(car, 20) >= -50 && motion.sampleVehicle(car, 20) <= 50)
  assert.ok(visible.length >= 24, `only ${visible.length} cars are visible at 97 per minute`)
  assert.equal(new Set(visible.map(car => car.lane)).size, 4)
})

test('four-lane rush flow still clears the crossing before pedestrian green', () => {
  let balance = 0
  const episode = frames(55, time => time < 30 ? 'vehicle_green' : time < 33 ? 'vehicle_yellow' : time < 35 ? 'all_red_to_pedestrian' : 'pedestrian_walk', time => {
    if (!time) return 0
    balance += 97 / 60
    const count = Math.floor(balance)
    balance -= count
    return count
  })
  const { vehicles } = motion.buildTraffic(episode)
  for (let time = 35; time <= 55; time += 0.1) {
    for (const car of vehicles.filter(item => item.born <= time)) {
      const progress = motion.sampleVehicle(car, time)
      assert.ok(progress <= -8.5 || progress >= 8.5, `car on crossing at ${time}`)
    }
  }
})

test('two cameras hang from the crossing sign masts and look toward opposite pavements', () => {
  const mounts = motion.cameraMounts
  assert.equal(mounts.length, 2)
  for (const [index, camera] of mounts.entries()) {
    const approach = motion.roadApproaches[index]
    assert.equal(camera.x, approach.overheadX)
    assert.ok(camera.y > 4)
    assert.ok(camera.z * approach.side > 0)
    assert.ok(camera.targetZ * approach.side < -9)
    assert.ok(Math.abs(camera.targetX) < 3.65)
  }
})
