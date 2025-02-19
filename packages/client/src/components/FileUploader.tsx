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

  const handleUpload = useCallback(async (file: File) => {
    try {
      setUploading(true);
      setProgress(0);
      uploadedChunksRef.current.clear(); // 清空已上传分片记录

      const { chunks, fileId, totalChunks } = await processFileChunks(
        file,
        CHUNK_SIZE,
      );

      let completed = 0;
      const failedChunks = new Set<number>(); // 记录上传失败的分片

      await asyncPool(3, chunks, async ({ chunk, index, id }) => {
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
              });

              // 记录上传成功的分片
              if (response.status === 'uploading' || response.status === 'complete') {
                uploadedChunksRef.current.add(id);
                completed++;
                setProgress(Math.floor((completed / totalChunks) * 100));
              }

              return response;
            },
            {
              maxAttempts: MAX_RETRIES,
              onError: (error) => {
                console.error(`分片 ${index} 上传失败:`, error);
                failedChunks.add(index);
              },
            },
          );
        } catch (error) {
          failedChunks.add(index);
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
      message.error(err instanceof Error ? err.message : '上传失败');
      console.error('上传失败:', err);
    } finally {
      setUploading(false);
    }
  }, [onUploadSuccess]);

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
      {uploading && <Progress percent={progress} style={{ marginTop: 16 }} />}
    </div>
  );
}