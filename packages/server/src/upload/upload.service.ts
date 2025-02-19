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
    this.db = this.databaseService.createDatabase(join(this.uploadDir, 'chunks.db'));
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
    totalSize, // 添加totalSize参数
  }: ChunkInfo): Promise<{ status: string; path?: string; uploaded?: number }> {
    // 参数验证
    this.validateChunkParams({ chunk, hash, filename, fileHash, index, size, totalSize });

    const chunkDir = join(this.uploadDir, fileHash);
    const chunkPath = join(chunkDir, `${index}`);

    // 创建分片目录
    await this.createChunkDirectory(chunkDir);

    // 保存分片文件
    await this.saveChunkFile(chunkPath, chunk);

    // 记录分片信息到数据库
    await this.insertChunk({
      hash,
      filename,
      fileHash,
      index,
      size,
      totalSize,
      path: chunkPath,
    });

    // 获取已上传的分片信息
    const uploadedChunks = await this.findChunks(fileHash);
    const expectedChunksCount = Math.ceil(totalSize / (2 * 1024 * 1024)); // 2MB per chunk

    // 检查是否所有分片都已上传
    if (uploadedChunks.length === expectedChunksCount) {
      return this.mergeChunks(chunkDir, filename, fileHash);
    }

    return { status: 'uploading', uploaded: uploadedChunks.length };
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
  private async saveChunkFile(filePath: string, content: Buffer): Promise<void> {
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

    try {
      const chunks = await this.findChunks(fileHash);
      
      // 验证分片完整性
      const sortedChunks = chunks.sort((a, b) => a.index - b.index);
      for (let i = 0; i < sortedChunks.length; i++) {
        if (sortedChunks[i].index !== i) {
          throw new Error(`分片序列不完整，缺少索引 ${i} 的分片`);
        }
        // 验证分片文件是否存在
        try {
          await fs.access(join(chunkDir, `${i}`));
        } catch {
          throw new Error(`分片文件 ${i} 不存在`);
        }
      }

      // 使用管道流进行文件合并
      for (const chunk of sortedChunks) {
        if (hasError) break;
        try {
          const chunkData = await fs.readFile(join(chunkDir, `${chunk.index}`));
          await new Promise((resolve, reject) => {
            writeStream.write(chunkData, err => {
              if (err) {
                hasError = true;
                reject(new Error(`写入文件块失败: ${err.message}`));
              } else resolve(true);
            });
          });
        } catch (err) {
          hasError = true;
          throw new Error(`处理分片 ${chunk.index} 时发生错误: ${err.message}`);
        }
      }

      if (!hasError) {
        writeStream.end();
        // 验证最终文件大小
        const stats = await fs.stat(filePath);
        const expectedSize = chunks.reduce((acc, chunk) => acc + chunk.size, 0);
        if (stats.size !== expectedSize) {
          throw new Error(`文件大小校验失败: 预期 ${expectedSize} 字节，实际 ${stats.size} 字节`);
        }

        // 清理分片文件和记录
        await fs.rm(chunkDir, { recursive: true });
        await this.removeChunks(fileHash);

        return { status: 'complete', path: filePath };
      } else {
        throw new Error('文件合并过程中发生错误');
      }
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
        (err) => {
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
  async getUploadedFiles(): Promise<Array<{
    filename: string;
    size: number;
    type: string;
    path: string;
    createdAt: Date;
  }>> {
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
