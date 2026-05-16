export function formatMoney(cents) {
  if (cents === null || cents === undefined || cents === '') return '-';
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

export function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export function specValue(spec) {
  return spec?.value || '未获取';
}

const SOURCE_LABELS = {
  specification: '规格表 / Specification',
  specifications: '规格表 / Specifications',
  details: '详情区 / Details',
  highlight: '卖点卡片 / Highlight',
  json: '页面 JSON / JSON',
  local: '本地规则 / Local Rule',
  'local-rule': '本地规则 / Local Rule',
  computed: '公式计算 / Computed',
  'manual-edit': '人工编辑 / Manual Edit',
};

export function formatSourceType(sourceType) {
  if (!sourceType) return '-';
  return SOURCE_LABELS[sourceType] || `${sourceType} / 未知来源`;
}
