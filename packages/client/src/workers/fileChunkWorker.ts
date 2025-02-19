/**
 * 文件分片处理的Web Worker
 * 该Worker负责将大文件切分成小块，以支持断点续传和并发上传
 */

/**
 * 分片数据接口定义
 * @property chunk - 分片的二进制数据
 * @property index - 分片的序号
 * @property id - 分片的唯一标识
 */
interface ChunkData {
  chunk: ArrayBuffer;
  index: number;
  id: string;
}

/**
 * 生成文件唯一标识
 * @param file - 文件对象
 * @returns 文件的唯一标识字符串
 */
const generateFileId = (file: File): string => {
  return `${file.name}-${file.size}-${file.lastModified}`;
};

/**
 * 处理文件分片
 * @param file - 文件对象
 * @param chunkSize - 分片大小
 * @returns 分片数据的异步生成器
 */
const processFileChunks = async function* (file: File, chunkSize: number): AsyncGenerator<ChunkData> {
  const fileId = generateFileId(file);
  let offset = 0;

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    const chunkBuffer = await chunk.arrayBuffer();
    const chunkId = `${fileId}-${offset}`;

    yield {
      chunk: chunkBuffer,
      index: Math.floor(offset / chunkSize),
      id: chunkId,
    };

    offset += chunkSize;
  }
};

/**
 * Worker消息处理函数
 * 接收主线程发送的文件对象和分片大小，进行文件分片处理
 */
self.onmessage = async (e: MessageEvent<{ file: File; chunkSize: number }>) => {
  const { file, chunkSize } = e.data;
  const fileId = generateFileId(file);
  const totalChunks = Math.ceil(file.size / chunkSize);
  const batchSize = 5; // 每批处理的分片数量
  let processedChunks = 0;
  let currentBatch: ChunkData[] = [];

  try {
    // 使用异步生成器处理分片
    const chunkGenerator = processFileChunks(file, chunkSize);

    while (true) {
      try {
        const { value: chunk, done } = await chunkGenerator.next();

        if (done) break;

        currentBatch.push(chunk);
        processedChunks++;

        // 当达到批处理大小或处理完所有分片时，发送当前批次
        if (currentBatch.length >= batchSize || processedChunks === totalChunks) {
          self.postMessage({
            chunks: currentBatch,
            fileId,
            totalChunks,
            processedChunks,
            isComplete: processedChunks === totalChunks,
          });

          // 清空当前批次并手动触发垃圾回收
          currentBatch = [];
          if (globalThis.gc) {
            globalThis.gc();
          }

          // 添加小延迟，让系统有时间进行内存清理
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } catch (chunkError: Error | unknown) {
        console.error('处理单个分片时发生错误：', chunkError);
        throw new Error(`处理分片${processedChunks}时失败：${chunkError instanceof Error ? chunkError.message : String(chunkError)}`);
      }
    }
  } catch (error) {
    console.error('文件处理过程中发生错误：', error);
    self.postMessage({
      error: error instanceof Error ? error.message : '文件处理失败',
      fileId,
      totalChunks,
      processedChunks,
      isComplete: false,
    });
  }
};
