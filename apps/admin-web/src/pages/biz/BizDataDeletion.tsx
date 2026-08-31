import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, Modal, Select, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  bizMe, bizSuperDelete, bizSuperDeleteList, bizSuperDeleteResources,
  type BizSuperDeleteListItem, type BizSuperDeleteResource,
} from '@/api/biz.api';

const { Title, Text } = Typography;

export default function BizDataDeletion() {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [resources, setResources] = useState<Array<{ code: BizSuperDeleteResource; label: string }>>([]);
  const [resource, setResource] = useState<BizSuperDeleteResource>('order-import-record');
  const [items, setItems] = useState<BizSuperDeleteListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetId, setTargetId] = useState('');

  useEffect(() => {
    void bizMe().then((me) => {
      const allowed = me.roleCode === 'super_admin';
      setAuthorized(allowed);
      if (!allowed) navigate('/biz/portal', { replace: true });
    }).catch(() => setAuthorized(false));
  }, [navigate]);

  const loadResources = useCallback(async () => {
    const result = await bizSuperDeleteResources();
    setResources(result.items);
    if (!result.items.some((item) => item.code === resource) && result.items[0]) setResource(result.items[0].code);
  }, [resource]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const result = await bizSuperDeleteList(resource);
      setItems(result.items);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [resource]);

  useEffect(() => {
    if (authorized !== true) return;
    void loadResources();
  }, [authorized, loadResources]);

  useEffect(() => {
    if (authorized !== true) return;
    void loadItems();
  }, [authorized, loadItems]);

  const confirmDelete = (id: string, label: string) => {
    Modal.confirm({
      title: '永久删除数据',
      content: `将永久删除“${label}”及其自有明细，其他业务对象不受影响。此操作不可恢复。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        const result = await bizSuperDelete(resource, id);
        const total = Object.values(result.deleted).reduce((sum, count) => sum + count, 0);
        message.success(`已删除 ${total} 条数据`);
        if (targetId === id) setTargetId('');
        await loadItems();
      },
    });
  };

  if (authorized !== true) {
    return <div style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}><Spin tip="正在验证超级管理员权限" /></div>;
  }

  const selectedLabel = resources.find((item) => item.code === resource)?.label ?? resource;
  const columns = [
    { title: '记录', dataIndex: 'label', key: 'label', ellipsis: true },
    { title: '摘要', dataIndex: 'details', key: 'details', ellipsis: true },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 170, render: (value: string | null) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '记录 ID', dataIndex: 'id', key: 'id', width: 270, ellipsis: true, render: (value: string) => <Text code>{value}</Text> },
    { title: '操作', key: 'action', width: 100, render: (_: unknown, row: BizSuperDeleteListItem) => <Button size="small" danger icon={<DeleteOutlined />} onClick={() => confirmDelete(row.id, row.label)}>删除</Button> },
  ];

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}>数据删除</Title></div>
        <Button icon={<ReloadOutlined />} onClick={() => void loadItems()}>刷新</Button>
      </div>
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select value={resource} style={{ width: 200 }} options={resources.map((item) => ({ value: item.code, label: item.label }))} onChange={(value: BizSuperDeleteResource) => setResource(value)} />
          <Input value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder="输入记录 ID 精确删除" style={{ width: 330 }} />
          <Button danger icon={<DeleteOutlined />} disabled={!targetId.trim()} onClick={() => confirmDelete(targetId.trim(), `${selectedLabel}（指定 ID）`)}>删除指定记录</Button>
          <Tag color="red">永久删除</Tag>
        </Space>
        <Table scroll={{ x: 'max-content' }} rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={{ pageSize: 20, showSizeChanger: false }} />
      </Card>
    </div>
  );
}
