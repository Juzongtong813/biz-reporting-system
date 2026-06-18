/**
 * 合同管理页面
 *
 * 功能：
 * - 分页表格（合同编号、名称、金额、费率、累计订单/发票、软删除标记）
 * - 顶部搜索：合同名称关键词
 * - 新建/编辑 Modal（严格对齐 CreateContractRequest DTO）
 * - 详情 Drawer
 * - 软删除操作（确认后执行）
 */
import { useState, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Input,
  Modal,
  Form,
  InputNumber,
  DatePicker,
  Tag,
  Drawer,
  Descriptions,
  Popconfirm,
  message,
  Card,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as contractsApi from '@/api/contracts.api';
import type { Contract, CreateContractRequest } from '@biz-reporting/shared-types';
import type { TablePagination } from '@/types';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

export default function Contracts() {
  const queryClient = useQueryClient();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [pagination, setPagination] = useState<TablePagination>({
    page: 1,
    pageSize: 10,
    total: 0,
  });

  // ---- Modal 状态 ----
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [form] = Form.useForm();

  // ---- Drawer 状态 ----
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailContract, setDetailContract] = useState<Contract | null>(null);

  // ---- 列表查询 ----
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['contracts', pagination.page, pagination.pageSize],
    queryFn: () =>
      contractsApi.listContracts({
        page: pagination.page,
        pageSize: pagination.pageSize,
      }),
  });

  // 前端关键词过滤（Mock 模式下后端不支持搜索参数）
  const contracts = data?.items ?? [];
  const filteredContracts = searchKeyword
    ? contracts.filter(
        (c) =>
          c.contractName.includes(searchKeyword) ||
          c.contractCode.includes(searchKeyword),
      )
    : contracts;

  // ---- 创建/更新 Mutation ----
  const createMutation = useMutation({
    mutationFn: contractsApi.createContract,
    onSuccess: () => {
      message.success('合同创建成功');
      setModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateContractRequest> }) =>
      contractsApi.updateContract(id, data as any),
    onSuccess: () => {
      message.success('合同更新成功');
      setModalOpen(false);
      setEditingContract(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: contractsApi.softDeleteContract,
    onSuccess: () => {
      message.success('合同已删除');
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  // ---- 事件处理 ----
  function handleAdd() {
    setEditingContract(null);
    form.resetFields();
    setModalOpen(true);
  }

  function handleEdit(contract: Contract) {
    setEditingContract(contract);
    form.setFieldsValue({
      contractCode: contract.contractCode,
      contractName: contract.contractName,
      contractAmount: contract.contractAmount,
      rate: contract.rate,
      signDate: contract.signDate ? dayjs(contract.signDate as any) : undefined,
      expireDate: contract.expireDate ? dayjs(contract.expireDate as any) : undefined,
    });
    setModalOpen(true);
  }

  function handleView(contract: Contract) {
    setDetailContract(contract);
    setDrawerOpen(true);
  }

  function handleModalOk() {
    form.validateFields().then((values) => {
      const formData: CreateContractRequest = {
        contractCode: values.contractCode,
        contractName: values.contractName,
        contractAmount: values.contractAmount,
        rate: values.rate,
        signDate: values.signDate
          ? (values.signDate as dayjs.Dayjs).format('YYYY-MM-DD')
          : undefined,
        expireDate: values.expireDate
          ? (values.expireDate as dayjs.Dayjs).format('YYYY-MM-DD')
          : undefined,
      };

      if (editingContract) {
        updateMutation.mutate({ id: editingContract.id, data: formData });
      } else {
        createMutation.mutate(formData);
      }
    });
  }

  function handleDelete(contractId: number) {
    deleteMutation.mutate(contractId);
  }

  const isMutating = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  // ---- 表格列定义 ----
  const columns = [
    {
      title: '合同编号',
      dataIndex: 'contractCode',
      key: 'contractCode',
      width: 140,
    },
    {
      title: '合同名称',
      dataIndex: 'contractName',
      key: 'contractName',
      ellipsis: true,
    },
    {
      title: '合同金额',
      dataIndex: 'contractAmount',
      key: 'contractAmount',
      width: 120,
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '费率',
      dataIndex: 'rate',
      key: 'rate',
      width: 80,
      align: 'right' as const,
      render: (v: number) => `${(v * 100).toFixed(1)}%`,
    },
    {
      title: '累计订单金额',
      dataIndex: 'accumulatedOrderAmount',
      key: 'accumulatedOrderAmount',
      width: 130,
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '累计发票金额',
      dataIndex: 'accumulatedInvoiceAmount',
      key: 'accumulatedInvoiceAmount',
      width: 130,
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_: any, record: Contract) =>
        record.isDeleted ? (
          <Tag color="red">已删除</Tag>
        ) : (
          <Tag color="green">有效</Tag>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: any, record: Contract) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleView(record)}
          >
            详情
          </Button>
          {!record.isDeleted && (
            <>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
              >
                编辑
              </Button>
              <Popconfirm
                title="确定删除此合同？"
                description="删除后不影响已有快照数据"
                onConfirm={() => handleDelete(record.id)}
                okText="确定"
                cancelText="取消"
              >
                <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* 搜索栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            placeholder="搜索合同名称/编号"
            prefix={<SearchOutlined />}
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            style={{ width: 240 }}
            allowClear
          />
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            新建合同
          </Button>
        </Space>
      </Card>

      {/* 合同表格 */}
      <Table
        rowKey="id"
        columns={columns}
        dataSource={filteredContracts}
        loading={isLoading || isMutating}
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: data?.total ?? filteredContracts.length,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => setPagination({ page, pageSize, total: data?.total ?? 0 }),
        }}
        scroll={{ x: 1100 }}
      />

      {/* 新建/编辑 Modal */}
      <Modal
        title={editingContract ? '编辑合同' : '新建合同'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => {
          setModalOpen(false);
          setEditingContract(null);
          form.resetFields();
        }}
        confirmLoading={isMutating}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="contractCode"
            label="合同编号"
            rules={[{ required: true, message: '请输入合同编号' }]}
          >
            <Input placeholder="如 HT-2026-010" />
          </Form.Item>
          <Form.Item
            name="contractName"
            label="合同名称"
            rules={[{ required: true, message: '请输入合同名称' }]}
          >
            <Input placeholder="合同名称" />
          </Form.Item>
          <Form.Item
            name="contractAmount"
            label="合同金额"
            rules={[{ required: true, message: '请输入合同金额' }]}
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              placeholder="合同金额（元）"
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            />
          </Form.Item>
          <Form.Item
            name="rate"
            label="费率"
            rules={[{ required: true, message: '请输入费率' }]}
            extra="请输入小数，如 0.03 表示 3%"
          >
            <InputNumber min={0} max={1} step={0.001} style={{ width: '100%' }} placeholder="如 0.03" />
          </Form.Item>
          <Form.Item name="signDate" label="签订日期">
            <DatePicker style={{ width: '100%' }} placeholder="选择签订日期" />
          </Form.Item>
          <Form.Item name="expireDate" label="到期日期">
            <DatePicker style={{ width: '100%' }} placeholder="选择到期日期" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情 Drawer */}
      <Drawer
        title="合同详情"
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDetailContract(null);
        }}
        width={560}
      >
        {detailContract && (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="合同编号">
                {detailContract.contractCode}
              </Descriptions.Item>
              <Descriptions.Item label="合同名称">
                {detailContract.contractName}
              </Descriptions.Item>
              <Descriptions.Item label="合同金额">
                {detailContract.contractAmount.toLocaleString()} 元
              </Descriptions.Item>
              <Descriptions.Item label="费率">
                {(detailContract.rate * 100).toFixed(1)}%
              </Descriptions.Item>
              <Descriptions.Item label="累计订单金额">
                {detailContract.accumulatedOrderAmount.toLocaleString()} 元
              </Descriptions.Item>
              <Descriptions.Item label="累计发票金额">
                {detailContract.accumulatedInvoiceAmount.toLocaleString()} 元
              </Descriptions.Item>
              <Descriptions.Item label="签订日期">
                {detailContract.signDate
                  ? new Date(detailContract.signDate as any).toLocaleDateString('zh-CN')
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="到期日期">
                {detailContract.expireDate
                  ? new Date(detailContract.expireDate as any).toLocaleDateString('zh-CN')
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                {detailContract.isDeleted ? (
                  <Tag color="red">已删除</Tag>
                ) : (
                  <Tag color="green">有效</Tag>
                )}
              </Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Drawer>
    </div>
  );
}
