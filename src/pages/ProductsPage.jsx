import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import EmptyState from '../components/EmptyState.jsx';
import Loading from '../components/Loading.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import FuzzySelect from '../components/FuzzySelect.jsx';
import { formatMoney, formatTime } from '../service/format.js';
import { filterByFuzzyQuery } from '../service/search.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAppContext } from '../store/AppContext.jsx';

export default function ProductsPage() {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [q, setQ] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [products, setProducts] = useState([]);
  const [confirmProduct, setConfirmProduct] = useState(null);
  const { loading, run } = useAsync();
  const { showNotification } = useAppContext();
  const filteredProducts = useMemo(() => {
    const siteFiltered = siteId
      ? products.filter((product) => String(product.site_id) === String(siteId))
      : products;
    return filterByFuzzyQuery(
      siteFiltered,
      q,
      (product) => `${product.title} ${product.handle} ${product.vendor || ''}`,
    );
  }, [products, q, siteId]);

  const refreshSites = async () => {
    const data = await api.listSites();
    setSites(data.sites);
  };

  const refreshProducts = async () => {
    const data = await api.listProducts({ includeHidden: showHidden });
    setProducts(data.products);
  };

  useEffect(() => {
    refreshSites();
  }, []);

  useEffect(() => {
    refreshProducts();
  }, [showHidden]);

  const extractProduct = (product) => run(async () => {
    const result = await api.extractSpecs(product.id);
    if (result.skipped) {
      showNotification('落地页规格内容未变化，已跳过 LLM 调用', 'info');
    } else {
      showNotification('参数解析完成');
    }
    await refreshProducts();
  }, null, '参数解析中');

  const onExtract = (product) => {
    if (product.latest_spec_extracted_at) {
      setConfirmProduct(product);
      return;
    }
    extractProduct(product);
  };

  const toggleHidden = (product) => run(async () => {
    await api.setProductHidden(product.id, !product.is_hidden);
    await refreshProducts();
    await refreshSites();
  }, product.is_hidden ? '商品已恢复显示' : '商品已隐藏');

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <h1>商品列表</h1>
          <p>商品来自各站点 `products.json`，落地页 URL 由域名和 handle 拼接。</p>
        </div>
      </header>

      <div className="action-bar">
        <div className="search-box compact">
          <FuzzySelect
            label=""
            value={siteId}
            onChange={setSiteId}
            options={sites}
            getOptionValue={(site) => site.id}
            getOptionLabel={(site) => `${site.domain}${site.is_own_site ? '（我方）' : ''}`}
            getSearchText={(site) => `${site.domain} ${site.name || ''}`}
            placeholder="全部站点"
            emptyOptionLabel="全部站点"
          />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="搜索标题或 handle"
          />
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
            />
            显示隐藏商品
          </label>
        </div>
      </div>

      <div className="table-container">
        {loading && products.length === 0 ? <Loading /> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>商品</th>
                <th>站点</th>
                <th>Vendor</th>
                <th>价格</th>
                <th>划线价</th>
                <th>最近同步</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr><td colSpan="7"><EmptyState /></td></tr>
              ) : filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className="title-cell">
                      <strong>
                        {product.title}
                        {product.is_hidden ? <span className="badge warning">已隐藏</span> : null}
                      </strong>
                      <span>{product.handle}</span>
                    </div>
                  </td>
                  <td>{product.domain}{product.is_own_site ? <span className="badge success">我方</span> : null}</td>
                  <td>{product.vendor || '-'}</td>
                  <td>{formatMoney(product.price)}</td>
                  <td>{formatMoney(product.compare_at_price)}</td>
                  <td>{formatTime(product.last_price_sync_at)}</td>
                  <td className="row-actions">
                    <a href={product.landing_page_url} target="_blank" rel="noreferrer">落地页</a>
                    <Link to={`/products/${product.id}/specs`}>参数</Link>
                    {product.latest_spec_extracted_at ? (
                      <span className="badge success">已解析</span>
                    ) : null}
                    <button onClick={() => onExtract(product)} disabled={Boolean(product.is_hidden)}>
                      {product.latest_spec_extracted_at ? '重新解析' : '解析参数'}
                    </button>
                    <button
                      className={product.is_hidden ? '' : 'text-warning'}
                      onClick={() => toggleHidden(product)}
                    >
                      {product.is_hidden ? '恢复显示' : '隐藏'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirmProduct)}
        title="重新解析商品参数？"
        description="该商品已经有参数解析记录。重新解析会再次调用 LLM，并覆盖当前标准参数。"
        detail={confirmProduct ? `上次解析时间：${formatTime(confirmProduct.latest_spec_extracted_at)}` : ''}
        confirmText="重新解析"
        cancelText="保留现有参数"
        danger
        onCancel={() => setConfirmProduct(null)}
        onConfirm={() => {
          const product = confirmProduct;
          setConfirmProduct(null);
          extractProduct(product);
        }}
      />
    </div>
  );
}
