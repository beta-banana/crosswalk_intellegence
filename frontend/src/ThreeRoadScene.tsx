import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Frame, Phase, TrafficProfile } from './types'
import { buildTraffic, pedestrianRoutes, sampleVehicle, signalLayout, ROAD_HALF_WIDTH, STOP_LINE } from './roadTraffic'
import type { Axis, VehicleSignals } from './roadTraffic'

type Signals = { axis: Axis; pedestrian: boolean; lights: THREE.Mesh[] }
type SceneState = {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  ambient: THREE.AmbientLight
  sun: THREE.DirectionalLight
  lamps: Signals[]
  carMeshes: THREE.Group[]
  personMeshes: THREE.Group[]
  dispose: () => void
}

const carColors = [0xe6ad62, 0x73a9a2, 0xe2816e, 0x8f9bc4, 0xd7d6ca, 0x66a0bf]
const coatColors = [0xe9b362, 0x4a94a3, 0xe47f70, 0x7467ab, 0x5a8f70]
const asphalt = new THREE.MeshStandardMaterial({ color: 0x34434a, roughness: 0.96 })
const white = new THREE.MeshStandardMaterial({ color: 0xf7f4e9, roughness: 0.88 })
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x25343a, metalness: 0.25, roughness: 0.65 })

function box(parent: THREE.Object3D, width: number, height: number, depth: number, color: number | THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), typeof color === 'number' ? new THREE.MeshStandardMaterial({ color, roughness: 0.86 }) : color)
  mesh.position.set(x, y, z)
  mesh.receiveShadow = true
  mesh.castShadow = height > 0.15
  parent.add(mesh)
  return mesh
}

function makeCar(color: number) {
  const car = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.33, roughness: 0.42 })
  box(car, 2.1, 0.7, 4.3, paint, 0, 0.72, 0)
  box(car, 1.75, 0.62, 2.25, paint, 0, 1.37, -0.25)
  box(car, 1.53, 0.42, 0.035, 0x85b5bc, 0, 1.38, 0.9)
  box(car, 1.53, 0.42, 0.035, 0x567b88, 0, 1.38, -1.39)
  for (const side of [-1, 1]) {
    for (const end of [-1.32, 1.32]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.24, 12), darkMetal)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(side * 1.04, 0.4, end)
      wheel.castShadow = true
      car.add(wheel)
    }
    box(car, 0.33, 0.18, 0.09, 0xffefb9, side * 0.72, 0.75, 2.18)
    box(car, 0.32, 0.16, 0.09, 0xd85f54, side * 0.72, 0.75, -2.18)
  }
  return car
}

function makePerson(color: number) {
  const person = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0xe2ae88, roughness: 0.9 })
  const coat = new THREE.MeshStandardMaterial({ color, roughness: 0.86 })
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skin)
  head.position.y = 1.66
  head.castShadow = true
  person.add(head)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.7, 8), coat)
  torso.position.y = 1.05
  torso.castShadow = true
  person.add(torso)
  for (const side of [-1, 1]) {
    box(person, 0.13, 0.58, 0.15, 0x34434b, side * 0.13, 0.38, 0)
    box(person, 0.12, 0.58, 0.12, coat, side * 0.34, 1.05, 0)
  }
  return person
}

function trafficHead(parent: THREE.Object3D, x: number, z: number, pedestrian: boolean, rotation: number) {
  const group = new THREE.Group()
  group.position.set(x, 0.18, z)
  group.rotation.y = rotation
  parent.add(group)
  box(group, 0.6, 0.16, 0.6, 0x9daba5, 0, 0.08, 0)
  box(group, 0.16, pedestrian ? 3.0 : 4.0, 0.16, 0x627a7c, 0, pedestrian ? 1.5 : 2, 0)
  box(group, pedestrian ? 0.75 : 0.8, pedestrian ? 1.25 : 1.65, 0.39, darkMetal, 0, pedestrian ? 3.0 : 4.0, 0)
  const colors = pedestrian ? [0xf16d60, 0x54d5a0] : [0xf16d60, 0xf4c968, 0x54d5a0]
  const lights = colors.map((color, index) => {
    const material = new THREE.MeshStandardMaterial({ color: 0x24373a, emissive: color, emissiveIntensity: 0.015 })
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), material)
    lamp.position.set(0, pedestrian ? 3.28 - index * 0.53 : 4.5 - index * 0.52, 0.22)
    group.add(lamp)
    return lamp
  })
  return lights
}

function createScene(host: HTMLDivElement): SceneState {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xaecfd7)
  scene.fog = new THREE.Fog(0xaecfd7, 85, 155)
  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 250)
  camera.position.set(40, 45, 46)
  camera.lookAt(0, 0, 0)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.appendChild(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.enableDamping = true
  controls.minDistance = 36
  controls.maxDistance = 105
  controls.maxPolarAngle = 1.36
  controls.target.set(0, 0, 0)
  const ambient = new THREE.AmbientLight(0xffffff, 2.1)
  scene.add(ambient)
  const sun = new THREE.DirectionalLight(0xfff1d2, 3)
  sun.position.set(-30, 50, 25)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = sun.shadow.camera.bottom = -60
  sun.shadow.camera.right = sun.shadow.camera.top = 60
  scene.add(sun)

  box(scene, 100, 0.1, 100, 0x819f82, 0, -0.16, 0)
  box(scene, 100, 0.08, ROAD_HALF_WIDTH * 2, asphalt, 0, 0, 0)
  box(scene, ROAD_HALF_WIDTH * 2, 0.09, 100, asphalt, 0, 0.01, 0)
  const pavement = 0xcbd1c0
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(scene, 39, 0.22, 39, pavement, sx * 28.5, 0.07, sz * 28.5)
    box(scene, 12, 0.14, 12, sx === sz ? 0xb4c4ab : 0xa9bea9, sx * 34, 0.18, sz * 34)
    const color = sx === sz ? 0xd5b796 : 0x9fb8b0
    const building = box(scene, 10, sx === sz ? 8 : 11, 10, color, sx * 29, sx === sz ? 4.28 : 5.78, sz * 29)
    building.material = new THREE.MeshStandardMaterial({ color, roughness: 0.87 })
    for (let level = 1; level <= 3; level++) {
      box(scene, 8, 0.4, 0.09, 0x557784, sx * 29, level * 2.1, sz * 29 - 5.05)
    }
  }
  for (let distance = -43; distance <= 43; distance += 7) {
    if (Math.abs(distance) < 17) continue
    box(scene, 2.7, 0.015, 0.12, 0xe6dfb5, distance, 0.09, 0)
    box(scene, 0.12, 0.015, 2.7, 0xe6dfb5, 0, 0.09, distance)
  }
  for (const sign of [-1, 1]) {
    // Four zebra crossings: two across each road.
    for (let offset = -7; offset <= 7; offset += 1.65) {
      box(scene, 4.2, 0.018, 0.84, white, sign * 11.8, 0.10, offset)
      box(scene, 0.84, 0.018, 4.2, white, offset, 0.11, sign * 11.8)
    }
    box(scene, 0.12, 0.018, 8.0, white, sign * STOP_LINE, 0.11, -sign * 4.1)
    box(scene, 8.0, 0.018, 0.12, white, sign * 4.1, 0.12, sign * STOP_LINE)
  }
  const lamps: Signals[] = signalLayout.map(signal => ({
    axis: signal.axis,
    pedestrian: signal.kind === 'pedestrian',
    lights: trafficHead(scene, signal.x, signal.z, signal.kind === 'pedestrian', signal.rotation),
  }))
  for (const [x, z] of [[-41, -13], [-23, -13], [23, 13], [41, 13], [-13, 41], [13, -41]]) {
    box(scene, 0.2, 1.7, 0.2, 0x695e4d, x, 0.9, z)
    const crown = new THREE.Mesh(new THREE.SphereGeometry(2.1, 9, 7), new THREE.MeshStandardMaterial({ color: 0x4d7f58, roughness: 1 }))
    crown.position.set(x, 2.6, z)
    crown.castShadow = true
    scene.add(crown)
  }
  const carMeshes: THREE.Group[] = []
  const personMeshes: THREE.Group[] = []
  const resize = () => {
    const width = host.clientWidth, height = host.clientHeight
    if (!width || !height) return
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    renderer.render(scene, camera)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()
  return { scene, renderer, camera, controls, ambient, sun, lamps, carMeshes, personMeshes, dispose: () => {
    observer.disconnect()
    controls.dispose()
    scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => { if (![asphalt, white, darkMetal].includes(material as THREE.MeshStandardMaterial)) material.dispose() }) } })
    renderer.dispose()
    host.removeChild(renderer.domElement)
  } }
}

function updateSignals(lamps: Signals[], phase: Phase, colors: VehicleSignals) {
  for (const signal of lamps) {
    const active = signal.pedestrian ? [phase === 'pedestrian_green' ? 1 : 0]
      : colors[signal.axis] === 'green' ? [2] : colors[signal.axis] === 'amber' ? [1]
        : colors[signal.axis] === 'red_amber' ? [0, 1] : [0]
    const palette = signal.pedestrian ? [0xf16d60, 0x54d5a0] : [0xf16d60, 0xf4c968, 0x54d5a0]
    signal.lights.forEach((lamp, index) => {
      const material = lamp.material as THREE.MeshStandardMaterial
      material.emissiveIntensity = active.includes(index) ? 2.8 : 0.02
      material.color.setHex(active.includes(index) ? palette[index] : 0x24373a)
    })
  }
}

function updateEnvironment(state: SceneState, time: TrafficProfile['time_of_day']) {
  const palette = {
    morning: [0xe9c8aa, 0xffe3b3, 2.0, 2.6], day: [0xaecfd7, 0xfff2d5, 2.1, 3.0],
    evening: [0xa48191, 0xffb588, 1.35, 2.1], night: [0x263d58, 0xb8d0ee, 0.8, 0.55],
  }[time]
  state.scene.background = new THREE.Color(palette[0])
  if (state.scene.fog instanceof THREE.Fog) state.scene.fog.color.setHex(palette[0])
  state.sun.color.setHex(palette[1])
  state.ambient.intensity = palette[2]
  state.sun.intensity = palette[3]
}

function positionCar(mesh: THREE.Group, lane: number, progress: number) {
  if (lane === 0) { mesh.position.set(progress, 0.1, 3.4); mesh.rotation.y = Math.PI / 2 }
  else if (lane === 1) { mesh.position.set(-progress, 0.1, -3.4); mesh.rotation.y = -Math.PI / 2 }
  else if (lane === 2) { mesh.position.set(-3.4, 0.1, progress); mesh.rotation.y = 0 }
  else { mesh.position.set(3.4, 0.1, -progress); mesh.rotation.y = Math.PI }
}

function positionWalker(mesh: THREE.Group, routeIndex: number, amount: number, waitingRank: number | null) {
  const route = pedestrianRoutes[routeIndex]
  const dx = route.endX - route.startX
  const dz = route.endZ - route.startZ
  const distance = Math.hypot(dx, dz)
  let x = route.startX + dx * amount
  let z = route.startZ + dz * amount
  if (waitingRank !== null) {
    const back = 0.8 + (waitingRank % 4) * 0.75
    const sideways = Math.floor(waitingRank / 4) * 0.7
    x += (-dx * back + dz * sideways) / distance
    z += (-dz * back - dx * sideways) / distance
  }
  mesh.position.set(x, 0.2, z)
  mesh.rotation.y = Math.atan2(dx, dz)
}

export default function ThreeRoadScene({ frames, current, playing, speed, profile }: { frames: Frame[]; current: number; playing: boolean; speed: number; profile: TrafficProfile }) {
  const host = useRef<HTMLDivElement>(null)
  const state = useRef<SceneState | null>(null)
  const traffic = useMemo(() => buildTraffic(frames), [frames])
  const playback = useRef({ current, playing, speed, frames, traffic })
  playback.current = { current, playing, speed, frames, traffic }

  useEffect(() => {
    if (!host.current) return
    let scene: SceneState
    try { scene = createScene(host.current) } catch { return }
    state.current = scene
    let animation = 0
    let lastTime = performance.now()
    let fraction = 0
    let lastCurrent = current
    const draw = (now: number) => {
      const values = playback.current
      if (values.current !== lastCurrent) { fraction = 0; lastCurrent = values.current }
      else if (values.playing) fraction = Math.min(0.98, fraction + (now - lastTime) / (1000 / values.speed))
      lastTime = now
      const t = Math.min(values.frames.length - 1, values.current + fraction)
      const frame = values.frames[Math.floor(t)]
      if (frame) updateSignals(scene.lamps, frame.phase, values.traffic.signals[Math.floor(t)])
      scene.carMeshes.forEach(mesh => { mesh.visible = false })
      for (let i = 0; i < values.traffic.vehicles.length; i++) {
        const vehicle = values.traffic.vehicles[i]
        const progress = sampleVehicle(vehicle, t)
        if (t < vehicle.born || progress > 52 || progress < -50) continue
        if (!scene.carMeshes[i]) { scene.carMeshes[i] = makeCar(carColors[i % carColors.length]); scene.scene.add(scene.carMeshes[i]) }
        const mesh = scene.carMeshes[i]
        mesh.visible = true
        positionCar(mesh, vehicle.lane, progress)
      }
      const waitingRanks = Array<number>(pedestrianRoutes.length).fill(0)
      for (let i = 0; i < values.traffic.walkers.length; i++) {
        const walker = values.traffic.walkers[i]
        const age = t - walker.start
        const waiting = t >= walker.born && t < walker.start
        const crossing = age >= 0 && age <= 5.5
        if (!waiting && !crossing) { if (scene.personMeshes[i]) scene.personMeshes[i].visible = false; continue }
        if (!scene.personMeshes[i]) { scene.personMeshes[i] = makePerson(coatColors[i % coatColors.length]); scene.scene.add(scene.personMeshes[i]) }
        const mesh = scene.personMeshes[i]
        mesh.visible = true
        positionWalker(mesh, walker.route, waiting ? 0 : Math.min(1, age / 5.5), waiting ? waitingRanks[walker.route]++ : null)
      }
      for (let i = values.traffic.walkers.length; i < scene.personMeshes.length; i++) {
        if (scene.personMeshes[i]) scene.personMeshes[i].visible = false
      }
      scene.controls.update()
      scene.renderer.render(scene.scene, scene.camera)
      animation = requestAnimationFrame(draw)
    }
    animation = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(animation); scene.dispose(); state.current = null }
  }, [])
  useEffect(() => { if (state.current) updateEnvironment(state.current, profile.time_of_day) }, [profile.time_of_day])
  const frame = frames[Math.min(current, frames.length - 1)]
  return <div className={`sim-road sim-3d sim-${profile.time_of_day}`} role="img" aria-label={`Трёхмерный перекрёсток: ${frame?.phase ?? ''}. Автомобилей за сценарий: ${traffic.vehicles.length}, пешеходов: ${traffic.walkers.length}.`}>
    <div className="sim-webgl" ref={host}/>
    <div className="sim-map-hud"><span className="sim-map-live"><i/> 3D-перекрёсток</span><span>Мышью можно повернуть карту</span></div>
    {!frame?.healthy && <div className="sim-camera-fault"><strong>Камера недоступна</strong><span>Контроллер работает по резервному циклу</span></div>}
    <div className="sim-scene-key"><span><i className="sim-key-car"/>Автомобили</span><span><i className="sim-key-ped"/>Пешеходы в обе стороны</span><span>🚦 Сигналы на карте</span></div>
  </div>
}
