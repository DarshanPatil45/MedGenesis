import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EvidenceSource } from '../../api/types'
import { EvidenceColumn } from './EvidenceColumn'

const LOCAL: EvidenceSource = {
  text: 'Regular physical activity helps the body use insulin more effectively.',
  document_id: 'cdc_diabetes_basics#physical-activity',
  section: 'Physical activity',
  title: 'Diabetes Basics',
  publisher: 'Centers for Disease Control and Prevention (CDC)',
  source_url: 'https://www.cdc.gov/diabetes/about/index.html',
  accessed: '2026-08-23',
  license: 'U.S. Government work — public domain',
  attribution: '',
  score: 0.71,
  source_type: 'local',
  doi: '',
}

const PUBMED: EvidenceSource = {
  ...LOCAL,
  text: 'Findings from a randomized trial.',
  document_id: 'pubmed#12345678',
  title: 'Physical activity and diabetes risk: a review',
  publisher: 'Diabetes Care',
  source_type: 'pubmed',
  doi: '10.1000/example.doi',
}

describe('EvidenceColumn', () => {
  it('explains when retrieval was not requested', () => {
    render(<EvidenceColumn local={[]} pubmed={[]} requested={false} fused={false} />)
    expect(screen.getByText('Evidence retrieval was not requested for this analysis.')).toBeDefined()
  })

  it('shows an honest empty state when retrieval returned nothing', () => {
    render(<EvidenceColumn local={[]} pubmed={[]} requested fused={false} />)
    expect(screen.getByText('No evidence retrieved')).toBeDefined()
  })

  it('numbers citations by their explicit index, not array position', () => {
    render(<EvidenceColumn local={[{ source: LOCAL, index: 2 }]} pubmed={[]} requested fused={false} />)
    expect(screen.getByRole('button', { name: /E2.*Diabetes Basics/ })).toBeDefined()
  })

  it('orders local and PubMed together by their true citation index', () => {
    render(
      <EvidenceColumn
        local={[{ source: LOCAL, index: 1 }]}
        pubmed={[{ source: PUBMED, index: 2 }]}
        requested
        fused={false}
      />,
    )
    const ids = screen.getAllByRole('button').map((b) => b.textContent)
    expect(ids[0]).toContain('E1')
    expect(ids[1]).toContain('E2')
    expect(screen.getByText('1 local')).toBeDefined()
    expect(screen.getByText('1 PubMed')).toBeDefined()
  })

  it('expands to reveal metadata, omitting PMID/DOI when the source has none', async () => {
    render(<EvidenceColumn local={[{ source: LOCAL, index: 1 }]} pubmed={[]} requested fused={false} />)
    expect(screen.queryByText('Accessed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /E1/ }))
    expect(await screen.findByText('Accessed')).toBeDefined()
    expect(screen.queryByText('PMID')).toBeNull()
    expect(screen.queryByText('DOI')).toBeNull()
  })

  it('shows PMID and DOI for a PubMed source that supplies them', async () => {
    render(<EvidenceColumn local={[]} pubmed={[{ source: PUBMED, index: 1 }]} requested fused={false} />)
    fireEvent.click(screen.getByRole('button', { name: /E1/ }))
    expect(await screen.findByText('PMID')).toBeDefined()
    expect(screen.getByText('12345678')).toBeDefined()
    expect(screen.getByText('10.1000/example.doi')).toBeDefined()
  })

  it('collapses again on a second click', async () => {
    render(<EvidenceColumn local={[{ source: LOCAL, index: 1 }]} pubmed={[]} requested fused={false} />)
    const toggle = screen.getByRole('button', { name: /E1/ })
    fireEvent.click(toggle)
    expect(await screen.findByText('Accessed')).toBeDefined()
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.queryByText('Accessed')).toBeNull())
  })

  /**
   * `source.score` means two different things depending on retrieval mode
   * (cosine similarity when local-only; a Reciprocal Rank Fusion value once
   * PubMed is included — see EvidenceColumn.tsx for the backend citations).
   * Rendering an RRF value as a "% match" bar would misrepresent real data,
   * not just look plain, so the bar must disappear the moment fusion ran —
   * regardless of whether score is still numerically present on the source.
   */
  it('shows a match-strength bar when retrieval was local-only', () => {
    render(<EvidenceColumn local={[{ source: LOCAL, index: 1 }]} pubmed={[]} requested fused={false} />)
    expect(screen.getByRole('img', { name: /Match strength 71%/ })).toBeDefined()
  })

  it('hides the match-strength bar once PubMed fusion ran, even though score is still present', () => {
    render(<EvidenceColumn local={[{ source: LOCAL, index: 1 }]} pubmed={[]} requested fused />)
    expect(screen.queryByRole('img', { name: /Match strength/ })).toBeNull()
  })
})
