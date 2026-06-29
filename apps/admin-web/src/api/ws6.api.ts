/**
 * WS6 瀵煎叆/瀵煎嚭/閲嶇畻浠诲姟 API 鈥?寮虹被鍨嬬増鏈? *
 * 娉ㄦ剰锛氫笂浼犳帴鍙ｄ娇鐢ㄥ師鐢?fetch锛堥伩寮€ Axios 榛樿 Content-Type: application/json锛? * 鍏朵粬鎺ュ彛缁х画浣跨敤 request锛圓xios锛? */
import request from '@/utils/request';
import { getToken } from '@/utils/auth';
import type {
  ImportPreviewResponse,
  ImportConfirmResponse,
  ExportJobResponse,
  RecalcTaskListResponse,
  RecalcRetryResponse,
  CreateExportJobRequest,
} from '@biz-reporting/shared-types';

/** 鍒涘缓瀵煎叆浠诲姟鍝嶅簲 */
interface CreateImportJobResponse {
  jobId: number;
  status: string;
  filename?: string;
}

const UPLOAD_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/** 鍘熺敓 fetch 涓婁紶鏂囦欢锛坢ultipart/form-data锛屼笉璁?Content-Type锛?*/
async function uploadFile<T>(url: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${UPLOAD_BASE}${url}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getToken()}` },
    body: fd,
  });
  const data = await res.json();
  if (!res.ok) {
    throw { response: { data } };
  }
  return data;
}

/** 涓婁紶鍚堝悓瀵煎叆 */
export function uploadContracts(file: File): Promise<CreateImportJobResponse> {
  return uploadFile('/admin/imports/contracts/upload', file);
}

/** 涓婁紶鍩庡競鎶ヨ〃瀵煎叆 */
export function uploadReporting(file: File): Promise<CreateImportJobResponse> {
  return uploadFile('/city/imports/reporting/upload', file);
}

/** 鑾峰彇瀵煎叆棰勮 */
export function getImportPreview(jobId: number): Promise<ImportPreviewResponse> {
  return request.get(`/imports/${jobId}/preview`);
}

/** 纭瀵煎叆 */
export function confirmImport(jobId: number, body?: { confirmOverwrite?: boolean; cityId?: number; reportYear?: number }): Promise<ImportConfirmResponse> {
  return request.post(`/imports/${jobId}/confirm`, body || { confirmOverwrite: true });
}

/** 鍒涘缓瀵煎嚭浠诲姟 */
export function createExportJob(data: CreateExportJobRequest): Promise<CreateImportJobResponse> {
  return request.post('/exports', data);
}

/** 鑾峰彇瀵煎嚭浠诲姟 */
export function getExportJob(jobId: number): Promise<ExportJobResponse> {
  return request.get(`/exports/${jobId}`);
}

/** 鑾峰彇閲嶇畻浠诲姟鍒楄〃 */
export function listRecalcTasks(): Promise<RecalcTaskListResponse> {
  return request.get('/admin/recalc-tasks');
}

/** 閲嶈瘯閲嶇畻浠诲姟 */
export function retryRecalcTask(taskId: number): Promise<RecalcRetryResponse> {
  return request.post(`/admin/recalc-tasks/${taskId}/retry`, { retryMode: 'full' });
}

