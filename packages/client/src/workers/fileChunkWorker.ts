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
 * Worker消息处理函数
 * 接收主线程发送的文件对象和分片大小，进行文件分片处理
 */
self.onmessage = async (e: MessageEvent<{ file: File; chunkSize: number }>) => {
  const { file, chunkSize } = e.data;
  const chunks: ChunkData[] = [];
  let offset = 0;

  // 生成文件唯一标识，使用文件名、大小和最后修改时间确保唯一性
  const fileId = `${file.name}-${file.size}-${file.lastModified}`;

  // 循环处理文件，将文件切分成固定大小的块
  while (offset < file.size) {
    // 使用File.slice()方法切分文件
    const chunk = file.slice(offset, offset + chunkSize);
    // 将分片转换为ArrayBuffer，便于传输和处理
    const chunkBuffer = await chunk.arrayBuffer();

    // 使用文件ID和偏移量生成分片的唯一标识
    const chunkId = `${fileId}-${offset}`;

    // 将分片信息添加到数组中
    chunks.push({
      chunk: chunkBuffer,
      index: Math.floor(offset / chunkSize), // 计算分片序号
      id: chunkId,
    });

    // 更新偏移量，处理下一个分片
    offset += chunkSize;
  }

  self.postMessage({
    chunks,
    fileId,
    totalChunks: chunks.length,
  });
};
