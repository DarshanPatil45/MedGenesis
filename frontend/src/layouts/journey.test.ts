import { describe, expect, it } from 'vitest'
import { JOURNEY, ROUTES, stageIndexFor } from './journey'

describe('journey breadcrumb', () => {
  /**
   * The bug this guards: `synthesis` linked to `/clinical-analysis` while
   * claiming `/careplan`. Clicking it navigated to a page that highlighted
   * `evidence`, so the control looked dead — and `/careplan` could not be
   * reached from the breadcrumb at all.
   */
  it('navigates every stage to a route that highlights that same stage', () => {
    JOURNEY.forEach((stage, i) => {
      expect(stage.routes, `${stage.id} must own its destination`).toContain(stage.to)
      expect(stageIndexFor(stage.to), `clicking ${stage.id} must highlight ${stage.id}`).toBe(i)
    })
  })

  it('gives each stage a distinct destination', () => {
    const targets = JOURNEY.map((s) => s.to)
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('claims no route twice across stages', () => {
    const claimed = JOURNEY.flatMap((s) => s.routes)
    expect(new Set(claimed).size).toBe(claimed.length)
  })

  it('maps every claimed route to a real screen', () => {
    const real = new Set(ROUTES.map((r) => r.to))
    for (const stage of JOURNEY) {
      for (const route of stage.routes) expect(real, `${route} must exist`).toContain(route)
    }
  })

  it('returns -1 for a route no stage claims', () => {
    expect(stageIndexFor('/not-a-route')).toBe(-1)
  })
})
