export default function EmptyState({ message = '暂无数据' }) {
  return <div className="empty-data">{message}</div>;
}
