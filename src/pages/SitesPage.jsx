import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FuzzySelect from '../components/FuzzySelect.jsx';
import { formatMoney, formatTime } from '../service/format.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAppContext } from '../store/AppContext.jsx';

const RULE_PROMPT_TEMPLATE = `这是竞品分析平台的站点专属规格提取规则问题。请看项目里的 规则配置说明.md。
这个落地页默认解析不准：{落地页 URL}
请帮我生成一份可以粘贴到“站点管理 -> 规则配置”的 JSON，并说明我应该怎么测试。`;

export default function SitesPage() {
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({ domain: '', minProductPrice: 300 });
  const [priceDrafts, setPriceDrafts] = useState({});
  const [ruleEditor, setRuleEditor] = useState({
    open: false,
    site: null,
    ruleText: '',
    products: [],
    productId: '',
    preview: null,
  });
  const [ruleTipOpen, setRuleTipOpen] = useState(false);
  const { loading, run } = useAsync();
  const { showNotification } = useAppContext();

  const refresh = async () => {
    const data = await api.listSites();
    setSites(data.sites);
    setPriceDrafts(
      Object.fromEntries(data.sites.map((site) => [site.id, (Number(site.min_product_price) / 100).toString()])),
    );
  };

  useEffect(() => {
    refresh();
  }, []);

  const createSite = () => run(async () => {
    await api.createSite(form);
    setForm({ domain: '', minProductPrice: 300 });
    await refresh();
  }, '站点已添加', '站点保存中');

  const syncSite = (site) => run(async () => {
    const result = await api.syncProducts(site.id);
    await refresh();
    return result;
  }, '商品同步完成', '商品同步中');

  const setOwn = (site) => run(async () => {
    await api.setOwnSite(site.id);
    await refresh();
  }, '我方站点已设置');

  const unsetOwn = (site) => run(async () => {
    await api.unsetOwnSite(site.id);
    await refresh();
  }, '已取消我方站点');

  const saveMinPrice = (site) => run(async () => {
    await api.updateSite(site.id, { minProductPrice: priceDrafts[site.id] || 300 });
    await refresh();
  }, '最低价格已更新');

  const openRuleEditor = (site) => run(async () => {
    const [ruleData, productData] = await Promise.all([
      api.getSiteExtractRule(site.id),
      api.listProducts({ siteId: site.id }),
    ]);
    const products = productData.products || [];
    setRuleEditor({
      open: true,
      site,
      ruleText: ruleData.ruleJson || JSON.stringify(ruleData.defaultRule, null, 2),
      products,
      productId: products[0]?.id ? String(products[0].id) : '',
      preview: null,
    });
  }, null, '规则加载中');

  const closeRuleEditor = () => {
    setRuleEditor({
      open: false,
      site: null,
      ruleText: '',
      products: [],
      productId: '',
      preview: null,
    });
    setRuleTipOpen(false);
  };

  const saveRule = () => run(async () => {
    await api.saveSiteExtractRule(ruleEditor.site.id, { ruleJson: ruleEditor.ruleText });
    await refresh();
  }, '提取规则已保存', '规则保存中');

  const testRule = () => run(async () => {
    const result = await api.testSiteExtractRule(ruleEditor.site.id, {
      ruleJson: ruleEditor.ruleText,
      productId: ruleEditor.productId,
    });
    setRuleEditor((prev) => ({ ...prev, preview: result }));
  }, '规则测试完成', '规则测试中');

  const copyRulePrompt = async () => {
    await navigator.clipboard.writeText(RULE_PROMPT_TEMPLATE);
    showNotification('提醒话术已复制');
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <h1>站点管理</h1>
          <p>录入 Shopify 独立站，按价格阈值过滤商品，并排除 Seel 保险商品。</p>
        </div>
      </header>

      <section className="panel">
        <div className="inline-form">
          <label>
            独立站域名
            <input
              value={form.domain}
              onChange={(event) => setForm((prev) => ({ ...prev, domain: event.target.value }))}
              placeholder="https://example.com"
            />
          </label>
          <label>
            最低价格
            <input
              type="number"
              min="0"
              value={form.minProductPrice}
              onChange={(event) => setForm((prev) => ({ ...prev, minProductPrice: event.target.value }))}
            />
          </label>
          <button className="btn-primary" disabled={loading || !form.domain} onClick={createSite}>添加站点</button>
        </div>
      </section>

      <div className="table-container">
        {loading && sites.length === 0 ? <Loading /> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>域名</th>
                <th>最低价格</th>
                <th>商品数</th>
                <th>我方站点</th>
                <th>最近同步</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sites.length === 0 ? (
                <tr><td colSpan="6"><EmptyState /></td></tr>
              ) : sites.map((site) => (
                <tr key={site.id}>
                  <td>{site.domain}</td>
                  <td>
                    <div className="inline-edit">
                      <input
                        type="number"
                        min="0"
                        value={priceDrafts[site.id] ?? ''}
                        onChange={(event) => setPriceDrafts((prev) => ({ ...prev, [site.id]: event.target.value }))}
                      />
                      <span>{formatMoney(site.min_product_price)}</span>
                    </div>
                  </td>
                  <td>
                    {site.product_count}
                    {site.hidden_product_count ? <span className="muted">（隐藏 {site.hidden_product_count}）</span> : null}
                  </td>
                  <td>{site.is_own_site ? <span className="badge success">我方</span> : '-'}</td>
                  <td>{formatTime(site.last_product_sync_at)}</td>
                  <td className="row-actions">
                    <button onClick={() => saveMinPrice(site)}>保存价格</button>
                    <button onClick={() => syncSite(site)}>同步商品</button>
                    <button onClick={() => openRuleEditor(site)}>规则配置</button>
                    {site.is_own_site ? (
                      <button className="text-warning" onClick={() => unsetOwn(site)}>取消我方</button>
                    ) : (
                      <button onClick={() => setOwn(site)}>设为我方</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {ruleEditor.open ? (
        <div className="dialog-overlay" role="presentation" onMouseDown={closeRuleEditor}>
          <div className="rule-dialog" role="dialog" aria-modal="true" aria-labelledby="rule-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-ribbon">站点专属规则</div>
            <div className="dialog-body">
              <div className="rule-title-row">
                <h2 id="rule-dialog-title">{ruleEditor.site.domain}</h2>
                <div
                  className="rule-tip"
                  onMouseEnter={() => setRuleTipOpen(true)}
                  onMouseLeave={() => setRuleTipOpen(false)}
                >
                  <button
                    className="rule-tip-button"
                    type="button"
                    aria-label="查看给 Codex 的提醒话术"
                    aria-expanded={ruleTipOpen}
                    onClick={() => setRuleTipOpen((prev) => !prev)}
                  >
                    !
                  </button>
                  {ruleTipOpen ? (
                    <div className="rule-tip-popover" role="tooltip">
                      <strong>下次找 Codex 生成规则时，复制这段话</strong>
                      <pre>{RULE_PROMPT_TEMPLATE}</pre>
                      <button type="button" onClick={copyRulePrompt}>复制话术</button>
                    </div>
                  ) : null}
                </div>
              </div>
              <p>配置落地页规格文本的本地提取规则。保存后，该站点后续“解析参数”和“刷新参数”都会先按这份规则抽取文本，再交给 LLM。</p>
            </div>

            <div className="rule-editor-grid">
              <label className="rule-field">
                规则 JSON
                <textarea
                  value={ruleEditor.ruleText}
                  onChange={(event) => setRuleEditor((prev) => ({ ...prev, ruleText: event.target.value }))}
                  spellCheck="false"
                />
              </label>

              <div className="rule-side">
                <FuzzySelect
                  className="rule-field"
                  label="测试商品"
                  value={ruleEditor.productId}
                  onChange={(productId) => setRuleEditor((prev) => ({ ...prev, productId, preview: null }))}
                  options={ruleEditor.products}
                  getOptionValue={(product) => product.id}
                  getOptionLabel={(product) => `${product.title || product.handle} / ${product.handle}`}
                  getSearchText={(product) => `${product.title} ${product.handle}`}
                  placeholder={ruleEditor.products.length === 0 ? '暂无商品，请先同步商品' : '请选择测试商品'}
                  emptyText="没有匹配的测试商品"
                  disabled={ruleEditor.products.length === 0}
                />

                <div className="rule-help">
                  <strong>可配置字段</strong>
                  <span>keywords：命中这些标题后开始截取</span>
                  <span>takeLines：每次命中后最多取多少行</span>
                  <span>excludeKeywords：遇到这些词提前停止</span>
                  <span>fallbackLines：没命中时兜底取页面前多少行</span>
                  <span>maxChars：最终送入 LLM 的最大字符数</span>
                </div>

                <button disabled={loading || !ruleEditor.productId} onClick={testRule}>测试提取</button>
              </div>
            </div>

            {ruleEditor.preview ? (
              <div className="rule-preview">
                <div className="rule-preview-meta">
                  <span>字符数：{ruleEditor.preview.length}</span>
                  <span>Hash：{ruleEditor.preview.hash}</span>
                </div>
                <pre>{ruleEditor.preview.text || '没有提取到文本'}</pre>
              </div>
            ) : null}

            <div className="dialog-actions">
              <button className="btn-ghost" onClick={closeRuleEditor}>关闭</button>
              <button className="btn-dialog-primary" disabled={loading} onClick={saveRule}>保存规则</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
