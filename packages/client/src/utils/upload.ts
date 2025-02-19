import axios from 'axios';

/**
 * 分片上传参数接口
 * @property chunk - 文件分片的二进制数据
 * @property filename - 文件名
 * @property fileId - 文件唯一标识
 * @property index - 分片序号
 * @property size - 分片大小
 * @property file - 原始文件对象
 */
interface ChunkUploadParams {
  chunk: Blob;
  filename: string;
  fileId: string;
  index: number;
  size: number;
  file: File;
}

/**
 * Worker处理后的分片数据接口
 * @property chunks - 分片数组，包含每个分片的数据和元信息
 * @property fileId - 文件唯一标识
 * @property totalChunks - 总分片数
 */
interface WorkerChunkData {
  chunks: Array<{
    chunk: ArrayBuffer;
    index: number;
    id: string;
  }>;
  fileId: string;
  totalChunks: number;
}

/**
 * 创建文件分片处理的Web Worker实例
 * @returns Worker实例，用于处理文件分片
 */
export const createChunkUploadWorker = () => {
  return new Worker(new URL('../workers/fileChunkWorker.ts', import.meta.url), {
    type: 'module',
  });
};

/**
 * 上传单个文件分片
 * @param params - 分片上传参数
 * @returns 服务器响应数据
 */
export const uploadChunk = async ({
  chunk,
  filename,
  fileId,
  index,
  size,
  file,
}: ChunkUploadParams) => {
  const formData = new FormData();
  formData.append('chunk', chunk);
  formData.append('filename', filename);
  formData.append('fileHash', fileId);
  formData.append('hash', `${fileId}-${index}`);
  formData.append('index', String(index));
  formData.append('size', String(size));
  formData.append('totalSize', String(file.size));

  const response = await axios.post('/api/upload/chunk', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

/**
 * 处理文件分片
 * @param file - 要处理的文件对象
 * @param chunkSize - 分片大小（字节）
 * @returns Promise，解析为处理后的分片数据
 */
export const processFileChunks = (
  file: File,
  chunkSize: number,
): Promise<WorkerChunkData> => {
  return new Promise((resolve, reject) => {
    // 创建Worker实例处理文件分片
    const worker = createChunkUploadWorker();

    // 处理Worker返回的消息
    worker.onmessage = (e: MessageEvent<WorkerChunkData>) => {
      worker.terminate(); // 处理完成后终止Worker
      resolve(e.data);
    };

    // 处理Worker错误
    worker.onerror = error => {
      worker.terminate(); // 发生错误时终止Worker
      reject(error);
    };

    // 发送文件和分片大小到Worker进行处理
    worker.postMessage({ file, chunkSize });
  });
};
