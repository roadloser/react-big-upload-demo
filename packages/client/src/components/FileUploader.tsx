import { useState, useCallback } from 'react';
import { Upload, Button, Progress, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { processFileChunks, uploadChunk } from '../utils/upload';
import { retryOperation, asyncPool } from '../utils/async';

const CHUNK_SIZE = 1024 * 1024 * 2; // 2MB per chunk

interface FileUploaderProps {
  onUploadSuccess?: () => void;
}

export function FileUploader({ onUploadSuccess }: FileUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileList, setFileList] = useState<UploadFile[]>([]);


  const handleUpload = useCallback(async (file: File) => {
    try {
      setUploading(true);
      setProgress(0);

      const { chunks, fileId, totalChunks } = await processFileChunks(
        file,
        CHUNK_SIZE,
      );
      let completed = 0;

      await asyncPool(3, chunks, async ({ chunk, index }) => {
        const blob = new Blob([chunk]);
        await retryOperation(async () => {
          await uploadChunk({
            chunk: blob,
            filename: file.name,
            fileId,
            index,
            size: blob.size,
            file
          });
          completed++;
          setProgress(Math.floor((completed / totalChunks) * 100));
        });
      });

      message.success('上传成功');
      setFileList([]);
      onUploadSuccess?.();
    } catch (err) {
      message.error('上传失败');
      console.error(err);
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