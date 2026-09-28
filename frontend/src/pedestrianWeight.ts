/** Threshold calculation for one waiting person while density stays constant. */
export function singlePedestrianProjection(density: number, referenceDensity: number, maxWaitSeconds: number) {
  const weight = 1 / (1 + density / referenceDensity)
  return { weight, requestAfterSeconds: maxWaitSeconds * (1 - weight) }
}
