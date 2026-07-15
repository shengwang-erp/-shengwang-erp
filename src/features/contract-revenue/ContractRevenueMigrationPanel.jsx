import { useState } from 'react'

function ProjectIssueList({ title, items, tone = '' }) {
  if (!items?.length) return null

  return (
    <div className={`migration-issue-list ${tone}`.trim()}>
      <strong>{title}</strong>
      {items.map((item, index) => (
        <span key={`${item.projectId || 'unknown'}:${item.code || index}`}>
          {item.projectId ? `${item.projectId}：` : ''}
          {item.message}
        </span>
      ))}
    </div>
  )
}

export default function ContractRevenueMigrationPanel({
  canExecute,
  onMigrationComplete,
  loadPreview,
  executeMigration,
}) {
  const [preview, setPreview] = useState(null)
  const [execution, setExecution] = useState(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [error, setError] = useState('')

  const handlePreview = () => {
    try {
      setPreview(loadPreview ? loadPreview() : null)
      setExecution(null)
      setError('')
    } catch (previewError) {
      setPreview(null)
      setExecution(null)
      setError(previewError?.message || '本地合同数据预览失败')
    }
  }

  const handleExecute = async () => {
    if (!canExecute || !preview || preview.migrationProjectCount < 1) return
    const confirmed = window.confirm(
      `即将通过云端安全事务迁移 ${preview.migrationProjectCount} 个项目，确定继续吗？`,
    )
    if (!confirmed) return

    setIsExecuting(true)
    setExecution(null)
    setError('')
    try {
      if (typeof executeMigration !== 'function') throw new Error('云端迁移安全RPC未配置')
      const result = await executeMigration(preview)
      setExecution(result)
      setPreview(loadPreview ? loadPreview() : preview)
      onMigrationComplete?.(result)
    } catch (migrationError) {
      setError(migrationError?.message || '本地合同数据迁移失败')
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <section className="form-card contract-revenue-migration-panel">
      <div className="section-heading">
        <h2>旧合同收入数据迁移</h2>
        <span>{canExecute ? '最高权限可用' : '无权限'}</span>
      </div>

      <div className="warning-note contract-warning" role="alert">
        迁移通过服务端安全事务执行，结果以服务器返回为准
      </div>
      <div className="empty-state cost-note">
        仅管理员可执行；预览不会写入，执行后支持幂等重试。
      </div>

      <div className="form-actions">
        <button
          className="ghost-button"
          type="button"
          onClick={handlePreview}
          disabled={isExecuting}
        >
          {preview ? '重新只读预览' : '只读预览'}
        </button>
      </div>

      {error && <div className="form-error contract-message">{error}</div>}

      {preview && (
        <div className="contract-migration-preview">
          <div className="migration-summary-grid">
            <article>
              <strong>{preview.migrationProjectCount}</strong>
              <span>可迁移项目</span>
            </article>
            <article>
              <strong>{preview.openingReceiptCount}</strong>
              <span>待生成期初收款</span>
            </article>
            <article>
              <strong>{preview.warnings.length}</strong>
              <span>警告</span>
            </article>
            <article>
              <strong>{preview.exceptions.length}</strong>
              <span>异常项目</span>
            </article>
          </div>

          <ProjectIssueList title="预览警告" items={preview.warnings} />
          <ProjectIssueList
            title="异常项目（不会自动迁移）"
            items={preview.exceptions}
            tone="error"
          />

          <div className="form-actions">
            <button
              className="primary-button"
              type="button"
              onClick={handleExecute}
              disabled={
                !canExecute || isExecuting || preview.migrationProjectCount < 1
              }
            >
              {isExecuting ? '迁移中...' : '执行云端迁移'}
            </button>
          </div>
        </div>
      )}

      {execution && (
        <div className="contract-migration-result">
          <div className="contract-success contract-message">
            云端迁移结束：成功 {execution.migratedProjectCount} 个，失败{' '}
            {execution.failedProjectCount} 个。备份版本{' '}
              {execution.serverReceipt || execution.idempotencyKey || '已生成服务器回执'}。
          </div>
          <div className="record-list">
            {execution.projectResults.map((result) => (
              <article className="record-card" key={result.projectId}>
                <strong>{result.projectId || '未知项目'}</strong>
                <span>{result.status === 'migrated' ? '迁移成功' : '迁移失败'}</span>
                {result.error && <span className="form-error">{result.error}</span>}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
