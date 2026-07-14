import ContractChangesSection from './ContractChangesSection.jsx'
import OriginalContractSection from './OriginalContractSection.jsx'

function formatYen(value) {
  const amount = Number(value)
  return `¥${(Number.isFinite(amount) ? amount : 0).toLocaleString('ja-JP')}`
}

export default function ContractRevenuePage({
  project,
  revenueSnapshot,
  contractChanges,
  currentUser,
  onProjectChange,
  onCreateContractChange,
  onVoidContractChange,
  onBack,
}) {
  if (!project) {
    return (
      <main className="app-shell page-shell">
        <header className="page-header">
          <button className="back-button" type="button" onClick={onBack}>
            返回工程项目
          </button>
          <div>
            <p className="eyebrow dark-text">合同收入</p>
            <h1>项目不存在</h1>
          </div>
        </header>
        <div className="empty-state">未找到所选项目，请返回工程项目重新选择。</div>
      </main>
    )
  }

  return (
    <main className="app-shell page-shell contract-revenue-page">
      <header className="page-header">
        <button className="back-button" type="button" onClick={onBack}>
          返回工程项目
        </button>
        <div>
          <p className="eyebrow dark-text">合同收入</p>
          <h1>{project.projectName}</h1>
          <span className="page-subtitle">
            {project.projectId}｜{project.customerName || '未填写客户'}
          </span>
        </div>
      </header>

      <div className="stats-grid contract-revenue-overview">
        <div className="stat-card money">
          <strong>{formatYen(revenueSnapshot?.adjustedTaxInclusiveAmount)}</strong>
          <span>当前合同金额（税込）</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(revenueSnapshot?.totalReceivedTaxInclusiveAmount)}</strong>
          <span>累计实际收款</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(revenueSnapshot?.outstandingTaxInclusiveAmount)}</strong>
          <span>未收款金额</span>
        </div>
      </div>

      <OriginalContractSection
        project={project}
        currentUser={currentUser}
        onProjectChange={onProjectChange}
      />

      <ContractChangesSection
        project={project}
        contractChanges={contractChanges}
        currentUser={currentUser}
        onCreateContractChange={onCreateContractChange}
        onVoidContractChange={onVoidContractChange}
      />
    </main>
  )
}
