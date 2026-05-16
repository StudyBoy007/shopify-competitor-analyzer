import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';
import { formatMoney, formatSourceType, formatTime } from '../service/format.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAppContext } from '../store/AppContext.jsx';

function normalizeDraftRanks(specs) {
  const usedRanks = new Set();
  return Object.fromEntries(specs.map((spec) => {
    const rank = String(spec.main_selling_rank || '');
    if (!['1', '2', '3'].includes(rank) || usedRanks.has(rank)) {
      return [spec.spec_key, ''];
    }
    usedRanks.add(rank);
    return [spec.spec_key, rank];
  }));
}

export default function ProductSpecsPage() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [specs, setSpecs] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [draftRanks, setDraftRanks] = useState({});
  const [latestExtraction, setLatestExtraction] = useState(null);
  const { loading, run } = useAsync();
  const { showNotification } = useAppContext();
  const displaySpecs = useMemo(() => [...specs].sort((a, b) => {
    const rankA = Number(draftRanks[a.spec_key] || 99);
    const rankB = Number(draftRanks[b.spec_key] || 99);
    if (rankA !== rankB) return rankA - rankB;
    return Number(a.spec_order || 0) - Number(b.spec_order || 0);
  }), [draftRanks, specs]);
  const changedSpecs = useMemo(() => specs.map((spec) => {
    const changes = [];
    if ((drafts[spec.spec_key] || '') !== (spec.value || '')) changes.push('值');
    if (String(draftRanks[spec.spec_key] || '') !== String(spec.main_selling_rank || '')) changes.push('主打');
    return { spec, changes };
  }).filter((item) => item.changes.length > 0), [draftRanks, drafts, specs]);
  const changedSummary = changedSpecs
    .slice(0, 4)
    .map(({ spec, changes }) => `${spec.spec_label}（${changes.join('+')}）`)
    .join('、');

  const refresh = async () => {
    const data = await api.getProduct(id);
    setProduct(data.product);
    setSpecs(data.specs);
    setDrafts(Object.fromEntries(data.specs.map((spec) => [spec.spec_key, spec.value || ''])));
    setDraftRanks(normalizeDraftRanks(data.specs));
    setLatestExtraction(data.latestExtraction);
  };

  useEffect(() => {
    refresh();
  }, [id]);

  const extract = () => run(async () => {
    const result = await api.extractSpecs(id);
    if (result.skipped) {
      showNotification('落地页规格内容未变化，已跳过 LLM 调用', 'info');
    } else {
      showNotification('参数解析完成');
    }
    await refresh();
    return result;
  }, null, '参数解析中');

  const saveAllSpecs = () => run(async () => {
    const pendingSpecs = changedSpecs.map(({ spec }) => ({
      specKey: spec.spec_key,
      value: drafts[spec.spec_key] || null,
      unit: spec.unit,
      rawText: drafts[spec.spec_key] || null,
      conflict: false,
      mainSellingRank: draftRanks[spec.spec_key] || null,
    }));
    const data = await api.updateSpecs(id, { specs: pendingSpecs });
    setSpecs(data.specs);
    setDrafts(Object.fromEntries(data.specs.map((item) => [item.spec_key, item.value || ''])));
    setDraftRanks(normalizeDraftRanks(data.specs));
  }, '参数已保存');

  const changeMainRank = (specKey, nextRank) => {
    setDraftRanks((prev) => Object.fromEntries(
      Object.entries(prev).map(([key, rank]) => {
        if (key === specKey) return [key, nextRank];
        return nextRank && rank === nextRank ? [key, ''] : [key, rank];
      }),
    ));
  };

  if (!product) {
    return <div className="page-container"><Loading /></div>;
  }

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <h1>商品参数</h1>
          <p>{product.title}</p>
        </div>
        <div className="actions">
          <Link className="btn-link" to="/products">返回商品列表</Link>
          <button className="btn-primary" disabled={loading} onClick={extract}>刷新参数</button>
          <button disabled={loading || changedSpecs.length === 0} onClick={saveAllSpecs}>
            {changedSpecs.length > 0 ? `保存全部（${changedSpecs.length}）` : '保存全部'}
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="info-list">
          <div><span>站点</span><strong>{product.domain}</strong></div>
          <div><span>价格</span><strong>{formatMoney(product.price)}</strong></div>
          <div><span>划线价</span><strong>{formatMoney(product.compare_at_price)}</strong></div>
          <div><span>最近解析</span><strong>{formatTime(latestExtraction?.created_at)}</strong></div>
        </div>
      </section>

      <div className="table-container">
        <div className="main-rank-hint">
          <span>主打 1/2/3 各只能选择一个参数；选择同等级时，标记会自动转移到当前参数。</span>
          <strong>
            {changedSpecs.length > 0
              ? `待保存：${changedSummary}${changedSpecs.length > 4 ? ` 等 ${changedSpecs.length} 项` : ''}`
              : '暂无未保存调整'}
          </strong>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>顺序</th>
              <th>参数</th>
              <th>值</th>
              <th>主打参数</th>
              <th>来源</th>
              <th>置信度</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {displaySpecs.map((spec) => (
              <tr key={spec.spec_key}>
                <td>{spec.spec_order}</td>
                <td>{spec.spec_label}</td>
                <td>
                  <input
                    className="spec-edit-input"
                    value={drafts[spec.spec_key] ?? ''}
                    placeholder="未获取"
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [spec.spec_key]: event.target.value }))}
                  />
                </td>
                <td>
                  <select
                    className={`main-rank-select rank-${draftRanks[spec.spec_key] || 'none'}`}
                    value={draftRanks[spec.spec_key] || ''}
                    onChange={(event) => changeMainRank(spec.spec_key, event.target.value)}
                  >
                    <option value="">普通参数</option>
                    <option value="1">主打 1 · 最核心</option>
                    <option value="2">主打 2 · 次核心</option>
                    <option value="3">主打 3 · 第三主打</option>
                  </select>
                </td>
                <td>{formatSourceType(spec.source_type)}</td>
                <td>{spec.confidence ? Number(spec.confidence).toFixed(2) : '-'}</td>
                <td>
                  {spec.manually_verified ? <span className="badge success">人工确认</span> : null}
                  {spec.conflict ? <span className="badge warning">冲突</span> : null}
                  {!spec.manually_verified && !spec.conflict ? '-' : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
