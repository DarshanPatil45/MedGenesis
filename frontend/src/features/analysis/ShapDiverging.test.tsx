import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseNamedList, parseSignedFeatures, RankedFeatureList, ShapDiverging } from './ShapDiverging'

describe('parseSignedFeatures', () => {
  it('extracts the real signed pairs the backend rendered into prose', () => {
    const text =
      "For this patient, the top MODEL FEATURE CONTRIBUTIONS to the XGBoost candidate model's score (SHAP values): GenHlth (-1.289), Age (-1.190), BMI (+0.631)."
    expect(parseSignedFeatures(text)).toEqual([
      { name: 'GenHlth', value: -1.289 },
      { name: 'Age', value: -1.19 },
      { name: 'BMI', value: 0.631 },
    ])
  })

  it('yields nothing for unsigned text rather than inventing a direction', () => {
    expect(parseSignedFeatures('BMI (0.631), Age (1.19)')).toEqual([])
  })
})

describe('parseNamedList', () => {
  it('extracts ranked names after the final colon', () => {
    const text =
      'Top model feature contributions for the production RandomForest model (aggregate, not specific to this patient): GenHlth, HighBP, BMI, HighChol, Age.'
    expect(parseNamedList(text)).toEqual(['GenHlth', 'HighBP', 'BMI', 'HighChol', 'Age'])
  })
})

describe('RankedFeatureList', () => {
  it('shows rank position only — the production model returns no magnitudes', () => {
    render(<RankedFeatureList text="Top features: GenHlth, HighBP, BMI." />)
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1GenHlth', '2HighBP', '3BMI'])
    expect(screen.queryByText(/0\.\d/)).toBeNull()
  })

  it('falls back to the plain claim when nothing parses', () => {
    render(<RankedFeatureList text="No colon here" />)
    expect(screen.getByText('No colon here')).toBeDefined()
  })
})

describe('ShapDiverging', () => {
  it('renders real signed values with their direction described in words', () => {
    render(
      <ShapDiverging text="SHAP values: HighChol (-0.369), HighBP (+0.353), GenHlth (+0.246)." />,
    )
    expect(screen.getByText('+0.353')).toBeDefined()
    expect(screen.getByText('-0.369')).toBeDefined()
    // Direction must not be conveyed by colour alone.
    expect(screen.getByText(/pushed this patient's predicted score up or down/)).toBeDefined()
    expect(screen.getByText(/do not establish\s+causality/)).toBeDefined()
  })

  it('falls back to plain text when the model returns no signed values', () => {
    render(<ShapDiverging text="No per-patient SHAP values are available for this model." />)
    expect(screen.getByText('No per-patient SHAP values are available for this model.')).toBeDefined()
  })
})
