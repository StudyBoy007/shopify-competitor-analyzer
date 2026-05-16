export default function ProcessingStatus({ active, message }) {
  if (!active) {
    return (
      <div className="process-card idle">
        <span className="process-label">本地 SQLite</span>
        <strong>就绪</strong>
        <p>数据已准备好</p>
      </div>
    );
  }

  return (
    <div className="process-card active" aria-live="polite">
      <div className="walker-stage" aria-hidden="true">
        <div className="walker-shadow" />
        <div className="walker">
          <span className="walker-head" />
          <span className="walker-body" />
          <span className="walker-arm left" />
          <span className="walker-arm right" />
          <span className="walker-leg left" />
          <span className="walker-leg right" />
        </div>
        <div className="walker-path">
          <span />
          <span />
          <span />
        </div>
      </div>
      <span className="process-label">正在工作</span>
      <strong>{message || '处理中'}</strong>
      <p>抓取页面、整理参数、必要时调用 LLM</p>
    </div>
  );
}
