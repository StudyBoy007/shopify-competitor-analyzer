import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import EmptyState from '../components/EmptyState.jsx';
import FuzzySelect from '../components/FuzzySelect.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { formatMoney, formatTime } from '../service/format.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAppContext } from '../store/AppContext.jsx';

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function specValue(spec) {
  if (!spec?.value) return '-';
  return spec.unit && !String(spec.value).toLowerCase().includes(String(spec.unit).toLowerCase())
    ? `${spec.value} ${spec.unit}`
    : spec.value;
}

function mainRankLabel(rank) {
  if (Number(rank) === 1) return '主打1';
  if (Number(rank) === 2) return '主打2';
  if (Number(rank) === 3) return '主打3';
  return '';
}

function SpecValueCell({ spec }) {
  const rankLabel = mainRankLabel(spec?.main_selling_rank);
  return (
    <span className="spec-value-wrap">
      {rankLabel ? <em className={`main-rank-badge rank-${spec.main_selling_rank}`}>{rankLabel}</em> : null}
      <span>{specValue(spec)}</span>
    </span>
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeFileName(value) {
  return String(value || '竞品分析报告')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

export default function ReportsPage() {
  const [ownProducts, setOwnProducts] = useState([]);
  const [ownProductId, setOwnProductId] = useState('');
  const [relations, setRelations] = useState([]);
  const [historyReports, setHistoryReports] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [refreshPrice, setRefreshPrice] = useState(true);
  const [refreshSpecs, setRefreshSpecs] = useState(false);
  const [currentSnapshot, setCurrentSnapshot] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [confirmAnalyze, setConfirmAnalyze] = useState(false);
  const [deleteTargetReport, setDeleteTargetReport] = useState(null);
  const { loading, run } = useAsync();
  const { showNotification } = useAppContext();
  const snapshot = useMemo(
    () => (selectedReport ? parseJson(selectedReport.input_snapshot_json, null) : currentSnapshot),
    [currentSnapshot, selectedReport],
  );
  const analysisComparisons = useMemo(() => {
    const parsed = parseJson(selectedReport?.analysis_json, { comparisons: [], items: [] });
    if (Array.isArray(parsed.comparisons) && parsed.comparisons.length > 0) return parsed.comparisons;
    return [];
  }, [selectedReport]);

  const selectedAll = useMemo(
    () => relations.length > 0 && selectedIds.length === relations.length,
    [relations, selectedIds],
  );

  useEffect(() => {
    api.listReportOwnProducts().then((data) => setOwnProducts(data.products));
  }, []);

  useEffect(() => {
    if (!ownProductId) {
      setRelations([]);
      setSelectedIds([]);
      setHistoryReports([]);
      setCurrentSnapshot(null);
      setSelectedReport(null);
      return;
    }
    Promise.all([
      api.listRelations({ ownProductId }),
      api.listReports({ ownProductId }),
    ]).then(([relationData, reportData]) => {
      const data = relationData;
      setRelations(data.relations);
      setSelectedIds(data.relations.map((relation) => relation.competitor_product_id));
      setHistoryReports(reportData.reports);
      setSelectedReport(null);
    });
  }, [ownProductId]);

  useEffect(() => {
    if (!ownProductId || selectedIds.length === 0) {
      setCurrentSnapshot(null);
      return;
    }
    api.previewReport({
      ownProductId,
      selectedCompetitorProductIds: selectedIds,
    }).then((data) => setCurrentSnapshot(data.snapshot));
  }, [ownProductId, selectedIds]);

  const toggleProduct = (id) => {
    setSelectedReport(null);
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    setSelectedReport(null);
    setSelectedIds(selectedAll ? [] : relations.map((relation) => relation.competitor_product_id));
  };

  const createReport = () => run(async () => {
    const result = await api.createReport({
      ownProductId,
      selectedCompetitorProductIds: selectedIds,
      refreshPrice,
      refreshSpecs,
    });
    if (result.refreshWarnings?.length) {
      showNotification(`有 ${result.refreshWarnings.length} 个商品刷新失败，已沿用已有参数生成报告`, 'info');
    }
    const reportData = await api.listReports({ ownProductId });
    setHistoryReports(reportData.reports);
    setSelectedReport(null);
    const previewData = await api.previewReport({ ownProductId, selectedCompetitorProductIds: selectedIds });
    setCurrentSnapshot(previewData.snapshot);
    if (!result.refreshWarnings?.length) {
      showNotification('报告快照已保存');
    }
  }, null, '报告快照生成中');

  const analyzeReport = () => run(async () => {
    const data = await api.analyzeReport(selectedReport.id);
    setSelectedReport(data.report);
    const reportData = await api.listReports({ ownProductId });
    setHistoryReports(reportData.reports);
  }, '分析结果已生成', 'LLM 分析中');

  const onAnalyze = () => {
    if (!selectedReport) return;
    if (selectedReport.analysis_json) {
      setConfirmAnalyze(true);
      return;
    }
    analyzeReport();
  };

  const selectHistoryReport = async (id) => {
    if (selectedReport?.id === id) {
      setSelectedReport(null);
      return;
    }
    const data = await api.getReport(id);
    setSelectedReport(data.report);
  };

  const clearHistoryReport = () => {
    setSelectedReport(null);
  };

  const deleteHistoryReport = () => run(async () => {
    const reportId = deleteTargetReport.id;
    await api.deleteReport(reportId);
    const reportData = await api.listReports({ ownProductId });
    setHistoryReports(reportData.reports);
    if (selectedReport?.id === reportId) {
      setSelectedReport(null);
    }
    setDeleteTargetReport(null);
  }, '历史报告已删除', '历史报告删除中');

  const downloadExcel = () => {
    if (!snapshot) return;
    const competitors = snapshot.competitorProducts || [];
    const comparisonById = new Map(analysisComparisons.map((item) => [Number(item.competitor_product_id), item]));
    const summaryRows = competitors.length === 0
      ? '<tr><td colspan="2">暂无竞品</td></tr>'
      : competitors.map((product) => {
        const comparison = comparisonById.get(Number(product.id));
        return `
          <tr>
            <td>${escapeHtml(product.title)}</td>
            <td>${escapeHtml(comparison?.conclusion || '未生成分析结果')}</td>
          </tr>
        `;
      }).join('');

    const parameterRows = (snapshot.ownSpecs || []).map((spec) => `
      <tr>
        <td>${escapeHtml(spec.spec_label)}</td>
        <td>${escapeHtml(`${mainRankLabel(spec.main_selling_rank) ? `${mainRankLabel(spec.main_selling_rank)} ` : ''}${specValue(spec)}`)}</td>
        ${competitors.map((product) => {
    const competitorSpec = snapshot.competitorSpecsMap?.[product.id]?.find((item) => item.spec_key === spec.spec_key);
    const rankLabel = mainRankLabel(competitorSpec?.main_selling_rank);
    return `<td>${escapeHtml(`${rankLabel ? `${rankLabel} ` : ''}${specValue(competitorSpec)}`)}</td>`;
  }).join('')}
      </tr>
    `).join('');

    const workbook = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="UTF-8" />
          <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>竞品分析报告</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
          <style>
            table { border-collapse: collapse; font-family: Arial, "Microsoft YaHei", sans-serif; }
            th { background: #1f2937; color: #fff; font-weight: 700; }
            td, th { border: 1px solid #d9e2ef; padding: 8px 10px; vertical-align: top; mso-number-format:"\\@"; }
            .own { background: #eff6ff; color: #1d4ed8; font-weight: 700; }
            .section { background: #e5e7eb; color: #111827; font-weight: 700; }
          </style>
        </head>
        <body>
          <table>
            <tr><th colspan="${Math.max(2, competitors.length + 2)}">竞品分析报告</th></tr>
            <tr><td class="section">我方商品</td><td colspan="${Math.max(1, competitors.length + 1)}">${escapeHtml(snapshot.ownProduct?.title || '-')}</td></tr>
            <tr><td class="section">报告时间</td><td colspan="${Math.max(1, competitors.length + 1)}">${escapeHtml(selectedReport ? formatTime(selectedReport.created_at) : '当前最新参数')}</td></tr>
            <tr><td colspan="${Math.max(2, competitors.length + 2)}"></td></tr>
            <tr><td class="section" colspan="2">总结性对比</td></tr>
            <tr><th>竞品</th><th>分析结果</th></tr>
            ${summaryRows}
            <tr><td colspan="${Math.max(2, competitors.length + 2)}"></td></tr>
            <tr><td class="section" colspan="${Math.max(2, competitors.length + 2)}">参数横向对比</td></tr>
            <tr>
              <th>参数</th>
              <th class="own">${escapeHtml(snapshot.ownProduct?.title || '我方商品')}</th>
              ${competitors.map((product) => `<th>${escapeHtml(product.title)}<br/>${escapeHtml(product.domain || '')}</th>`).join('')}
            </tr>
            ${parameterRows}
          </table>
        </body>
      </html>
    `;

    const blob = new Blob([`\uFEFF${workbook}`], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(snapshot.ownProduct?.title)}-${selectedReport?.id || 'current'}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <h1>分析报告</h1>
          <p>选择一个我方商品，再从已关联竞品中选择参与本次报告的商品。</p>
        </div>
      </header>

      <section className="panel">
        <div className="inline-form wide">
          <FuzzySelect
            label="我方商品"
            value={ownProductId}
            onChange={setOwnProductId}
            options={ownProducts}
            getOptionValue={(product) => product.id}
            getOptionLabel={(product) => `${product.title} / ${product.handle} (${product.relation_count} 个竞品)`}
            getSearchText={(product) => `${product.title} ${product.handle}`}
            placeholder="请选择我方商品"
            emptyText="还没有维护过竞品关系的我方商品"
          />
          <label className="checkbox-line">
            <input type="checkbox" checked={refreshPrice} onChange={(event) => setRefreshPrice(event.target.checked)} />
            生成前刷新价格（我方 + 已勾选竞品）
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={refreshSpecs} onChange={(event) => setRefreshSpecs(event.target.checked)} />
            生成前刷新参数（我方 + 已勾选竞品）
          </label>
          <button className="btn-primary" disabled={!ownProductId || selectedIds.length === 0 || loading} onClick={createReport}>
            {loading ? '生成中...' : '保存本次报告'}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>参与分析的竞品</h2>
          <button onClick={toggleAll} disabled={relations.length === 0}>{selectedAll ? '取消全选' : '全选'}</button>
        </div>
        {relations.length === 0 ? <EmptyState message="当前我方商品还没有维护竞品关系" /> : (
          <div className="choice-list">
            {relations.map((relation) => (
              <label key={relation.id} className="choice-item">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(relation.competitor_product_id)}
                  onChange={() => toggleProduct(relation.competitor_product_id)}
                />
                <span>
                  <strong>{relation.competitor_title}</strong>
                  <small>{relation.competitor_domain} · {formatMoney(relation.competitor_price)}</small>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>历史报告</h2>
          <div className="actions">
            {selectedReport ? <button onClick={clearHistoryReport}>取消历史选择</button> : null}
            {selectedReport ? (
              <button disabled={loading} onClick={onAnalyze}>{selectedReport.analysis_json ? '重新分析结果' : '生成分析结果'}</button>
            ) : <span className="muted">当前展示最新参数；选择历史报告后可生成/查看总结</span>}
          </div>
        </div>
        {historyReports.length === 0 ? <EmptyState message="当前商品还没有历史分析报告" /> : (
          <div className="report-history-list">
            {historyReports.map((item) => {
              const itemSnapshot = parseJson(item.input_snapshot_json, {});
              const count = itemSnapshot.competitorProducts?.length || 0;
              return (
                <div
                  key={item.id}
                  className={selectedReport?.id === item.id ? 'selected' : ''}
                >
                  <button type="button" onClick={() => selectHistoryReport(item.id)}>
                    <strong>{formatTime(item.created_at)}</strong>
                    <span>{count} 个竞品 · {item.analysis_json ? '已分析' : '未分析'}</span>
                  </button>
                  <button
                    type="button"
                    className="history-delete-button"
                    onClick={() => setDeleteTargetReport(item)}
                  >
                    删除
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {snapshot && (
        <section className="panel report-panel compare-report-panel">
          <div className="section-title">
            <h2>{selectedReport ? '历史报告结果' : '当前最新参数对比'}</h2>
            <div className="actions">
              <button disabled={!snapshot} onClick={downloadExcel}>下载 Excel</button>
              <span className="badge">{selectedReport ? (selectedReport.provider ? `${selectedReport.provider} / ${selectedReport.model}` : '历史快照') : '当前最新'}</span>
            </div>
          </div>
          <div className="analysis-summary">
            <div className="analysis-summary-title">总结性对比</div>
            {selectedReport ? (
              analysisComparisons.length === 0 ? (
                <div className="analysis-empty">点击“生成分析结果”，让 LLM 输出我方 vs 每个竞品的极简结论。</div>
              ) : (
                <div className="analysis-summary-grid">
                  {analysisComparisons.map((item) => (
                    <div className="analysis-summary-card" key={item.competitor_product_id}>
                      <span>{item.competitor_title}</span>
                      <strong>{item.conclusion}</strong>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="analysis-empty">当前最新参数不包含历史分析总结；保存本次报告后，在历史报告中生成分析结果。</div>
            )}
          </div>
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>参数</th>
                  <th className="own-col">{snapshot.ownProduct?.title || '我方商品'}</th>
                  {(snapshot.competitorProducts || []).map((product) => (
                    <th key={product.id}>{product.title}<span>{product.domain}</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(snapshot.ownSpecs || []).map((spec) => (
                  <tr key={spec.spec_key}>
                    <td className="spec-label-cell">{spec.spec_label}</td>
                    <td className="own-col"><SpecValueCell spec={spec} /></td>
                    {(snapshot.competitorProducts || []).map((product) => {
                      const competitorSpec = snapshot.competitorSpecsMap?.[product.id]?.find((item) => item.spec_key === spec.spec_key);
                      return <td key={product.id}><SpecValueCell spec={competitorSpec} /></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmAnalyze}
        title="重新生成分析结果？"
        description="这份报告已经有分析结果。重新分析会再次调用 LLM，并覆盖当前分析结果。"
        confirmText="重新分析"
        cancelText="保留现有分析"
        onCancel={() => setConfirmAnalyze(false)}
        onConfirm={() => {
          setConfirmAnalyze(false);
          analyzeReport();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTargetReport)}
        title="删除历史报告？"
        description="删除后，这份历史快照和已生成的分析结果都会移除。商品、参数和竞品关系不会受影响。"
        detail={deleteTargetReport ? `报告时间：${formatTime(deleteTargetReport.created_at)}` : ''}
        confirmText="删除"
        cancelText="取消"
        danger
        onCancel={() => setDeleteTargetReport(null)}
        onConfirm={deleteHistoryReport}
      />
    </div>
  );
}
