import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Safety } from '../api/types'
import { SafetyBanner, ScopeDisclaimer } from './SafetyBanner'

const base: Safety = {
  status: 'APPROVED',
  reasons: [],
  disclaimer: null,
  banner: null,
  policy_version: '1.0.0',
}

describe('SafetyBanner', () => {
  it('shows an approved verdict', () => {
    render(<SafetyBanner safety={base} />)
    expect(screen.getByText(/safety review: approved/i)).toBeDefined()
  })

  it('shows the clinician banner and every reason when flagged', () => {
    render(
      <SafetyBanner
        safety={{
          ...base,
          status: 'FLAGGED_FOR_CLINICIAN_REVIEW',
          reasons: ['High screening-risk tier', 'Projected swing too large'],
          banner: 'Recommended: review this result with a clinician.',
        }}
      />,
    )
    expect(screen.getByText(/flagged for clinician review/i)).toBeDefined()
    expect(screen.getByText(/review this result with a clinician/i)).toBeDefined()
    expect(screen.getByText(/High screening-risk tier/)).toBeDefined()
    expect(screen.getByText(/Projected swing too large/)).toBeDefined()
  })

  it('marks blocked output distinctly', () => {
    const { container } = render(<SafetyBanner safety={{ ...base, status: 'BLOCKED' }} />)
    expect(screen.getByText(/blocked by the safety layer/i)).toBeDefined()
    expect(container.querySelector('.banner.blocked')).not.toBeNull()
  })
})

describe('ScopeDisclaimer', () => {
  it('always states the prototype is not a diagnostic device', () => {
    render(<ScopeDisclaimer />)
    expect(screen.getByText(/not a diagnostic device/i)).toBeDefined()
  })

  it('names the training data source so scope is explicit', () => {
    render(<ScopeDisclaimer />)
    expect(screen.getByText(/BRFSS/i)).toBeDefined()
  })
})
