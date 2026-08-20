import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, Space, Table, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { bizSettingsList, bizSettingUpdate } from '@/api/biz.api';

const { Title } = Typography;

const SETTING_LABELS: Record<string, string> = {
  contract_expiry_warning_days: '合同到期预警提前天数',
  order_import_max_bytes: '订单文件最大字节数',
  order_import_max_rows: '订单文件最大数据行数',
};

/** 系统设置（新基线 M6）：到期预警阈值等配置（仅 super_admin 可改） */
export default function BizSettings() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<{ key: string; value: string; description: string | null }>>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const data = await bizSettingsList();
      setItems(data.items);
      const map: Record<string, string> = {};
      for (const item of data.items) map[item.key] = item.value;
      setEditing(map);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '加载失败');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onSave = async (key: string) => {
    try {
      await bizSettingUpdate(key, editing[key] ?? '');
      message.success('设置已保存');
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '保存失败');
    }
  };

  const columns = [
    { title: '设置项', dataIndex: 'key', key: 'key', render: (v: string) => <span>{SETTING_LABELS[v] ?? '未命名设置'}</span> },
    { title: '说明', dataIndex: 'description', key: 'description' },
    {
      title: '值', key: 'value', width: 220,
      render: (_: unknown, row: { key: string }) => (
        <Input
          value={editing[row.key] ?? ''}
          onChange={(e) => setEditing((prev) => ({ ...prev, [row.key]: e.target.value }))}
        />
      ),
    },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: unknown, row: { key: string }) => <Button type="primary" size="small" onClick={() => onSave(row.key)}>保存</Button>,
    },
  ];

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>系统设置</Title>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Button onClick={() => navigate('/biz/operation')}>返回经营管理</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        </Space>
      </div>
      <Card>
        <Table rowKey="key" columns={columns} dataSource={items} pagination={false} />
      </Card>
    </div>
  );
}
