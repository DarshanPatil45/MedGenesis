import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EvidenceSource } from '../api/types'
import { EvidenceCitations } from './EvidenceCitation'

const LOCAL_SOURCE: EvidenceSource = {
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

const PUBMED_SOURCE: EvidenceSource = {
  text: 'Findings from a randomized trial.',
  document_id: 'pubmed#12345678',
  section: 'Abstract',
  title: 'Physical activity and diabetes risk: a review',
  publisher: 'Diabetes Care',
  source_url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
  accessed: '2026-08-27',
  license: '',
  attribution: '',
  score: 1.0,
  source_type: 'pubmed',
  doi: '10.1000/example.doi',
}

describe('EvidenceCitations', () => {
  it('renders nothing for an empty list', () => {
    const { container } = render(<EvidenceCitations evidence={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('numbers citations starting at E1 and stays collapsed by default', () => {
    render(<EvidenceCitations evidence={[LOCAL_SOURCE, PUBMED_SOURCE]} />)
    expect(screen.getByText(/\[E1\] Diabetes Basics/)).toBeDefined()
    expect(screen.getByText(/\[E2\] Physical activity and diabetes risk/)).toBeDefined()
    expect(screen.queryByText(/Document ID/)).toBeNull()
  })

  it('expanding a local source shows metadata but no PMID/DOI', () => {
    render(<EvidenceCitations evidence={[LOCAL_SOURCE]} />)
    fireEvent.click(screen.getByText(/\[E1\]/))
    expect(screen.getByText('cdc_diabetes_basics#physical-activity')).toBeDefined()
    expect(screen.getByText('2026-08-23')).toBeDefined()
    expect(screen.queryByText('PMID')).toBeNull()
    expect(screen.queryByText('DOI')).toBeNull()
  })

  it('expanding a PubMed source shows PMID and DOI, never fabricated', () => {
    render(<EvidenceCitations evidence={[PUBMED_SOURCE]} />)
    fireEvent.click(screen.getByText(/\[E1\]/))
    expect(screen.getByText('PMID')).toBeDefined()
    expect(screen.getByText('12345678')).toBeDefined()
    expect(screen.getByText('DOI')).toBeDefined()
    expect(screen.getByText('10.1000/example.doi')).toBeDefined()
  })

  it('omits DOI row entirely when the source has none', () => {
    render(<EvidenceCitations evidence={[{ ...PUBMED_SOURCE, doi: '' }]} />)
    fireEvent.click(screen.getByText(/\[E1\]/))
    expect(screen.queryByText('DOI')).toBeNull()
  })

  it('collapses again on a second click', () => {
    render(<EvidenceCitations evidence={[LOCAL_SOURCE]} />)
    const toggle = screen.getByText(/\[E1\]/)
    fireEvent.click(toggle)
    expect(screen.getByText('Document ID')).toBeDefined()
    fireEvent.click(toggle)
    expect(screen.queryByText('Document ID')).toBeNull()
  })
})
