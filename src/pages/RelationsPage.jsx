import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import EmptyState from '../components/EmptyState.jsx';
import Loading from '../components/Loading.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import FuzzySelect from '../components/FuzzySelect.jsx';
import { formatMoney } from '../service/format.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAppContext } from '../store/AppContext.jsx';

const PAGE_SIZE = 10;

function Pagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
  return (
    <div className="pagination">
      <span>共 {total || 0} 条，第 {page} / {totalPages} 页</span>
      <div>
        <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button>
        <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页</button>
      </div>
    </div>
  );
}

export default function RelationsPage() {
  const [ownProducts, setOwnProducts] = useState([]);
  const [sites, setSites] = useState([]);
  const [competitorProducts, setCompetitorProducts] = useState([]);
  const [relations, setRelations] = useState([]);
  const [ownProductId, setOwnProductId] = useState('');
  const [competitorSiteId, setCompetitorSiteId] = useState('');
  const [competitorQuery, setCompetitorQuery] = useState('');
  const [competitorPage, setCompetitorPage] = useState(1);
  const [competitorTotal, setCompetitorTotal] = useState(0);
  const [relationQuery, setRelationQuery] = useState('');
  const [relationPage, setRelationPage] = useState(1);
  const [relationTotal, setRelationTotal] = useState(0);
  const [pendingCompetitor, setPendingCompetitor] = useState(null);
  const { loading, run } = useAsync();
  const { showNotification } = useAppContext();

  const competitorSites = useMemo(() => sites.filter((site) => !site.is_own_site), [sites]);

  const refreshBase = async () => {
    const [siteData, ownData] = await Promise.all([
      api.listSites(),
      api.listProducts({ ownOnly: true }),
    ]);
    setSites(siteData.sites);
    setOwnProducts(ownData.products);
  };

  const refreshRelations = async () => {
    if (!ownProductId) {
      setRelations([]);
      setRelationTotal(0);
      return;
    }
    const data = await api.listRelations({
      ownProductId,
      q: relationQuery,
      page: relationPage,
      pageSize: PAGE_SIZE,
    });
    setRelations(data.relations);
    setRelationTotal(data.total || 0);
  };

  const refreshCompetitors = async () => {
    if (!competitorSiteId) {
      setCompetitorProducts([]);
      setCompetitorTotal(0);
      return;
    }
    const data = await api.listProducts({
      siteId: competitorSiteId,
      q: competitorQuery,
      page: competitorPage,
      pageSize: PAGE_SIZE,
    });
    setCompetitorProducts(data.products);
    setCompetitorTotal(data.total || 0);
  };

  useEffect(() => {
    refreshBase();
  }, []);

  useEffect(() => {
    refreshRelations();
  }, [ownProductId, relationQuery, relationPage]);

  useEffect(() => {
    refreshCompetitors();
  }, [competitorSiteId, competitorQuery, competitorPage]);

  const addRelation = (competitorProduct, extractSpecs = true) => run(async () => {
    const result = await api.createRelation({
      ownProductId,
      competitorProductId: competitorProduct.id,
      extractSpecs,
    });
    if (result.extraction?.skipped) {
      showNotification('竞品关系已建立，规格内容未变化，已跳过 LLM 调用', 'info');
    } else {
      showNotification('竞品关系已建立');
    }
    await refreshRelations();
    await refreshCompetitors();
  }, null, extractSpecs ? '竞品参数解析中' : '竞品关系保存中');

  const onAddRelation = (competitorProduct) => {
    if (competitorProduct.latest_spec_extracted_at) {
      setPendingCompetitor(competitorProduct);
      return;
    }
    addRelation(competitorProduct, true);
  };

  const deleteRelation = (relation) => run(async () => {
    await api.deleteRelation(relation.id);
    await refreshRelations();
  }, '竞品关系已删除');

  const changeOwnProduct = (id) => {
    setOwnProductId(id);
    setRelationPage(1);
    setRelationQuery('');
  };

  const changeCompetitorSite = (id) => {
    setCompetitorSiteId(id);
    setCompetitorPage(1);
    setCompetitorQuery('');
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <h1>竞品关系</h1>
          <p>选择我方商品，再从其他独立站中选择竞品商品建立关联。</p>
        </div>
      </header>

      <section className="panel">
        <div className="inline-form wide">
          <FuzzySelect
            label="我方商品"
            value={ownProductId}
            onChange={changeOwnProduct}
            options={ownProducts}
            getOptionValue={(product) => product.id}
            getOptionLabel={(product) => `${product.title} / ${product.handle}`}
            getSearchText={(product) => `${product.title} ${product.handle}`}
            placeholder="请选择我方商品"
            emptyText="没有匹配的我方商品"
          />
          <FuzzySelect
            label="竞品站点"
            value={competitorSiteId}
            onChange={changeCompetitorSite}
            options={competitorSites}
            getOptionValue={(site) => site.id}
            getOptionLabel={(site) => site.domain}
            getSearchText={(site) => `${site.domain} ${site.name || ''}`}
            placeholder="请选择竞品站点"
            emptyText="没有匹配的竞品站点"
          />
        </div>
      </section>

      <section className="split-grid">
        <div className="table-container">
          <div className="table-title with-tools">
            <span>可选竞品商品</span>
            <input
              value={competitorQuery}
              onChange={(event) => {
                setCompetitorPage(1);
                setCompetitorQuery(event.target.value);
              }}
              placeholder="前缀搜索竞品名称、handle、vendor"
            />
          </div>
          {loading && competitorProducts.length === 0 ? <Loading /> : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>商品</th>
                    <th>价格</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {competitorProducts.length === 0 ? (
                    <tr><td colSpan="3"><EmptyState message="请选择竞品站点并搜索商品" /></td></tr>
                  ) : competitorProducts.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <div className="title-cell">
                          <strong>{product.title}</strong>
                          <span>{product.handle}</span>
                        </div>
                      </td>
                      <td>{formatMoney(product.price)}</td>
                      <td className="row-actions">
                        <button disabled={!ownProductId} onClick={() => onAddRelation(product)}>关联</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={competitorPage} pageSize={PAGE_SIZE} total={competitorTotal} onPageChange={setCompetitorPage} />
            </>
          )}
        </div>

        <div className="table-container">
          <div className="table-title with-tools">
            <span>已关联竞品</span>
            <input
              value={relationQuery}
              onChange={(event) => {
                setRelationPage(1);
                setRelationQuery(event.target.value);
              }}
              placeholder="前缀搜索竞品名称"
            />
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>竞品商品</th>
                <th>站点</th>
                <th>价格</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {relations.length === 0 ? (
                <tr><td colSpan="4"><EmptyState message="当前我方商品还没有竞品关系" /></td></tr>
              ) : relations.map((relation) => (
                <tr key={relation.id}>
                  <td>{relation.competitor_title}</td>
                  <td>{relation.competitor_domain}</td>
                  <td>{formatMoney(relation.competitor_price)}</td>
                  <td className="row-actions">
                    <button className="text-danger" onClick={() => deleteRelation(relation)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={relationPage} pageSize={PAGE_SIZE} total={relationTotal} onPageChange={setRelationPage} />
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(pendingCompetitor)}
        title="竞品已有参数，是否重新解析？"
        description="这个竞品商品已经解析过参数。你可以复用已有参数，避免再次调用 LLM。"
        detail={pendingCompetitor ? `上次解析时间：${new Date(pendingCompetitor.latest_spec_extracted_at).toLocaleString()}` : ''}
        confirmText="重新解析并关联"
        cancelText="复用已有参数"
        onCancel={() => {
          const product = pendingCompetitor;
          setPendingCompetitor(null);
          addRelation(product, false);
        }}
        onConfirm={() => {
          const product = pendingCompetitor;
          setPendingCompetitor(null);
          addRelation(product, true);
        }}
      />
    </div>
  );
}
