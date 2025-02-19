import { AsyncOperation, AsyncPoolFunction } from '../types/utils';

/**
 * 重试执行异步操作
 * @param operation - 要重试的异步操作
 * @param maxRetries - 最大重试次数
 * @param delay - 重试延迟时间（毫秒）
 * @returns 操作结果的Promise
 */
export const retryOperation = async <T>(
  operation: AsyncOperation<T>,
  maxRetries = 3,
  delay = 1000,
): Promise<T> => {
  let lastError: Error | unknown;
  try {
    return await operation();
  } catch (error) {
    lastError = error;
    for (let i = 1; i < maxRetries; i += 1) {
      try {
        await new Promise(resolve => {
          setTimeout(resolve, delay * i);
        });
        return await operation();
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError;
};

/**
 * 并发控制函数
 * @param concurrency - 最大并发数
 * @param items - 要处理的项目数组
 * @param fn - 处理每个项目的异步函数
 * @returns 所有操作结果的Promise数组
 */
export const asyncPool = async <T, R>(
  concurrency: number,
  items: T[],
  fn: AsyncPoolFunction<T, R>,
): Promise<R[]> => {
  const pool = new Set<Promise<R>>();
  const results: Promise<R>[] = [];

  await Promise.all(
    items.map(async item => {
      while (pool.size >= concurrency) {
        await Promise.race(pool);
      }
      const promise = fn(item);
      const result = promise.then(value => {
        pool.delete(promise);
        return value;
      });
      pool.add(promise);
      results.push(result);
    }),
  );

  return Promise.all(results);
};
