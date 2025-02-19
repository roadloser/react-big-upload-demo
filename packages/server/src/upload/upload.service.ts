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
  }: ChunkInfo): Promise<{ status: string; path?: string; uploaded?: number }> {
    // 参数验证
    this.validateChunkParams({ chunk, hash, filename, fileHash, index, size });

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
      path: chunkPath,
    });

    // 获取已上传的分片信息
    const uploadedChunks = await this.findChunks(fileHash);
    const totalSize = uploadedChunks.reduce((acc, cur) => acc + cur.size, 0);
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

    try {
      const chunks = await this.findChunks(fileHash);
      for (let i = 0; i < chunks.length; i++) {
        const chunkData = await fs.readFile(join(chunkDir, `${i}`));
        await new Promise((resolve, reject) => {
          writeStream.write(chunkData, err => {
            if (err) {
              reject(new Error(`写入文件块失败: ${err.message}`));
            } else resolve(true);
          });
        });
      }

      writeStream.end();

      // 清理分片文件和记录
      await fs.rm(chunkDir, { recursive: true });
      await this.removeChunks(fileHash);

      return { status: 'complete', path: filePath };
    } catch (err) {
      writeStream.end();
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
}
