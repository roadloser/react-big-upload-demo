import { useState, useCallback, useRef } from 'react';
import { Upload, Button, Progress, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { processFileChunks, uploadChunk } from '../utils/upload';
import { retryOperation, asyncPool } from '../utils/async';

const CHUNK_SIZE = 1024 * 1024 * 2; // 2MB per chunk
const MAX_RETRIES = 3;

interface FileUploaderProps {
  onUploadSuccess?: () => void;
}

export function FileUploader({ onUploadSuccess }: FileUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const uploadedChunksRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    uploadedChunksRef.current.clear();
    setUploading(false);
    setProgress(0);
    setFileList([]);
    message.info('上传已取消');
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      try {
        setUploading(true);
        setProgress(0);
        uploadedChunksRef.current.clear(); // 清空已上传分片记录

        abortControllerRef.current = new AbortController();

        const { chunks, fileId, totalChunks, worker } = await processFileChunks(
          file,
          CHUNK_SIZE,
          abortControllerRef.current.signal, // 传递AbortSignal
        );

        workerRef.current = worker;

        let completed = 0;
        const failedChunks = new Set<number>(); // 记录上传失败的分片

        await asyncPool(3, chunks, async ({ chunk, index, id }) => {
          // 检查是否已取消上传
          if (!abortControllerRef.current) {
            throw new Error('上传已取消');
          }
          // 检查分片是否已上传成功
          if (uploadedChunksRef.current.has(id)) {
            completed++;
            setProgress(Math.floor((completed / totalChunks) * 100));
            return;
          }

          try {
            const blob = new Blob([chunk]);
            await retryOperation(
              async () => {
                const response = await uploadChunk({
                  chunk: blob,
                  filename: file.name,
                  fileId,
                  index,
                  size: blob.size,
                  file,
                  signal: abortControllerRef.current?.signal,
                });

                // 记录上传成功的分片
                if (
                  response.status === 'uploading' ||
                  response.status === 'complete'
                ) {
                  uploadedChunksRef.current.add(id);
                  completed++;
                  setProgress(Math.floor((completed / totalChunks) * 100));
                }

                return response;
              },
              {
                maxAttempts: MAX_RETRIES,
                onError: error => {
                  console.error(`分片 ${index} 上传失败:`, error);
                  failedChunks.add(index);
                },
              },
            );
          } catch (error) {
            failedChunks.add(index);
            if (error instanceof Error && error.name === 'AbortError') {
              throw error;
            }
            throw error;
          }
        });

        if (failedChunks.size > 0) {
          throw new Error(`${failedChunks.size} 个分片上传失败，请重试`);
        }

        message.success('上传成功');
        setFileList([]);
        onUploadSuccess?.();
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        message.error(err instanceof Error ? err.message : '上传失败');
        console.error('上传失败:', err);
      } finally {
        // 完整的清理逻辑
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        if (workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }
        uploadedChunksRef.current.clear();
        setUploading(false);
        setProgress(0);
      }
    },
    [onUploadSuccess],
  );

  const uploadProps = {
    beforeUpload: (file: File) => {
      handleUpload(file);
      return false;
    },
    fileList,
    onChange: ({ fileList: newFileList }: { fileList: UploadFile[] }) => {
      setFileList(newFileList);
    },
  };

  return (
    <div>
      <Upload {...uploadProps}>
        <Button icon={<UploadOutlined />} loading={uploading}>
          选择文件
        </Button>
      </Upload>
      {uploading && (
        <div style={{ marginTop: 16 }}>
          <Progress percent={progress} />
          <Button onClick={handleCancel} style={{ marginTop: 8 }}>
            取消上传
          </Button>
        </div>
      )}
    </div>
  );
}
