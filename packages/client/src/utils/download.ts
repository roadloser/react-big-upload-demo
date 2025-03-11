import axios from 'axios';
import streamSaver from 'streamsaver';
import { AsyncOperation } from '../types/utils';
import { asyncPool, retryOperation } from './async';

/**
 * 下载参数接口
 */
export interface DownloadOptions {
  /** 下载URL */
  url: string;
  /** 文件名 */
  filename: string;
  /** 分片大小（字节） */
  chunkSize?: number;
  /** 并发下载数量 */
  concurrency?: number;
  /** 进度回调函数 */
  onProgress?: (progress: number) => void;
  /** 用于取消下载的AbortSignal */
  signal?: AbortSignal;
  /** 失败重试次数 */
  retries?: number;
  /** 是否启用流式下载 */
  streamDownload?: boolean;
}

/**
 * 分片信息接口
 */
interface ChunkInfo {
  /** 分片起始位置 */
  start: number;
  /** 分片结束位置 */
  end: number;
  /** 分片索引 */
  index: number;
}

/**
 * 获取文件大小
 * @param url 文件URL
 * @param signal 取消信号
 * @returns 文件大小（字节）
 */
async function getFileSize(url: string, signal?: AbortSignal): Promise<number> {
  try {
    const response = await axios.head(url, { signal });
    const contentLength = response.headers['content-length'];
    return contentLength ? parseInt(contentLength, 10) : 0;
  } catch (error) {
    if (axios.isCancel(error)) {
      throw new Error('下载已取消');
    }
    console.error('获取文件大小失败:', error);
    throw new Error('获取文件大小失败');
  }
}

/**
 * 创建分片信息数组
 * @param fileSize 文件总大小
 * @param chunkSize 分片大小
 * @returns 分片信息数组
 */
function createChunks(fileSize: number, chunkSize: number): ChunkInfo[] {
  const chunks: ChunkInfo[] = [];
  let start = 0;

  while (start < fileSize) {
    const end = Math.min(start + chunkSize - 1, fileSize - 1);
    chunks.push({
      start,
      end,
      index: chunks.length,
    });
    start = end + 1;
  }

  return chunks;
}

/**
 * 下载单个分片
 * @param url 文件URL
 * @param chunk 分片信息
 * @param signal 取消信号
 * @returns 分片数据的响应
 */
async function downloadChunk(
  url: string,
  chunk: ChunkInfo,
  signal?: AbortSignal,
): Promise<{ data: ArrayBuffer; chunk: ChunkInfo }> {
  const response = await axios.get(url, {
    headers: {
      Range: `bytes=${chunk.start}-${chunk.end}`,
    },
    responseType: 'arraybuffer',
    signal,
  });

  return { data: response.data, chunk };
}

/**
 * 使用分片并行下载文件
 * @param options 下载选项
 * @returns Promise，完成时表示下载完成
 */
export async function downloadFileWithChunks({
  url,
  filename,
  chunkSize = 1024 * 1024 * 2, // 默认2MB
  concurrency = 3,
  onProgress,
  signal,
  retries = 3,
  streamDownload = true,
}: DownloadOptions): Promise<void> {
  // 检查是否已取消
  if (signal?.aborted) {
    throw new Error('下载已取消');
  }

  try {
    // 获取文件大小
    const fileSize = await getFileSize(url, signal);
    if (fileSize === 0) {
      throw new Error('无法获取文件大小');
    }

    // 创建分片信息
    const chunks = createChunks(fileSize, chunkSize);
    let downloadedBytes = 0;

    // 设置进度更新函数
    const updateProgress = (chunkSize: number) => {
      downloadedBytes += chunkSize;
      const progress = Math.floor((downloadedBytes / fileSize) * 100);
      onProgress?.(progress);
    };

    if (streamDownload) {
      // 使用StreamSaver进行流式下载
      const fileStream = streamSaver.createWriteStream(filename, {
        size: fileSize, // 设置预期的文件大小
      });
      const writer = fileStream.getWriter();

      // 添加取消监听
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            writer.abort();
            writer.releaseLock();
            throw new Error('下载已取消');
          },
          { once: true },
        );
      }

      // 并行下载所有分片
      await asyncPool(concurrency, chunks, async chunk => {
        // 检查是否已取消
        if (signal?.aborted) {
          throw new Error('下载已取消');
        }

        // 使用重试机制下载分片
        const operation: AsyncOperation<{
          data: ArrayBuffer;
          chunk: ChunkInfo;
        }> = () => {
          return downloadChunk(url, chunk, signal);
        };

        try {
          const { data, chunk: chunkInfo } = await retryOperation(operation, {
            maxAttempts: retries,
            retryDelay: attempt => 2 ** attempt * 1000, // 指数退避策略
            onError: error => {
              console.error(`分片 ${chunk.index} 下载失败，尝试重试:`, error);
            },
          });

          // 写入数据到流
          await writer.write(new Uint8Array(data));

          // 更新进度
          updateProgress(chunkInfo.end - chunkInfo.start + 1);

          return { success: true, index: chunk.index };
        } catch (error) {
          console.error(`分片 ${chunk.index} 下载失败:`, error);
          throw error;
        }
      });

      // 关闭流
      writer.close();
    } else {
      // 非流式下载，收集所有分片后再一次性下载
      const chunksData: { data: ArrayBuffer; chunk: ChunkInfo }[] = [];

      // 并行下载所有分片
      await asyncPool(concurrency, chunks, async chunk => {
        // 检查是否已取消
        if (signal?.aborted) {
          throw new Error('下载已取消');
        }

        // 使用重试机制下载分片
        const operation: AsyncOperation<{
          data: ArrayBuffer;
          chunk: ChunkInfo;
        }> = () => {
          return downloadChunk(url, chunk, signal);
        };

        try {
          const result = await retryOperation(operation, {
            maxAttempts: retries,
            retryDelay: attempt => 2 ** attempt * 1000,
            onError: error => {
              console.error(`分片 ${chunk.index} 下载失败，尝试重试:`, error);
            },
          });

          // 保存分片数据
          chunksData.push(result);

          // 更新进度
          updateProgress(result.chunk.end - result.chunk.start + 1);

          return { success: true, index: chunk.index };
        } catch (error) {
          console.error(`分片 ${chunk.index} 下载失败:`, error);
          throw error;
        }
      });

      // 按索引排序分片
      chunksData.sort((a, b) => a.chunk.index - b.chunk.index);

      // 合并所有分片
      const blob = new Blob(
        chunksData.map(item => new Uint8Array(item.data)),
        { type: 'application/octet-stream' },
      );

      // 创建下载链接
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      // 清理
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
      }, 100);
    }
  } catch (error) {
    if (
      axios.isCancel(error) ||
      (error instanceof Error && error.message === '下载已取消')
    ) {
      throw new Error('下载已取消');
    }
    console.error('下载文件失败:', error);
    throw error;
  }
}
