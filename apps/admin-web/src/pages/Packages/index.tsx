/**
 * 报表包管理页面
 *
 * 数据来自 GET /api/admin/packages
 * 控制端点: return-to-draft / unlock-months / open-current-month-contract
 */
import { useEffect, useState } from 'react';
import {
  Table,
  Tag,
  Button,
  Modal,
  Input,
  DatePicker,
  Space,
  message,
  Typography,
} from 'antd';
import { RollbackOutlined, UnlockOutlined, PlusCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AdminPackageItem, PaginatedResponse } from '@biz-reporting/shared-types';
import * as packagesApi from '@/api/packages.api';

const { Text } = Typography;

/** 状态着色 */
const statusColorMap: Record<string, string> = {
  draft: 'orange',
  submitted: 'green',
};

export default function Packages() {
  const [data, setData] = useState<PaginatedResponse<AdminPackageItem> | null>(null);
  const [loading, setLoading] = useState(false);

  // 退回草稿弹窗
  const [returnModal, setReturnModal] = useState<{
    open: boolean;
    pkg: AdminPackageItem | null;
  }>({ open: false, pkg: null });
  const [returnMonth, setReturnMonth] = useState<number>(0);
  const [returnReason, setReturnReason] = useState('');

  // 解锁月份弹窗
  const [unlockModal, setUnlockModal] = useState<{
    open: boolean;
    pkg: AdminPackageItem | null;
  }>({ open: false, pkg: null });
  const [unlockMonths, setUnlockMonths] = useState<number[]>([]);
  const [unlockExpire, setUnlockExpire] = useState<string>('');

  // 开放合同弹窗
  const [openContractModal, setOpenContractModal] = useState<{
    open: boolean;
    pkg: AdminPackageItem | null;
  }>({ open: false, pkg: null });
  const [openMonth, setOpenMonth] = useState<number>(0);
  const [openContractId, setOpenContractId] = useState<number>(0);

  const fetchData = () => {
    setLoading(true);
    packagesApi
      .listPackages()
      .then(setData)
      .catch(() => message.error('获取报表包列表失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ---- 退回草稿 ----
  const handleReturnToDraft = () => {
    if (!returnModal.pkg || !returnMonth || !returnReason.trim()) {
      message.warning('请填写月份和退回原因');
      return;
    }
    packagesApi
      .returnToDraft(returnModal.pkg.id, { monthNo: returnMonth, reason: returnReason.trim() })
      .then(() => {
        message.success('已退回草稿');
        setReturnModal({ open: false, pkg: null });
        setReturnMonth(0);
        setReturnReason('');
        fetchData();
      })
      .catch(() => message.error('退回失败'));
  };

  // ---- 解锁月份 ----
  const handleUnlockMonths = () => {
    if (!unlockModal.pkg || unlockMonths.length === 0 || !unlockExpire) {
      message.warning('请选择月份和过期时间');
      return;
    }
    packagesApi
      .unlockMonths(unlockModal.pkg.id, {
        months: unlockMonths,
        expiresAt: unlockExpire,
      })
      .then(() => {
        message.success('解锁成功');
        setUnlockModal({ open: false, pkg: null });
        setUnlockMonths([]);
        setUnlockExpire('');
        fetchData();
      })
      .catch(() => message.error('解锁失败'));
  };

  // ---- 开放合同 ----
  const handleOpenContract = () => {
    if (!openContractModal.pkg || !openMonth || !openContractId) {
      message.warning('请填写月份和合同 ID');
      return;
    }
    packagesApi
      .openCurrentMonthContract(openContractModal.pkg.id, {
        monthNo: openMonth,
        contractId: openContractId,
      })
      .then(() => {
        message.success('合同填报权限已开放');
        setOpenContractModal({ open: false, pkg: null });
        setOpenMonth(0);
        setOpenContractId(0);
        fetchData();
      })
      .catch(() => message.error('开放失败'));
  };

  const columns = [
    {
      title: '城市',
      dataIndex: 'cityName',
      key: 'cityName',
      width: 160,
    },
    {
      title: '年度',
      dataIndex: 'reportYear',
      key: 'reportYear',
      width: 80,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => (
        <Tag color={statusColorMap[s] || 'default'}>{s === 'submitted' ? '已提交' : '草稿'}</Tag>
      ),
    },
    {
      title: '当月提交',
      key: 'currentMonthSubmitted',
      width: 100,
      render: (_: unknown, r: AdminPackageItem) =>
        r.currentMonthSubmitted ? (
          <Tag color="green">已提交</Tag>
        ) : (
          <Tag color="default">未提交</Tag>
        ),
    },
    {
      title: '累计月数',
      dataIndex: 'submittedMonthCount',
      key: 'submittedMonthCount',
      width: 100,
    },
    {
      title: '最后更新',
      dataIndex: 'lastUpdatedAt',
      key: 'lastUpdatedAt',
      width: 180,
      render: (t: string | null) => (t ? new Date(t).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_: unknown, r: AdminPackageItem) => (
        <Space size="small">
          {r.status === 'submitted' && (
            <Button
              size="small"
              icon={<RollbackOutlined />}
              onClick={() => setReturnModal({ open: true, pkg: r })}
            >
              退回
            </Button>
          )}
          <Button
            size="small"
            icon={<UnlockOutlined />}
            onClick={() => setUnlockModal({ open: true, pkg: r })}
          >
            解锁
          </Button>
          <Button
            size="small"
            icon={<PlusCircleOutlined />}
            onClick={() => setOpenContractModal({ open: true, pkg: r })}
          >
            开放合同
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        报表包管理
      </Typography.Title>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data?.items ?? []}
        columns={columns}
        pagination={false}
        locale={{ emptyText: '暂无报表包数据' }}
      />

      {/* 退回草稿弹窗 */}
      <Modal
        title="退回草稿"
        open={returnModal.open}
        onOk={handleReturnToDraft}
        onCancel={() => setReturnModal({ open: false, pkg: null })}
        okText="确认退回"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Text>城市：{returnModal.pkg?.cityName}</Text>
          </div>
          <div>
            <Text>月份：</Text>
            <Input
              type="number"
              min={1}
              max={12}
              placeholder="1-12"
              style={{ width: 120 }}
              value={returnMonth || ''}
              onChange={(e) => setReturnMonth(Number(e.target.value))}
            />
          </div>
          <div>
            <Text>退回原因：</Text>
            <Input.TextArea
              rows={3}
              placeholder="请填写退回原因"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* 解锁月份弹窗 */}
      <Modal
        title="解锁月份"
        open={unlockModal.open}
        onOk={handleUnlockMonths}
        onCancel={() => setUnlockModal({ open: false, pkg: null })}
        okText="确认解锁"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Text>城市：{unlockModal.pkg?.cityName}</Text>
          </div>
          <div>
            <Text>月份（逗号分隔）：</Text>
            <Input
              placeholder="如 1,2,3"
              style={{ width: 200 }}
              value={unlockMonths.join(',')}
              onChange={(e) =>
                setUnlockMonths(
                  e.target.value
                    .split(',')
                    .map((s) => Number(s.trim()))
                    .filter((n) => n > 0 && n <= 12),
                )
              }
            />
          </div>
          <div>
            <Text>过期时间：</Text>
            <DatePicker
              showTime
              locale="zh-CN"
              value={unlockExpire ? dayjs(unlockExpire) : null}
              onChange={(d) => setUnlockExpire(d?.toISOString() ?? '')}
            />
          </div>
        </div>
      </Modal>

      {/* 开放合同弹窗 */}
      <Modal
        title="开放合同填报权限"
        open={openContractModal.open}
        onOk={handleOpenContract}
        onCancel={() => setOpenContractModal({ open: false, pkg: null })}
        okText="确认开放"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Text>城市：{openContractModal.pkg?.cityName}</Text>
          </div>
          <div>
            <Text>月份：</Text>
            <Input
              type="number"
              min={1}
              max={12}
              placeholder="当前月"
              style={{ width: 120 }}
              value={openMonth || ''}
              onChange={(e) => setOpenMonth(Number(e.target.value))}
            />
          </div>
          <div>
            <Text>合同 ID：</Text>
            <Input
              type="number"
              min={1}
              placeholder="合同编号"
              style={{ width: 200 }}
              value={openContractId || ''}
              onChange={(e) => setOpenContractId(Number(e.target.value))}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
