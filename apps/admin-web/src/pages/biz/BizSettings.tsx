import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, Space, Table, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { bizSettingsList, bizSettingUpdate } from '@/api/biz.api';

const { Title, Text } = Typography;

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
    { title: '设置项', dataIndex: 'key', key: 'key', render: (v: string) => <Text code>{v}</Text> },
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
    <div style={{ padding: 24, background: '#F5F7F8', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>系统设置</Title>
          <Text type="secondary">到期预警阈值等配置（仅 super_admin 可修改）</Text>
        </div>
        <Space>
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
