import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Frame, Phase, TrafficProfile } from './types'
import { buildTraffic, cameraMounts, pedestrianRoutes, roadApproaches, sampleVehicle, sampleWalkerPosition, signalLayout, streetLampXs, vehicleLanes, ROAD_HALF_WIDTH } from './roadTraffic'
import type { SignalColor, Walker } from './roadTraffic'

type SceneView = 'overview' | 'camera-1' | 'camera-2'
type Signals = { pedestrian: boolean; lights: THREE.Mesh[] }
type SceneState = {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  cameraViews: THREE.PerspectiveCamera[]
  cameraModels: THREE.Group[]
  cameraMarkers: THREE.Sprite[]
  controls: OrbitControls
  ambient: THREE.AmbientLight
  sun: THREE.DirectionalLight
  streetLights: THREE.SpotLight[]
  streetLightLenses: THREE.MeshStandardMaterial[]
  lamps: Signals[]
  carMeshes: THREE.Group[]
  personMeshes: THREE.Group[]
  dispose: () => void
}

const carColors = [0x244c71, 0xc4c6c6, 0x946746, 0x293d50, 0xb8b6ac, 0x6b786a]
const coatColors = [0xd89861, 0x41627a, 0x71866c, 0x9f655a, 0x444950]
const white = new THREE.MeshStandardMaterial({ color: 0xe9e8df, roughness: 0.92 })
const yellow = new THREE.MeshStandardMaterial({ color: 0xe6ab2d, roughness: 0.84 })
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x202327, metalness: 0.66, roughness: 0.42 })

function box(parent: THREE.Object3D, width: number, height: number, depth: number, color: number | THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), typeof color === 'number' ? new THREE.MeshStandardMaterial({ color, roughness: 0.85 }) : color)
  mesh.position.set(x, y, z)
  mesh.receiveShadow = true
  mesh.castShadow = height > 0.22
  parent.add(mesh)
  return mesh
}

function rounded(parent: THREE.Object3D, width: number, height: number, depth: number, radius: number, material: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 3, radius), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function noisyTexture(base: string, fleck: string, amount: number, repeatX: number, repeatY: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')!
  context.fillStyle = base
  context.fillRect(0, 0, 256, 256)
  let seed = 314159
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let index = 0; index < amount; index++) {
    context.globalAlpha = 0.05 + random() * 0.18
    context.fillStyle = fleck
    const size = 0.5 + random() * 2.2
    context.fillRect(random() * 256, random() * 256, size, size)
  }
  context.globalAlpha = 1
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeatX, repeatY)
  texture.anisotropy = 8
  return texture
}

function makeCar(color: number) {
  const car = new THREE.Group()
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.27, clearcoat: 0.85, clearcoatRoughness: 0.2 })
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x253c48, metalness: 0.18, roughness: 0.12, transparent: true, opacity: 0.88 })
  rounded(car, 2.05, 0.62, 4.25, 0.23, paint, 0, 0.72, 0)
  rounded(car, 1.81, 0.62, 2.23, 0.22, paint, 0, 1.29, -0.2)
  box(car, 1.58, 0.42, 0.025, glass, 0, 1.31, 0.93)
  box(car, 1.58, 0.42, 0.025, glass, 0, 1.31, -1.33)
  for (const side of [-1, 1]) {
    box(car, 0.025, 0.36, 1.55, glass, side * 0.92, 1.32, -0.2)
    for (const end of [-1.35, 1.35]) {
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 20), new THREE.MeshStandardMaterial({ color: 0x16191b, roughness: 0.92 }))
      tyre.rotation.z = Math.PI / 2
      tyre.position.set(side * 1.02, 0.42, end)
      tyre.castShadow = true
      car.add(tyre)
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 20), new THREE.MeshStandardMaterial({ color: 0x9da3a5, metalness: 0.8, roughness: 0.35 }))
      rim.rotation.z = Math.PI / 2
      rim.position.set(side * 1.16, 0.42, end)
      car.add(rim)
    }
    box(car, 0.36, 0.14, 0.045, 0xfff1ce, side * 0.71, 0.77, 2.14)
    box(car, 0.35, 0.13, 0.045, 0xbd3430, side * 0.71, 0.77, -2.14)
    box(car, 0.15, 0.12, 0.27, paint, side * 1.07, 1.14, 0.66)
  }
  box(car, 1.24, 0.15, 0.035, 0x1a2227, 0, 0.62, 2.14)
  return car
}

function makePerson(color: number) {
  const person = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0xc99473, roughness: 0.94 })
  const coat = new THREE.MeshStandardMaterial({ color, roughness: 0.91 })
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), skin)
  head.position.y = 1.71
  head.castShadow = true
  person.add(head)
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.224, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.43), new THREE.MeshStandardMaterial({ color: 0x3b312d, roughness: 1 }))
  hair.position.y = 1.75
  person.add(hair)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.72, 12), coat)
  torso.position.y = 1.13
  torso.castShadow = true
  person.add(torso)
  const legs: THREE.Group[] = []
  const arms: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const leg = new THREE.Group()
    leg.position.set(side * 0.1, 0.75, 0)
    box(leg, 0.12, 0.66, 0.13, 0x303a42, 0, -0.33, 0)
    person.add(leg)
    legs.push(leg)
    const arm = new THREE.Group()
    arm.position.set(side * 0.3, 1.39, 0)
    box(arm, 0.1, 0.55, 0.12, coat, 0, -0.27, 0)
    person.add(arm)
    arms.push(arm)
  }
  person.userData.limbs = { legs, arms }
  return person
}

function trafficHead(parent: THREE.Object3D, x: number, z: number, pedestrian: boolean, rotation: number) {
  const group = new THREE.Group()
  group.position.set(x, 0.65, z)
  group.rotation.y = rotation
  parent.add(group)
  box(group, 0.66, 0.11, 0.66, 0x777b79, 0, 0.05, 0)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.115, pedestrian ? 2.8 : 4.6, 12), darkMetal)
  pole.position.y = pedestrian ? 1.4 : 2.3
  pole.castShadow = true
  group.add(pole)
  const top = pedestrian ? 2.92 : 4.32
  rounded(group, 0.72, pedestrian ? 1.04 : 1.54, 0.43, 0.08, darkMetal, 0, top, 0.12)
  const colors = pedestrian ? [0xe24236, 0x39b88b] : [0xe24236, 0xe7b333, 0x47b885]
  return colors.map((color, index) => {
    const material = new THREE.MeshStandardMaterial({ color: 0x212929, emissive: color, emissiveIntensity: 0.02, roughness: 0.48 })
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 12), material)
    lamp.position.set(0, top + (pedestrian ? 0.25 : 0.5) - index * 0.48, 0.36)
    group.add(lamp)
    return lamp
  })
}

function crossingSign(parent: THREE.Object3D, x: number, z: number, rotation: number, height = 3.35) {
  const sign = new THREE.Group()
  sign.position.set(x, 0.66, z)
  sign.rotation.y = rotation
  parent.add(sign)
  if (height < 4) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 3.65, 10), darkMetal)
    pole.position.y = 1.83
    pole.castShadow = true
    sign.add(pole)
  }
  box(sign, 1.05, 1.05, 0.07, 0xf0d747, 0, height, 0.13)
  box(sign, 0.92, 0.92, 0.08, 0x165a9a, 0, height, 0.19)
  const triangle = new THREE.Shape()
  triangle.moveTo(0, height + 0.37)
  triangle.lineTo(-0.37, height - 0.34)
  triangle.lineTo(0.37, height - 0.34)
  triangle.closePath()
  const whiteTriangle = new THREE.Mesh(new THREE.ShapeGeometry(triangle), white)
  whiteTriangle.position.z = 0.24
  sign.add(whiteTriangle)
  const head = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), darkMetal)
  head.position.set(0.03, height + 0.12, 0.25)
  sign.add(head)
  const figure = box(sign, 0.075, 0.24, 0.02, darkMetal, 0.01, height - 0.05, 0.25)
  figure.rotation.z = -0.28
  const stride = box(sign, 0.26, 0.045, 0.02, darkMetal, 0, height - 0.22, 0.25)
  stride.rotation.z = -0.23
}

function overheadSign(parent: THREE.Object3D, x: number, side: number, rotation: number) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 5.6, 12), darkMetal)
  post.position.set(x, 3.36, side * 10.75)
  post.castShadow = true
  parent.add(post)
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 6.0, 10), darkMetal)
  arm.rotation.x = Math.PI / 2
  arm.position.set(x, 5.95, side * 7.85)
  arm.castShadow = true
  parent.add(arm)
  crossingSign(parent, x, side * 6.5, rotation, 5.3)
}

function mastCamera(parent: THREE.Scene, mount: (typeof cameraMounts)[number]) {
  const position = new THREE.Vector3(mount.x, mount.y, mount.z)
  const target = new THREE.Vector3(mount.targetX, mount.targetY, mount.targetZ)
  const cameraBody = new THREE.Group()
  cameraBody.position.copy(position)
  cameraBody.lookAt(target)
  parent.add(cameraBody)
  rounded(cameraBody, 0.54, 0.32, 0.72, 0.08, white, 0, 0, 0)
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.15, 20), darkMetal)
  lens.rotation.x = Math.PI / 2
  lens.position.z = 0.42
  cameraBody.add(lens)
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.095, 20), new THREE.MeshStandardMaterial({ color: 0x172d3e, metalness: 0.55, roughness: 0.12 }))
  glass.position.z = 0.51
  cameraBody.add(glass)
  box(parent, 0.09, 0.6, 0.09, darkMetal, mount.x, 5.63, mount.z)
  const view = new THREE.PerspectiveCamera(58, 1, 0.05, 150)
  const forward = target.clone().sub(position).normalize()
  view.position.copy(position).addScaledVector(forward, 0.36)
  view.lookAt(target)
  return { cameraBody, view }
}

function cameraMarker(parent: THREE.Scene, mount: (typeof cameraMounts)[number], number: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  context.beginPath()
  context.arc(64, 64, 48, 0, Math.PI * 2)
  context.fillStyle = '#176f73'
  context.fill()
  context.lineWidth = 7
  context.strokeStyle = '#e9f4ef'
  context.stroke()
  context.fillStyle = '#ffffff'
  context.font = 'bold 54px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(String(number), 64, 67)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
  marker.position.set(mount.x, 6.9, mount.z)
  marker.scale.set(1.65, 1.65, 1)
  parent.add(marker)
  return marker
}

function streetLamp(parent: THREE.Scene, x: number, side: number) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 7, 12), darkMetal)
  pole.position.set(x, 4.2, side * 11.7)
  pole.castShadow = true
  parent.add(pole)
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.2, 10), darkMetal)
  arm.rotation.x = Math.PI / 2
  arm.position.set(x, 7.61, side * 9.65)
  arm.castShadow = true
  parent.add(arm)
  rounded(parent, 1.35, 0.18, 0.72, 0.07, darkMetal, x, 7.55, side * 7.6)
  const lens = new THREE.MeshStandardMaterial({ color: 0xe7e4d9, emissive: 0xffd998, emissiveIntensity: 0.12, roughness: 0.48 })
  box(parent, 1.13, 0.04, 0.55, lens, x, 7.44, side * 7.6)
  const light = new THREE.SpotLight(0xffe4b1, 0, 34, 0.61, 0.75, 1.4)
  light.position.set(x, 7.39, side * 7.6)
  light.target.position.set(Math.abs(x) <= 12 ? Math.sign(x) * 5 : x - Math.sign(x) * 2, 0.56, side * 2.5)
  parent.add(light)
  parent.add(light.target)
  return { light, lens }
}

function createScene(host: HTMLDivElement): SceneState {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xe7e4dd)
  const camera = new THREE.PerspectiveCamera(41, 1, 0.1, 240)
  camera.position.set(26, 39, 49)
  camera.lookAt(0, 0, 0)
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.55
  host.appendChild(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.enableDamping = true
  controls.minDistance = 33
  controls.maxDistance = 100
  controls.maxPolarAngle = 1.33
  controls.target.set(0, 0, 0)
  const ambient = new THREE.AmbientLight(0xffffff, 1.3)
  scene.add(ambient)
  const sun = new THREE.DirectionalLight(0xfff4df, 3.2)
  sun.position.set(-24, 40, 30)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = sun.shadow.camera.bottom = -58
  sun.shadow.camera.right = sun.shadow.camera.top = 58
  sun.shadow.bias = -0.0004
  scene.add(sun)

  // Architectural model: one continuous road between two planted pavements.
  box(scene, 108, 1.1, 46, 0x252627, 0, -0.28, 0)
  box(scene, 106.4, 0.15, 44.4, 0x60635e, 0, 0.34, 0)
  const roadTexture = noisyTexture('#383a3d', '#c5c4bd', 17500, 12, 3)
  const road = new THREE.MeshStandardMaterial({ map: roadTexture, roughness: 0.97 })
  box(scene, 106, 0.13, ROAD_HALF_WIDTH * 2, road, 0, 0.49, 0)
  const pavingTexture = noisyTexture('#bcbab2', '#eeeae0', 15000, 8, 2)
  const paving = new THREE.MeshStandardMaterial({ map: pavingTexture, roughness: 0.97 })
  const grassTexture = noisyTexture('#597349', '#a1ae73', 28000, 12, 2)
  const grass = new THREE.MeshStandardMaterial({ map: grassTexture, roughness: 1 })
  for (const side of [-1, 1]) {
    box(scene, 106, 0.21, 4.9, paving, 0, 0.61, side * 11.5)
    box(scene, 106, 0.19, 0.26, 0xd6d3c8, 0, 0.64, side * 9.02)
    box(scene, 106, 0.14, 7.6, grass, 0, 0.57, side * 17.75)
    box(scene, 106, 0.09, 0.13, 0xe5e3dc, 0, 0.62, side * 8.55)
    for (let x = -51; x <= 51; x += 3.1) box(scene, 0.04, 0.013, 4.55, 0x999990, x, 0.727, side * 11.5)
    for (let x = -50; x <= 50; x += 7.2) {
      if (Math.abs(x) < 5.5) continue
      box(scene, 2.8, 0.013, 0.11, white, x, 0.57, side * 4.4)
    }
  }
  for (const z of [-0.19, 0.19]) {
    box(scene, 106, 0.015, 0.095, yellow, 0, 0.567, z)
  }
  // The same zebra crosses both carriageway halves around a raised refuge.
  for (let x = -3.35; x <= 3.36; x += 0.94) {
    const index = Math.round((x + 3.35) / 0.94)
    for (const side of [-1, 1]) {
      box(scene, 0.59, 0.018, 7.37, index % 2 === 0 ? white : yellow, x, 0.58, side * 4.65)
    }
  }
  rounded(scene, 7.8, 0.3, 1.25, 0.22, paving, 0, 0.7, 0)
  for (const approach of roadApproaches) {
    box(scene, 0.14, 0.02, 7.55, white, approach.stopX, 0.59, approach.side * 4.4)
    crossingSign(scene, approach.signX, approach.signZ, approach.signRotation)
    overheadSign(scene, approach.overheadX, approach.side, approach.signRotation)
  }
  const cameraRig = cameraMounts.map(mount => mastCamera(scene, mount))
  const cameraViews = cameraRig.map(rig => rig.view)
  const cameraModels = cameraRig.map(rig => rig.cameraBody)
  const cameraMarkers = cameraMounts.map((mount, index) => cameraMarker(scene, mount, index + 1))
  for (const side of [-1, 1]) for (let x = 5.5; x <= 18.5; x += 3.25) {
    const segment = side * x
    box(scene, 0.075, 0.9, 0.075, yellow, segment, 1.01, 0)
    if (x < 18.5) box(scene, 3.3, 0.07, 0.07, yellow, segment + side * 1.62, 1.35, 0)
  }
  const lamps: Signals[] = signalLayout.map(signal => ({
    pedestrian: signal.kind === 'pedestrian',
    lights: trafficHead(scene, signal.x, signal.z, signal.kind === 'pedestrian', signal.rotation),
  }))
  const streetLampRig = streetLampXs.flatMap(x => [-1, 1].map(side => streetLamp(scene, x, side)))
  const streetLights = streetLampRig.map(rig => rig.light)
  const streetLightLenses = streetLampRig.map(rig => rig.lens)
  for (const x of [-35, 35]) for (const side of [-1, 1]) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 2.9, 12), new THREE.MeshStandardMaterial({ color: 0x594a3a, roughness: 1 }))
    trunk.position.set(x, 2, side * 18)
    trunk.castShadow = true
    scene.add(trunk)
    const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(2.15, 2), new THREE.MeshStandardMaterial({ color: 0x456b3c, roughness: 1 }))
    foliage.position.set(x, 4.15, side * 18)
    foliage.castShadow = true
    scene.add(foliage)
  }
  const carMeshes: THREE.Group[] = []
  const personMeshes: THREE.Group[] = []
  const resize = () => {
    const width = host.clientWidth, height = host.clientHeight
    if (!width || !height) return
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    for (const view of cameraViews) {
      view.aspect = width / height
      view.updateProjectionMatrix()
    }
    renderer.setSize(width, height, false)
    renderer.render(scene, camera)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()
  return { scene, renderer, camera, cameraViews, cameraModels, cameraMarkers, controls, ambient, sun, streetLights, streetLightLenses, lamps, carMeshes, personMeshes, dispose: () => {
    observer.disconnect()
    controls.dispose()
    const materials = new Set<THREE.Material>()
    scene.traverse(object => { if (object instanceof THREE.Mesh) {
      object.geometry.dispose()
      const list = Array.isArray(object.material) ? object.material : [object.material]
      list.forEach(material => materials.add(material))
    } })
    materials.forEach(material => { if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose(); material.dispose() })
    cameraMarkers.forEach(marker => { marker.material.map?.dispose(); marker.material.dispose() })
    renderer.dispose()
    host.removeChild(renderer.domElement)
  } }
}

function updateSignals(lamps: Signals[], phase: Phase, color: SignalColor) {
  for (const signal of lamps) {
    const active = signal.pedestrian ? [phase === 'pedestrian_walk' ? 1 : 0]
      : color === 'green' ? [2] : color === 'amber' ? [1] : color === 'red_amber' ? [0, 1] : [0]
    const palette = signal.pedestrian ? [0xe24236, 0x39b88b] : [0xe24236, 0xe7b333, 0x47b885]
    signal.lights.forEach((lamp, index) => {
      const material = lamp.material as THREE.MeshStandardMaterial
      material.emissiveIntensity = active.includes(index) ? 3.2 : 0.02
      material.color.setHex(active.includes(index) ? palette[index] : 0x212929)
    })
  }
}

function updateEnvironment(state: SceneState, time: TrafficProfile['time_of_day']) {
  const palette = {
    morning: [0xe8d9c7, 0xffddaf, 1.2, 2.8], day: [0xe7e4dd, 0xfff4df, 1.3, 3.2],
    evening: [0x96898a, 0xffb782, 0.9, 2.2], night: [0x202936, 0xa6bfda, 0.65, 0.7],
  }[time]
  state.scene.background = new THREE.Color(palette[0])
  state.sun.color.setHex(palette[1])
  state.ambient.intensity = palette[2]
  state.sun.intensity = palette[3]
  state.streetLights.forEach(light => { light.intensity = time === 'night' ? 48 : time === 'evening' ? 8 : 0 })
  state.streetLightLenses.forEach(lens => { lens.emissiveIntensity = time === 'night' ? 2.8 : time === 'evening' ? 1.1 : 0.12 })
}

function positionCar(mesh: THREE.Group, lane: number, progress: number) {
  const path = vehicleLanes[lane]
  mesh.position.set(path.direction * progress, 0.59, path.z)
  mesh.rotation.y = path.direction * Math.PI / 2
}

function positionWalker(mesh: THREE.Group, walker: Walker, time: number) {
  const age = time - walker.start
  const moving = age >= 0 && age <= walker.duration
  const position = sampleWalkerPosition(walker, time)
  const next = moving ? sampleWalkerPosition(walker, Math.min(time + 0.05, walker.start + walker.duration)) : null
  const step = age * 9.2 + walker.gaitPhase
  mesh.position.set(position.x, 0.57 + (moving ? Math.abs(Math.sin(step)) * 0.035 : 0), position.z)
  mesh.rotation.y = next && (next.x !== position.x || next.z !== position.z)
    ? Math.atan2(next.x - position.x, next.z - position.z)
    : (pedestrianRoutes[walker.route].endZ > 0 ? 0 : Math.PI) + Math.sin(time * 0.7 + walker.gaitPhase) * 0.07
  mesh.rotation.z = moving ? Math.sin(step) * 0.018 : 0
  const limbs = mesh.userData.limbs as { legs: THREE.Group[]; arms: THREE.Group[] }
  limbs.legs.forEach((leg, index) => { leg.rotation.x = moving ? Math.sin(step + index * Math.PI) * 0.38 : 0 })
  limbs.arms.forEach((arm, index) => { arm.rotation.x = moving ? -Math.sin(step + index * Math.PI) * 0.26 : 0 })
}

export default function ThreeRoadScene({ frames, current, playing, speed, profile }: { frames: Frame[]; current: number; playing: boolean; speed: number; profile: TrafficProfile }) {
  const host = useRef<HTMLDivElement>(null)
  const state = useRef<SceneState | null>(null)
  const [view, setView] = useState<SceneView>('overview')
  const viewRef = useRef(view)
  viewRef.current = view
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
      for (let i = 0; i < values.traffic.walkers.length; i++) {
        const walker = values.traffic.walkers[i]
        const age = t - walker.start
        const waiting = t >= walker.born && t < walker.start
        const crossing = age >= 0 && age <= walker.duration
        if (!waiting && !crossing) { if (scene.personMeshes[i]) scene.personMeshes[i].visible = false; continue }
        if (!scene.personMeshes[i]) { scene.personMeshes[i] = makePerson(coatColors[i % coatColors.length]); scene.scene.add(scene.personMeshes[i]) }
        const mesh = scene.personMeshes[i]
        mesh.visible = true
        positionWalker(mesh, walker, t)
      }
      for (let i = values.traffic.walkers.length; i < scene.personMeshes.length; i++) {
        if (scene.personMeshes[i]) scene.personMeshes[i].visible = false
      }
      const cameraIndex = viewRef.current === 'camera-1' ? 0 : viewRef.current === 'camera-2' ? 1 : -1
      scene.cameraModels.forEach((model, index) => { model.visible = index !== cameraIndex })
      scene.cameraMarkers.forEach(marker => { marker.visible = cameraIndex === -1 })
      scene.controls.enabled = cameraIndex === -1
      scene.controls.update()
      scene.renderer.render(scene.scene, cameraIndex === -1 ? scene.camera : scene.cameraViews[cameraIndex])
      animation = requestAnimationFrame(draw)
    }
    animation = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(animation); scene.dispose(); state.current = null }
  }, [])
  useEffect(() => { if (state.current) updateEnvironment(state.current, profile.time_of_day) }, [profile.time_of_day])
  const frame = frames[Math.min(current, frames.length - 1)]
  return <div className={`sim-road sim-3d sim-${profile.time_of_day} ${view !== 'overview' ? 'sim-camera-view' : ''}`}>
    <div className="sim-webgl" ref={host} role="img" aria-label={`Трёхмерная модель дороги с одним пешеходным переходом, ракурс: ${view === 'overview' ? 'общий' : view === 'camera-1' ? 'камера 1' : 'камера 2'}. ${frame?.phase ?? ''}. Автомобилей за сценарий: ${traffic.vehicles.length}, пешеходов: ${traffic.walkers.length}.`}/>
    <div className="sim-map-hud"><span className="sim-map-live"><i/> {view === 'overview' ? '3D-переход' : 'Виртуальный ракурс'}</span></div>
    <div className="sim-view-controls" role="group" aria-label="Ракурс сцены">
      {([['overview', 'Обзор'], ['camera-1', 'Камера 1'], ['camera-2', 'Камера 2']] as const).map(([key, label]) => <button type="button" key={key} className={view === key ? 'active' : ''} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
    </div>
    {view !== 'overview' && <div className="sim-camera-caption">{view === 'camera-1' ? 'Камера 1' : 'Камера 2'} · вид на противоположный тротуар</div>}
    {!frame?.healthy && <div className="sim-camera-fault"><strong>Камера недоступна</strong><span>Контроллер работает по резервному циклу</span></div>}
    <div className="sim-scene-key"><span><i className="sim-key-car"/>Автомобили</span><span><i className="sim-key-ped"/>Пешеходы в обе стороны</span><span>📷 Камеры на мачтах</span></div>
  </div>
}
