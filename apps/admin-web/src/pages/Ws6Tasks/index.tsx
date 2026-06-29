/**
 * 任务中心 — WS6 导入/导出/重算任务管理（强类型版本）
 */
import { useRef, useState } from 'react';
import {
  Card, Table, Button, InputNumber, Select, Space, Typography, message,
  Tag, Descriptions, Input,
} from 'antd';
import { CloudUploadOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import type {
  ImportPreviewResponse,
  ExportJobResponse,
  RecalcTaskItem,
} from '@biz-reporting/shared-types';
import * as ws6Api from '@/api/ws6.api';

const { Title, Text } = Typography;

/** Axios 错误消息提取 */
function extractError(e: unknown): string {
  const err = e as Record<string, unknown>;
  const response = err?.response as Record<string, unknown> | undefined;
  const data = response?.data as Record<string, unknown> | undefined;
  if (data?.message) return String(data.message);
  if (err?.message) return String(err.message);
  return '未知错误';
}

export default function Ws6Tasks() {
  // ======== 导入 ========
  const [importJobId, setImportJobId] = useState<number | null>(null);
  const [importJobStatus, setImportJobStatus] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewResponse | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const contractFileRef = useRef<HTMLInputElement>(null);
  const reportingFileRef = useRef<HTMLInputElement>(null);

  function pickFile(ref: React.RefObject<HTMLInputElement | null>, cb: (f: File) => Promise<void>) {
    const input = ref.current;
    if (!input) return;
    input.value = '';
    input.click();
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>, cb: (f: File) => Promise<void>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    try {
      await cb(file);
    } finally {
      setImportLoading(false);
    }
  }

  const [importFileName, setImportFileName] = useState<string | null>(null);
  // 城市报表导入专用
  const [importJobType, setImportJobType] = useState<'contract' | 'city_reporting' | null>(null);
  const [reportingCityId, setReportingCityId] = useState<number | null>(null);
  const [reportingYear, setReportingYear] = useState<number>(new Date().getFullYear());

  async function uploadWithFile(file: File) {
    const r = await ws6Api.uploadContracts(file);
    setImportJobId(r.jobId);
    setImportJobStatus(r.status);
    setImportJobType('contract');
    setImportPreview(null);
    setImportFileName(file.name);
    message.success(`导入任务创建成功：jobId=${r.jobId}`);
  }

  async function uploadReportingWithFile(file: File) {
    const r = await ws6Api.uploadReporting(file);
    setImportJobId(r.jobId);
    setImportJobStatus(r.status);
    setImportJobType('city_reporting');
    setImportPreview(null);
    setImportFileName(file.name);
    message.success(`城市导入任务创建成功：jobId=${r.jobId}`);
  }

  async function handlePreview(jobId: number) {
    try {
      const r = await ws6Api.getImportPreview(jobId);
      setImportJobId(r.id);
      setImportJobStatus(r.status);
      setImportPreview(r);
      message.info(`任务状态：${r.status}`);
    } catch (e: unknown) {
      message.error(`预览失败：${extractError(e)}`);
    }
  }

  async function handleConfirm(jobId: number) {
    try {
      const r = await ws6Api.confirmImport(jobId, {
        confirmOverwrite: true,
        ...(importJobType === 'city_reporting' ? { cityId: reportingCityId!, reportYear: reportingYear } : {}),
      });
      message.success(`确认成功：jobId=${r.jobId}`);
      setImportJobStatus('completed');
    } catch (e: unknown) {
      message.error(`确认失败：${extractError(e)}`);
    }
  }

  // ======== 导出 ========
  const [exportYear, setExportYear] = useState(new Date().getFullYear());
  const [exportMonth, setExportMonth] = useState<number | null>(new Date().getMonth() + 1);
  const [exportMode, setExportMode] = useState<'current_realtime' | 'month_snapshot'>('month_snapshot');
  const [exportResult, setExportResult] = useState<{ jobId: number; status: string } | null>(null);
  const [exportDetail, setExportDetail] = useState<ExportJobResponse | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  async function handleCreateExport() {
    setExportLoading(true);
    try {
      const r = await ws6Api.createExportJob({
        exportMode,
        scopeType: 'all_cities',
        reportYear: exportYear,
        belongMonth: exportMonth ?? null,
        snapshotRange: exportMode === 'month_snapshot' ? 'month_only' : null,
      });
      setExportResult(r);
      message.success(`导出任务创建成功：jobId=${r.jobId}，状态=${r.status}`);
    } catch (e: unknown) {
      message.error(`导出失败：${extractError(e)}`);
    }
    setExportLoading(false);
  }

  async function handleGetExport(jobId: number) {
    try {
      const r = await ws6Api.getExportJob(jobId);
      setExportDetail(r);
    } catch (e: unknown) {
      message.error(`查询失败：${extractError(e)}`);
    }
  }

  // ======== 重算 ========
  const [recalcItems, setRecalcItems] = useState<RecalcTaskItem[]>([]);
  const [recalcLoading, setRecalcLoading] = useState(false);

  async function handleListRecalc() {
    setRecalcLoading(true);
    try {
      const r = await ws6Api.listRecalcTasks();
      setRecalcItems(r.items);
    } catch (e: unknown) {
      message.error(`查询失败：${extractError(e)}`);
    }
    setRecalcLoading(false);
  }

  async function handleRetry(taskId: number) {
    try {
      const r = await ws6Api.retryRecalcTask(taskId);
      message.success(`重试成功：taskId=${r.taskId}`);
      handleListRecalc();
    } catch (e: unknown) {
      message.error(`重试失败：${extractError(e)}`);
    }
  }

  const recalcColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '类型', dataIndex: 'taskType', key: 'taskType', width: 120 },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => <Tag color={v === 'failed' ? 'red' : v === 'completed' ? 'green' : 'blue'}>{v}</Tag>,
    },
    { title: '错误信息', dataIndex: 'errorMessage', key: 'errorMessage', ellipsis: true },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 170, render: (v: string) => String(v ?? '').slice(0, 19).replace('T', ' ') },
    {
      title: '操作', key: 'action', width: 80,
      render: (_: unknown, row: RecalcTaskItem) =>
        row.status === 'failed' ? (
          <Button size="small" onClick={() => handleRetry(row.id)}>重试</Button>
        ) : null,
    },
  ];

  return (
    <div>
      <Title level={4}>任务中心</Title>

      {/* ========== 导入区 ========== */}
      <Card title="导入" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <input type="file" accept=".csv,.xlsx,.xls" ref={contractFileRef} style={{ display: 'none' }}
              onChange={(e) => onFileSelected(e, uploadWithFile)} />
            <Button icon={<CloudUploadOutlined />} loading={importLoading}
              onClick={() => pickFile(contractFileRef, uploadWithFile)}>
              上传合同导入
            </Button>
            <input type="file" accept=".csv,.xlsx,.xls" ref={reportingFileRef} style={{ display: 'none' }}
              onChange={(e) => onFileSelected(e, uploadReportingWithFile)} />
            <Button icon={<CloudUploadOutlined />} loading={importLoading}
              onClick={() => pickFile(reportingFileRef, uploadReportingWithFile)}>
              上传城市报表导入
            </Button>
          </Space>

          <Space>
            <InputNumber placeholder="jobId" min={1} style={{ width: 120 }}
              onChange={(v) => { if (v) { handlePreview(v); } }} />
          </Space>
          <Text type="secondary">输入 jobId 查看预览，然后可确认</Text>

          {importJobId != null && (
            <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 6 }}>
              <Descriptions size="small" column={2}>
                <Descriptions.Item label="jobId">{importJobId}</Descriptions.Item>
                <Descriptions.Item label="状态"><Tag>{importJobStatus}</Tag></Descriptions.Item>
                {importFileName && <Descriptions.Item label="文件">{importFileName}</Descriptions.Item>}
              </Descriptions>

              {importPreview && (
                <div style={{ marginTop: 8 }}>
                  {/* 解析结果表格 */}
                  {(importPreview.parsedSummary as any)?.contracts && (
                    <>
                      <Typography.Text strong>解析预览（{(importPreview.parsedSummary as any).contracts.length} 条）</Typography.Text>
                      <Table
                        size="small"
                        rowKey={(_, i) => String(i)}
                        columns={[
                          { title: '合同编号', dataIndex: 'contractCode', key: 'contractCode' },
                          { title: '合同名称', dataIndex: 'contractName', key: 'contractName', ellipsis: true },
                          { title: '金额(万元)', dataIndex: 'amount', key: 'amount',
                            render: (v: number) => v != null ? (v / 10000).toFixed(2) : '-',
                          },
                          { title: '城市数', dataIndex: 'cityCount', key: 'cityCount', width: 72 },
                          { title: '状态', dataIndex: 'status', key: 'status', width: 80,
                            render: (v: string) => <Tag color="blue">{v}</Tag>,
                          },
                        ]}
                        dataSource={(importPreview.parsedSummary as any).contracts}
                        pagination={false}
                        scroll={{ y: 240 }}
                        style={{ marginTop: 4 }}
                      />
                    </>
                  )}

                  {/* 错误列表 */}
                  {(importPreview.errorSummary as any)?.errors && (importPreview.errorSummary as any).errors.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Typography.Text type="danger" strong>解析错误（{(importPreview.errorSummary as any).errors.length} 条）</Typography.Text>
                      <ul style={{ maxHeight: 120, overflow: 'auto', margin: '4px 0 0 0', paddingLeft: 20, fontSize: 12 }}>
                        {(importPreview.errorSummary as any).errors.map((e: string, i: number) => (
                          <li key={i} style={{ color: '#ff4d4f' }}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {importJobStatus === 'pending' && (
                <>
                  {importJobType === 'city_reporting' && (
                    <Space style={{ marginTop: 8 }}>
                      <InputNumber placeholder="城市ID" min={1} style={{ width: 100 }}
                        value={reportingCityId} onChange={(v) => setReportingCityId(v ?? null)} />
                      <InputNumber placeholder="年份" min={2020} max={2100} style={{ width: 100 }}
                        value={reportingYear} onChange={(v) => v && setReportingYear(v)} />
                      <Text type="secondary">输入城市ID和年份后确认</Text>
                    </Space>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <Button size="small" type="primary"
                      onClick={() => handleConfirm(importJobId)}
                      disabled={importJobType === 'city_reporting' && !reportingCityId}>
                      确认导入
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Space>
      </Card>

      {/* ========== 导出区 ========== */}
      <Card title="导出" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Select value={exportMode} onChange={setExportMode} style={{ width: 160 }}
              options={[
                { value: 'current_realtime', label: '当前实时数据' },
                { value: 'month_snapshot', label: '月度快照数据' },
              ]} />
            <InputNumber addonBefore="年" value={exportYear} onChange={(v) => v && setExportYear(v)} min={2020} max={2100} />
            <InputNumber addonBefore="月" value={exportMonth} onChange={(v) => setExportMonth(v ?? null)} min={1} max={12} />
            <Button icon={<DownloadOutlined />} loading={exportLoading} onClick={handleCreateExport}>
              创建导出
            </Button>
          </Space>

          {exportResult && (
            <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 6 }}>
              <Descriptions size="small" column={2}>
                <Descriptions.Item label="jobId">{String(exportResult.jobId)}</Descriptions.Item>
                <Descriptions.Item label="状态"><Tag>{exportResult.status}</Tag></Descriptions.Item>
              </Descriptions>
              <Button size="small" style={{ marginTop: 8 }}
                onClick={() => handleGetExport(Number(exportResult.jobId))}>
                刷新详情
              </Button>
            </div>
          )}

          {exportDetail && (
            <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 6 }}>
              <Descriptions size="small" column={2}>
                <Descriptions.Item label="状态"><Tag>{exportDetail.status}</Tag></Descriptions.Item>
                <Descriptions.Item label="fileUrl">{exportDetail.fileUrl || '-'}</Descriptions.Item>
                <Descriptions.Item label="过期时间">
                  {String(exportDetail.expiresAt ?? '').slice(0, 19).replace('T', ' ') || '-'}
                </Descriptions.Item>
              </Descriptions>
            </div>
          )}
        </Space>
      </Card>

      {/* ========== 重算区 ========== */}
      <Card title="重算任务">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button icon={<ReloadOutlined />} loading={recalcLoading} onClick={handleListRecalc}>
            刷新列表
          </Button>
          <Table<RecalcTaskItem>
            rowKey="id"
            columns={recalcColumns}
            dataSource={recalcItems}
            loading={recalcLoading}
            size="small"
            pagination={false}
            locale={{ emptyText: '暂无重算任务' }}
          />
        </Space>
      </Card>
    </div>
  );
}
