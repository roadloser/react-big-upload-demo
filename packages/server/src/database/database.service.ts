import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as Datastore from 'nedb';

/**
 * 数据库服务
 * 负责管理数据库实例的创建和连接
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly databasePool: Map<string, Datastore> = new Map();

  /**
   * 创建数据库实例
   * @param databasePath - 数据库文件路径
   * @returns Datastore实例
   * @throws Error 当数据库创建失败时
   */
  createDatabase(databasePath: string): Datastore {
    const existingDatabase = this.databasePool.get(databasePath);
    if (existingDatabase) {
      return existingDatabase;
    }

    try {
      const databaseInstance = new Datastore({
        filename: databasePath,
        autoload: true,
        onload: (error) => {
          if (error) {
            console.error(`数据库加载失败: ${databasePath}`, error);
          }
        },
      });

      databaseInstance.loadDatabase((error) => {
        if (error) {
          console.error(`数据库加载失败: ${databasePath}`, error);
        }
      });

      this.databasePool.set(databasePath, databaseInstance);
      return databaseInstance;
    } catch (error) {
      const errorMessage = `创建数据库实例失败: ${error.message}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * 获取已存在的数据库实例
   * @param databasePath - 数据库文件路径
   * @returns 数据库实例，如果不存在则返回undefined
   */
  getDatabase(databasePath: string): Datastore | undefined {
    return this.databasePool.get(databasePath);
  }

  /**
   * 模块销毁时清理数据库连接
   */
  async onModuleDestroy(): Promise<void> {
    const cleanupPromises = Array.from(this.databasePool.entries()).map(
      async ([path, database]) => {
        try {
          await new Promise<void>((resolve) => {
            database.persistence.compactDatafile();
            database.persistence.stopAutocompaction();
            resolve();
          });
          this.databasePool.delete(path);
        } catch (error) {
          console.error(`关闭数据库失败: ${path}`, error);
        }
      },
    );

    await Promise.all(cleanupPromises);
  }
}