import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/pedestrianWeight.ts', import.meta.url), 'utf8')
const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 })
const { singlePedestrianProjection } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))

test('one pedestrian has full weight and requests immediately on an empty road', () => {
  assert.deepEqual(singlePedestrianProjection(0, 20, 90), { weight: 1, requestAfterSeconds: 0 })
})

test('one pedestrian waits longer as smoothed density reaches one and three reference units', () => {
  const reference = singlePedestrianProjection(20, 20, 90)
  const dense = singlePedestrianProjection(60, 20, 90)
  assert.equal(reference.weight, 0.5)
  assert.equal(reference.requestAfterSeconds, 45)
  assert.equal(dense.weight, 0.25)
  assert.equal(dense.requestAfterSeconds, 67.5)
})

test('the request delay uses the configured limit and reference density', () => {
  const result = singlePedestrianProjection(40, 40, 60)
  assert.equal(result.weight, 0.5)
  assert.equal(result.requestAfterSeconds, 30)
})
