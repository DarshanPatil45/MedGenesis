import { GitCompare } from 'lucide-react'
import type { ClinicalAnalysis, ModelComparison } from '../../api/types'
import { RiskBadge } from '../common'

const COMPARISON_METRICS: [string, string][] = [
  ['accuracy', 'Accuracy'],
  ['precision', 'Precision'],
  ['recall', 'Recall'],
  ['f1', 'F1'],
  ['roc_auc', 'ROC-AUC'],
]

function ModelComparisonTable({ comparison }: { comparison: ModelComparison }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>RandomForest (production)</th>
            <th>XGBoost (candidate)</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_METRICS.map(([key, label]) => {
            const row = comparison.metrics_table[key]
            if (!row) return null
            return (
              <tr key={key}>
                <td>{label}</td>
                <td>{row.random_forest?.toFixed(4) ?? '—'}</td>
                <td>{row.xgboost?.toFixed(4) ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: '0.76rem', marginTop: '0.5rem', marginBottom: 0 }}>
        From a fixed historical test set of {comparison.n_test.toLocaleString()} records — not a
        statement about this specific patient. Values are supplied by the backend, never
        recomputed in the browser.
      </p>
    </div>
  )
}

const modelPillStyle = (kind: 'production' | 'candidate'): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.14rem 0.55rem',
  borderRadius: 999,
  fontSize: '0.68rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  marginLeft: '0.5rem',
  verticalAlign: 'middle',
  ...(kind === 'production'
    ? { background: 'var(--brand-gradient)', color: '#fff' }
    : { background: 'transparent', color: 'var(--muted)', border: '1px dashed var(--border)' }),
})

export function ModelResults({
  result,
  comparison,
  includeModelComparison,
}: {
  result: ClinicalAnalysis
  comparison: ModelComparison | null
  includeModelComparison: boolean
}) {
  const rfClaim = result.model_analysis.find(
    (c) => c.claim.includes('production RandomForest') && c.claim.includes('assigned a score'),
  )
  const xgbClaim = result.model_analysis.find(
    (c) => c.claim.includes('XGBoost candidate model') && c.claim.includes('assigned a score'),
  )
  const conflictClaim = result.model_analysis.find(
    (c) => c.claim_type === 'uncertainty' && c.claim.includes('different risk tiers'),
  )
  const comparisonClaim = result.model_analysis.find((c) => c.claim.includes('Model evaluation metrics'))

  return (
    <>
      <div className="grid-2">
        <div>
          <div className="row" style={{ gap: 0 }}>
            <h3 style={{ margin: 0 }}>Production model — RandomForest</h3>
            <span style={modelPillStyle('production')}>PRODUCTION</span>
          </div>
          {rfClaim ? <p>{rfClaim.claim}</p> : <p className="muted">Not available for this profile.</p>}
          {result.production_risk_tier && <RiskBadge tier={result.production_risk_tier} />}
        </div>
        <div>
          <div className="row" style={{ gap: 0 }}>
            <h3 style={{ margin: 0 }}>Candidate model — XGBoost</h3>
            <span style={modelPillStyle('candidate')}>CANDIDATE</span>
          </div>
          {includeModelComparison ? (
            xgbClaim ? <p>{xgbClaim.claim}</p> : <p className="muted">Not available for this profile.</p>
          ) : (
            <p className="muted">Not requested for this analysis.</p>
          )}
        </div>
      </div>
      {conflictClaim && (
        <div className="banner flagged" style={{ marginTop: '0.6rem' }}>
          {conflictClaim.claim}
        </div>
      )}
      {comparison ? (
        <>
          <h3 className="row" style={{ marginTop: '1rem', gap: '0.4rem' }}>
            <GitCompare size={15} style={{ color: 'var(--brand)' }} /> Model evaluation metrics
          </h3>
          <ModelComparisonTable comparison={comparison} />
        </>
      ) : (
        includeModelComparison &&
        comparisonClaim && (
          <p className="muted" style={{ marginTop: '0.8rem', fontSize: '0.82rem' }}>
            {comparisonClaim.claim}
          </p>
        )
      )}
    </>
  )
}
