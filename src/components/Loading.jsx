export default function Loading({ message = '加载中，请稍候...' }) {
  return <div className="loading-spinner">{message}</div>;
}
