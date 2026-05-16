import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import EmptyState from '../components/EmptyState.jsx';
import { formatTime } from '../service/format.js';
import { useAsync } from '../hooks/useAsync.js';

const DEFAULT_KEYS = [
  { key: 'GEMINI_API_KEY', isSecret: true, hint: 'Google AI Studio 申请的 Key' },
  { key: 'GEMINI_MODEL', isSecret: false, hint: '默认 gemini-2.5-flash' },
  { key: 'GEMINI_MAX_RETRIES', isSecret: false, hint: 'Gemini 失败自动重试次数，默认 3' },
];

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState([]);
  const [drafts, setDrafts] = useState({});
  const { loading, run } = useAsync();
  const mergedSettings = useMemo(() => {
    const byKey = new Map(settings.map((item) => [item.setting_key, item]));
    return DEFAULT_KEYS.map((item) => byKey.get(item.key) || {
      setting_key: item.key,
      setting_value: '',
      is_secret: item.isSecret ? 1 : 0,
      updated_at: null,
      hint: item.hint,
    });
  }, [settings]);

  const refresh = async () => {
    const data = await api.listAdminSettings();
    setSettings(data.settings);
    setDrafts(Object.fromEntries(data.settings.map((item) => [item.setting_key, item.is_secret ? '' : item.setting_value || ''])));
  };

  useEffect(() => {
    refresh();
  }, []);

  const save = (setting) => run(async () => {
    await api.saveAdminSetting({
      key: setting.setting_key,
      value: drafts[setting.setting_key] ?? '',
      isSecret: Boolean(setting.is_secret),
    });
    await refresh();
  }, '配置已保存');

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <h1>系统配置</h1>
          <p>管理员可以维护运行时配置。敏感值保存后会隐藏显示。</p>
        </div>
      </header>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>配置项</th>
              <th>值</th>
              <th>说明</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {mergedSettings.length === 0 ? (
              <tr><td colSpan="5"><EmptyState /></td></tr>
            ) : mergedSettings.map((setting) => (
              <tr key={setting.setting_key}>
                <td>
                  <strong>{setting.setting_key}</strong>
                  {setting.is_secret ? <span className="badge warning">敏感</span> : null}
                </td>
                <td>
                  <input
                    className="spec-edit-input"
                    type={setting.is_secret ? 'password' : 'text'}
                    placeholder={setting.is_secret && setting.setting_value ? '已保存，留空不会自动显示原值' : '请输入配置值'}
                    value={drafts[setting.setting_key] ?? ''}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [setting.setting_key]: event.target.value }))}
                  />
                </td>
                <td>{setting.hint || '-'}</td>
                <td>{formatTime(setting.updated_at)}</td>
                <td className="row-actions">
                  <button disabled={loading || (setting.is_secret && !drafts[setting.setting_key])} onClick={() => save(setting)}>保存</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
