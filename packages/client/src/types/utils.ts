/**
 * 工具函数相关的类型定义
 */

/**
 * 异步操作函数类型
 */
export type AsyncOperation<T = any> = () => Promise<T>;

/**
 * 异步池处理函数类型
 */
export type AsyncPoolFunction<T = any, R = any> = (item: T) => Promise<R>;
