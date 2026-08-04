/**
 * 内容寻址逻辑键工具（设计 §4.2 / 裁决 D-4）。
 *
 * 硬性约束：
 * - **逻辑键恒为 `${sha256.slice(0,2)}/${sha256}`，不含任何 COS prefix。**
 *   持久化到 MySQL 的 `source_file_storage_key` 只允许是逻辑键。
 * - 校验正则必须与 `fact-source-file-storage.service.ts` 原 `resolveKey()` 逐字符一致。
 *
 * 本文件为纯函数模块：不得引入 node:fs / cos-nodejs-sdk-v5 / @nestjs/typeorm。
 */
import { createHash } from 'node:crypto';
import { FactSourceStorageError } from './fact-source-storage.error';

/** 与原 resolveKey() 正则逐字符一致（fact-source-file-storage.service.ts 原 :90）。 */
export const LOGICAL_STORAGE_KEY_PATTERN = /^[a-f0-9]{2}\/[a-f0-9]{64}$/;

/** 小写 hex sha256 字面量。 */
export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

/** 未知 MIME 时的兜底类型。 */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** 扩展名 → MIME 的最小映射；仅用于 COS 对象 Content-Type header 与返回值，不入库（裁决 D-3）。 */
const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
});

/** 计算 Buffer 的小写 hex sha256。 */
export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 由 sha256 生成逻辑键。sha256 非法时抛 SOURCE_FILE_STORAGE_KEY_INVALID。 */
export function buildLogicalKey(sha256: string): string {
  if (!SHA256_HEX_PATTERN.test(sha256)) {
    throw new FactSourceStorageError('SOURCE_FILE_STORAGE_KEY_INVALID');
  }
  return `${sha256.slice(0, 2)}/${sha256}`;
}

/** 校验逻辑键格式；不符抛 SOURCE_FILE_STORAGE_KEY_INVALID。 */
export function assertLogicalStorageKey(storageKey: string): void {
  if (!LOGICAL_STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new FactSourceStorageError('SOURCE_FILE_STORAGE_KEY_INVALID');
  }
}

/** 由逻辑键反推 sha256（内容寻址下二者等价）。 */
export function sha256FromLogicalKey(storageKey: string): string {
  assertLogicalStorageKey(storageKey);
  return storageKey.slice(3);
}

/**
 * 由原始文件名推断 contentType。
 * 仅用于返回值与 COS 对象 header；**本轮不入库**（裁决 D-3 / 设计 §5.3）。
 */
export function guessContentType(originalName: string): string {
  const name = String(originalName || '').toLowerCase();
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex < 0) return DEFAULT_CONTENT_TYPE;
  return CONTENT_TYPE_BY_EXTENSION[name.slice(dotIndex)] ?? DEFAULT_CONTENT_TYPE;
}

/**
 * 规范化 COS 对象前缀：空字符串或以 '/' 结尾。
 * 非法时抛 SOURCE_FILE_STORAGE_CONFIG_INVALID。
 */
export function normalizeObjectPrefix(prefix: string | undefined): string {
  const value = (prefix ?? '').trim();
  if (value === '') return '';
  if (value.startsWith('/')) {
    throw new FactSourceStorageError('SOURCE_FILE_STORAGE_CONFIG_INVALID');
  }
  return value.endsWith('/') ? value : `${value}/`;
}
