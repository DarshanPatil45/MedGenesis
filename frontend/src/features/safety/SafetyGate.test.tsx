import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Safety } from '../../api/types'
import { SafetyGate } from './SafetyGate'

const base: Safety = {
  status: 'APPROVED',
  reasons: [],
  disclaimer: null,
  banner: null,
  policy_version: '1.1.0',
}

describe('SafetyGate', () => {
  it('renders the approved verdict with its policy version', () => {
    render(<SafetyGate safety={base} />)
    expect(screen.getByText('Approved')).toBeDefined()
    expect(screen.getByText('policy v1.1.0')).toBeDefined()
  })

  it('renders every reason returned when flagged — none are truncated', () => {
    render(
      <SafetyGate
        safety={{
          ...base,
          status: 'FLAGGED_FOR_CLINICIAN_REVIEW',
          reasons: ['High screening-risk tier', 'Projected swing too large'],
          banner: 'Recommended: review this result with a clinician.',
        }}
      />,
    )
    expect(screen.getByText('Flagged for clinician review')).toBeDefined()
    expect(screen.getByText('Recommended: review this result with a clinician.')).toBeDefined()
    expect(screen.getByText('High screening-risk tier')).toBeDefined()
    expect(screen.getByText('Projected swing too large')).toBeDefined()
  })

  it('never hides a blocking reason', () => {
    render(
      <SafetyGate safety={{ ...base, status: 'BLOCKED', reasons: ["[medication_advice] matched: 'start taking'"] }} />,
    )
    expect(screen.getByText('Blocked')).toBeDefined()
    expect(screen.getByText("[medication_advice] matched: 'start taking'")).toBeDefined()
  })

  it('shows the disclaimer only when the backend actually returns one', () => {
    const { rerender } = render(<SafetyGate safety={base} />)
    expect(screen.queryByText('Educational prototype disclaimer.')).toBeNull()
    rerender(<SafetyGate safety={{ ...base, disclaimer: 'Educational prototype disclaimer.' }} />)
    expect(screen.getByText('Educational prototype disclaimer.')).toBeDefined()
  })
})
