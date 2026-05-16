import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { formatTime } from '../service/format.js';

export default function DashboardPage() {
  const [sites, setSites] = useState([]);
  const [products, setProducts] = useState([]);
  const [relations, setRelations] = useState([]);

  useEffect(() => {
    Promise.all([api.listSites(), api.listProducts(), api.listRelations()]).then(([siteData, productData, relationData]) => {
      setSites(siteData.sites);
      setProducts(productData.products);
      setRelations(relationData.relations);
    });
  }, []);

  const ownSite = sites.find((site) => site.is_own_site);

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <h1>数据看板</h1>
          <p>本地 Shopify 竞品数据、参数解析和报告生成概览。</p>
        </div>
      </header>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <h3>独立站数量</h3>
          <p className="card-value">{sites.length}</p>
        </div>
        <div className="dashboard-card">
          <h3>商品数量</h3>
          <p className="card-value">{products.length}</p>
        </div>
        <div className="dashboard-card">
          <h3>竞品关系</h3>
          <p className="card-value">{relations.length}</p>
        </div>
      </div>

      <section className="panel">
        <h2>当前我方站点</h2>
        {ownSite ? (
          <div className="info-list">
            <div><span>域名</span><strong>{ownSite.domain}</strong></div>
            <div><span>商品数</span><strong>{ownSite.product_count}</strong></div>
            <div><span>最近同步</span><strong>{formatTime(ownSite.last_product_sync_at)}</strong></div>
          </div>
        ) : (
          <p className="muted">还没有设置我方独立站。请先到站点管理中设置。</p>
        )}
      </section>
    </div>
  );
}
