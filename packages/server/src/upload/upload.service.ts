import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import { join } from 'path';
import * as Datastore from 'nedb';
import { DatabaseService } from '../database/database.service';

/**
 * 文件分片信息接口
 */
interface ChunkInfo {
  chunk: Buffer;
  hash: string;
  filename: string;
  fileHash: string;
  index: number;
  size: number;
  totalSize: number;
}

/**
 * 文件上传服务
 * 负责处理文件分片的上传、存储和合并操作
 */
@Injectable()
export class UploadService {
  private readonly uploadDir: string;

  private readonly db: Datastore;

  constructor(private readonly databaseService: DatabaseService) {
    // 确保uploadDir始终指向项目根目录下的uploads文件夹
    this.uploadDir = join(process.cwd(), 'uploads');
    this.db = this.databaseService.createDatabase(
      join(this.uploadDir, 'chunks.db'),
    );
    this.ensureUploadDir();
  }

  /**
   * 确保上传目录存在
   */
  private async ensureUploadDir(): Promise<void> {
    try {
      await fs.access(this.uploadDir);
    } catch {
      await fs.mkdir(this.uploadDir, { recursive: true });
    }
  }

  /**
   * 处理文件分片上传
   * @param chunkInfo - 分片信息
   * @returns 上传状态和相关信息
   */
  async handleChunk({
    chunk,
    hash,
    filename,
    fileHash,
    index,
    size,
    totalSize,
  }: ChunkInfo): Promise<{ status: string; path?: string; uploaded?: number }> {
    try {
      console.log('接收到文件分片请求：', {
        filename,
        fileHash,
        index,
        size,
        totalSize,
        chunkSize: chunk?.length,
        timestamp: new Date().toISOString(),
        memoryUsage: process.memoryUsage(),
      });

      // 参数验证
      this.validateChunkParams({
        chunk,
        hash,
        filename,
        fileHash,
        index,
        size,
        totalSize,
      });

      const chunkDir = join(this.uploadDir, fileHash);
      const chunkPath = join(chunkDir, `${index}`);

      // 创建分片目录
      await this.createChunkDirectory(chunkDir);

      // 保存分片文件
      await this.saveChunkFile(chunkPath, chunk);

      // 删除同一索引的旧分片记录
      await this.removeChunkByIndex(fileHash, index);

      // 记录新的分片信息到数据库
      await this.insertChunk({
        hash,
        filename,
        fileHash,
        index,
        size,
        totalSize,
        path: chunkPath,
      });

      // 获取已上传的分片信息（已去重）
      const uploadedChunks = await this.findChunks(fileHash);
      const chunkSize = 2 * 1024 * 1024; // 2MB per chunk
      const expectedChunksCount = Math.ceil(totalSize / chunkSize);

      console.log('文件分片计算详情：', {
        fileHash,
        filename,
        totalSize,
        chunkSize,
        uploadedChunksCount: uploadedChunks.length,
        expectedChunksCount,
        uniqueIndices: [...new Set(uploadedChunks.map(chunk => chunk.index))]
          .length,
        calculation: `${totalSize} / ${chunkSize} = ${totalSize / chunkSize} (向上取整为 ${expectedChunksCount})`,
      });

      // 检查是否所有分片都已上传
      if (uploadedChunks.length === expectedChunksCount) {
        // 验证分片序列的完整性
        const indices = uploadedChunks
          .map(chunk => chunk.index)
          .sort((a, b) => a - b);
        const isSequenceComplete = indices.every((index, i) => index === i);

        if (!isSequenceComplete) {
          throw new Error('分片序列不完整，请重新上传缺失的分片');
        }

        console.log('所有分片已上传完成，开始合并文件');
        return this.mergeChunks(chunkDir, filename, fileHash);
      }

      console.log(
        `文件分片上传进度：${uploadedChunks.length}/${expectedChunksCount}`,
      );
      return { status: 'uploading', uploaded: uploadedChunks.length };
    } catch (error) {
      console.error('处理分片时发生错误：', {
        error: error.message,
        stack: error.stack,
        context: {
          filename,
          fileHash,
          index,
          size,
          totalSize,
          memoryUsage: process.memoryUsage(),
        },
      });
      throw error;
    }
  }

  /**
   * 验证分片参数
   */
  private validateChunkParams({
    chunk,
    hash,
    filename,
    fileHash,
    index,
    size,
    totalSize,
  }: ChunkInfo): void {
    console.log('验证分片参数：', {
      fileHash,
      filename,
      index,
      hash,
      chunkSize: chunk?.length,
      size,
      totalSize,
    });

    if (!fileHash) {
      throw new Error('fileHash参数不能为空');
    }
    if (!filename) {
      throw new Error('filename参数不能为空');
    }
    if (typeof index !== 'number') {
      throw new Error('index参数必须为数字类型');
    }
    if (!hash) {
      throw new Error('hash参数不能为空');
    }
    if (!chunk || !(chunk instanceof Buffer)) {
      throw new Error('chunk参数必须是有效的Buffer类型');
    }
    if (typeof size !== 'number' || size <= 0) {
      throw new Error('size参数必须是大于0的数字');
    }
    if (typeof totalSize !== 'number' || totalSize <= 0) {
      throw new Error('totalSize参数必须是大于0的数字');
    }
  }

  /**
   * 创建分片目录
   */
  private async createChunkDirectory(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch (err) {
      try {
        await fs.mkdir(dirPath, { recursive: true });
      } catch (mkdirErr) {
        throw new Error(`创建分片目录失败: ${mkdirErr.message}`);
      }
    }
  }

  /**
   * 保存分片文件
   */
  private async saveChunkFile(
    filePath: string,
    content: Buffer,
  ): Promise<void> {
    try {
      await fs.writeFile(filePath, content);
    } catch (writeErr) {
      throw new Error(`保存分片失败: ${writeErr.message}`);
    }
  }

  /**
   * 合并分片文件
   */
  private async mergeChunks(
    chunkDir: string,
    filename: string,
    fileHash: string,
  ): Promise<{ status: string; path: string }> {
    const filePath = join(this.uploadDir, filename);
    const writeStream = fsSync.createWriteStream(filePath);
    let hasError = false;
    let totalProcessedSize = 0;

    try {
      const chunks = await this.findChunks(fileHash);

      // 验证分片完整性
      const sortedChunks = chunks.sort((a, b) => a.index - b.index);
      const totalSize = chunks.reduce((acc, chunk) => acc + chunk.size, 0);
      console.log('开始合并文件：', {
        filename,
        fileHash,
        totalChunks: sortedChunks.length,
        totalSize: `${(totalSize / 1024 / 1024).toFixed(2)}MB`,
        chunks: sortedChunks.map(chunk => ({
          index: chunk.index,
          size: `${(chunk.size / 1024 / 1024).toFixed(2)}MB`,
        })),
      });

      for (let i = 0; i < sortedChunks.length; i++) {
        if (sortedChunks[i].index !== i) {
          console.error(
            `分片序列不完整，期望索引 ${i}，实际索引 ${sortedChunks[i].index}`,
          );
          throw new Error(`分片序列不完整，缺少索引 ${i} 的分片`);
        }
        // 验证分片文件是否存在
        try {
          await fs.access(join(chunkDir, `${i}`));
          console.log(`验证分片 ${i} 文件存在`);
        } catch {
          console.error(`分片文件 ${i} 不存在`);
          throw new Error(`分片文件 ${i} 不存在`);
        }
      }

      // 使用流式处理进行文件合并
      for (const chunk of sortedChunks) {
        if (hasError) break;
        try {
          console.log(`开始处理分片 ${chunk.index}，大小：${chunk.size} 字节`);
          const readStream = fsSync.createReadStream(
            join(chunkDir, `${chunk.index}`),
          );
          await new Promise((resolve, reject) => {
            readStream.on('error', err => {
              hasError = true;
              console.error(`读取分片 ${chunk.index} 时发生错误:`, err);
              reject(
                new Error(`读取分片 ${chunk.index} 时发生错误: ${err.message}`),
              );
            });

            readStream.on('end', () => {
              totalProcessedSize += chunk.size;
              const progress = (
                (totalProcessedSize /
                  chunks.reduce((acc, c) => acc + c.size, 0)) *
                100
              ).toFixed(2);
              console.log('合并进度：', {
                chunkIndex: chunk.index,
                chunkSize: `${(chunk.size / 1024 / 1024).toFixed(2)}MB`,
                processedSize: `${(totalProcessedSize / 1024 / 1024).toFixed(2)}MB`,
                progress: `${progress}%`,
                memoryUsage: process.memoryUsage(),
              });
              resolve(true);
            });

            writeStream.on('error', err => {
              hasError = true;
              console.error(`写入分片 ${chunk.index} 时发生错误:`, err);
              reject(
                new Error(`写入分片 ${chunk.index} 时发生错误: ${err.message}`),
              );
            });

            readStream.pipe(writeStream, { end: false });
          });

          // 验证分片写入是否成功
          const stats = await fs.stat(filePath);
          console.log(
            `当前文件大小：${stats.size} 字节，预期增加：${chunk.size} 字节`,
          );
        } catch (err) {
          hasError = true;
          console.error(`处理分片 ${chunk.index} 时发生错误:`, err);
          throw new Error(`处理分片 ${chunk.index} 时发生错误: ${err.message}`);
        }
      }

      if (!hasError) {
        writeStream.end();
        // 验证最终文件大小
        const stats = await fs.stat(filePath);
        const expectedSize = chunks.reduce((acc, chunk) => acc + chunk.size, 0);
        console.log('文件合并完成：', {
          filename,
          fileHash,
          actualSize: `${(stats.size / 1024 / 1024).toFixed(2)}MB`,
          expectedSize: `${(expectedSize / 1024 / 1024).toFixed(2)}MB`,
          memoryUsage: process.memoryUsage(),
        });
        if (stats.size !== expectedSize) {
          console.error(
            `文件大小校验失败: 预期 ${expectedSize} 字节，实际 ${stats.size} 字节`,
          );
          throw new Error(
            `文件大小校验失败: 预期 ${expectedSize} 字节，实际 ${stats.size} 字节`,
          );
        }

        // 清理分片文件和记录
        await fs.rm(chunkDir, { recursive: true });
        await this.removeChunks(fileHash);

        return { status: 'complete', path: filePath };
      }
      throw new Error('文件合并过程中发生错误');
    } catch (err) {
      hasError = true;
      writeStream.end();
      // 清理不完整的合并文件
      try {
        await fs.unlink(filePath);
      } catch {}
      throw err;
    }
  }

  /**
   * 插入分片记录
   * @param chunkRecord - 分片记录信息
   */
  private async insertChunk(chunkRecord: {
    hash: string;
    filename: string;
    fileHash: string;
    index: number;
    size: number;
    totalSize?: number;
    path: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.insert(
        {
          ...chunkRecord,
          timestamp: Date.now(),
        },
        err => {
          if (err) {
            reject(new Error(`记录分片信息失败: ${err.message}`));
          } else {
            resolve();
          }
        },
      );
    });
  }

  /**
   * 查询指定文件的所有分片
   * @param fileHash - 文件唯一标识
   */
  private async findChunks(fileHash: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.find({ fileHash }, (err, docs) => {
        if (err) {
          reject(new Error(`查询分片信息失败: ${err.message}`));
        } else {
          resolve(docs);
        }
      });
    });
  }

  /**
   * 删除指定文件的特定索引分片记录
   * @param fileHash - 文件唯一标识
   * @param index - 分片索引
   */
  private async removeChunkByIndex(
    fileHash: string,
    index: number,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.remove(
        { fileHash, index },
        { multi: true },
        (err, numRemoved) => {
          if (err) {
            reject(err);
          } else {
            resolve(numRemoved);
          }
        },
      );
    });
  }

  /**
   * 删除指定文件的所有分片记录
   * @param fileHash - 文件唯一标识
   */
  private async removeChunks(fileHash: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.remove({ fileHash }, { multi: true }, (err, numRemoved) => {
        if (err) {
          reject(err);
        } else {
          resolve(numRemoved);
        }
      });
    });
  }

  /**
   * 获取已上传的文件列表
   * @returns 文件列表，包含文件名、大小、类型等信息
   */
  async getUploadedFiles(): Promise<
    Array<{
      filename: string;
      size: number;
      type: string;
      path: string;
      createdAt: Date;
    }>
  > {
    try {
      const files = await fs.readdir(this.uploadDir);
      const fileInfos = await Promise.all(
        files
          .filter(file => file !== 'chunks.db' && file !== '.DS_Store')
          .map(async filename => {
            const filePath = join(this.uploadDir, filename);
            const stats = await fs.stat(filePath);

            // 排除文件夹
            if (stats.isDirectory()) {
              return null;
            }

            const type = this.getFileType(filename);

            return {
              filename,
              size: stats.size,
              type,
              path: filePath,
              createdAt: stats.birthtime,
            };
          }),
      );

      // 过滤掉null值（文件夹）
      return fileInfos.filter(Boolean);
    } catch (err) {
      throw new Error(`获取文件列表失败: ${err.message}`);
    }
  }

  /**
   * 根据文件名获取文件类型
   * @param filename - 文件名
   * @returns 文件类型
   */
  private getFileType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];

    if (imageExts.includes(ext)) {
      return 'image';
    }
    return 'file';
  }
}
