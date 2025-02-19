import { AsyncOperation, AsyncPoolFunction } from '../types/utils';

/**
 * 重试执行异步操作
 * @param operation - 要重试的异步操作
 * @param maxRetries - 最大重试次数
 * @param delay - 重试延迟时间（毫秒）
 * @returns 操作结果的Promise
 */
interface RetryOptions {
  maxAttempts?: number;
  retryDelay?: number | ((attempt: number) => number);
  onError?: (error: unknown) => void;
}

export const retryOperation = async <T>(
  operation: AsyncOperation<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const { maxAttempts = 3, retryDelay = 1000, onError } = options;
  let lastError: Error | unknown;
  
  try {
    return await operation();
  } catch (error) {
    lastError = error;
    onError?.(error);

    for (let attempt = 1; attempt < maxAttempts; attempt++) {
      try {
        const delay = typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay * attempt;
        await new Promise(resolve => setTimeout(resolve, delay));
        return await operation();
      } catch (err) {
        lastError = err;
        onError?.(err);
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
  if (!Array.isArray(items)) {
    throw new Error('items must be an array');
  }

  const pool = new Set<Promise<R>>();
  const results: Promise<R>[] = [];

  try {
    await Promise.all(
      items.map(async item => {
        while (pool.size >= concurrency) {
          try {
            await Promise.race(pool);
          } catch (error) {
            console.error('Error in pool:', error);
          }
        }

        const promise = fn(item);
        const result = promise
          .then(value => {
            pool.delete(promise);
            return value;
          })
          .catch(error => {
            pool.delete(promise);
            console.error('Error in promise:', error);
            throw error;
          });

        pool.add(promise);
        results.push(result);
      }),
    );

    return Promise.all(results);
  } catch (error) {
    console.error('Error in asyncPool:', error);
    throw error;
  }
};
