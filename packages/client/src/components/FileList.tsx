import { useCallback, useEffect, useState, useRef } from 'react';
import { Button, Image, message, Space, Table } from 'antd';
import { DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import axios from 'axios';
import { downloadFileWithChunks } from '../utils/download';

interface FileInfo {
  filename: string;
  size: number;
  type: string;
  path: string;
  createdAt: string;
}

export function FileList() {
  const [uploadedFiles, setUploadedFiles] = useState<FileInfo[]>([]);
  const [previewImage, setPreviewImage] = useState<string>();
  const [downloadProgress, setDownloadProgress] = useState<{
    [key: string]: number;
  }>({});
  const downloadControllerRef = useRef<{ [key: string]: AbortController }>({});

  const fetchUploadedFiles = useCallback(async () => {
    try {
      const response = await axios.get('/api/upload/files');
      setUploadedFiles(response.data);
    } catch (err) {
      message.error('获取文件列表失败');
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchUploadedFiles();
  }, [fetchUploadedFiles]);

  const handleDownload = useCallback(async (filename: string) => {
    try {
      // 创建下载控制器
      const controller = new AbortController();
      downloadControllerRef.current[filename] = controller;

      // 初始化进度
      setDownloadProgress(prev => ({ ...prev, [filename]: 0 }));

      // 使用分片下载，启用流式下载
      await downloadFileWithChunks({
        url: `/api/upload/download/${filename}`,
        filename,
        chunkSize: 1024 * 1024 * 2, // 2MB 分片
        concurrency: 3, // 并发下载3个分片
        onProgress: progress => {
          setDownloadProgress(prev => ({ ...prev, [filename]: progress }));
        },
        signal: controller.signal,
        retries: 3, // 失败重试3次
        streamDownload: true, // 启用流式下载
      });

      // 下载完成后清理
      setDownloadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[filename];
        return newProgress;
      });
      delete downloadControllerRef.current[filename];
    } catch (err) {
      // 如果不是取消下载导致的错误，显示错误消息
      if (err instanceof Error && err.message !== '下载已取消') {
        message.error('下载失败');
        console.error(err);
      }

      // 清理下载状态
      setDownloadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[filename];
        return newProgress;
      });
      delete downloadControllerRef.current[filename];
    }
  }, []);

  const columns = [
    {
      title: '文件名',
      dataIndex: 'filename',
      key: 'filename',
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      render: (size: number) => `${(size / 1024 / 1024).toFixed(2)} MB`,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: FileInfo) => (
        <Space>
          <Button
            type="link"
            icon={<DownloadOutlined />}
            onClick={() => handleDownload(record.filename)}
            loading={!!downloadProgress[record.filename]}
          >
            {downloadProgress[record.filename] !== undefined
              ? `下载中 ${downloadProgress[record.filename]}%`
              : '下载'}
          </Button>
          {record.type === 'image' && (
            <Button
              type="link"
              icon={<EyeOutlined />}
              onClick={() =>
                setPreviewImage(`/api/upload/download/${record.filename}`)
              }
            >
              预览
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Table dataSource={uploadedFiles} columns={columns} rowKey="filename" />

      <Image
        style={{ display: 'none' }}
        preview={{
          visible: !!previewImage,
          src: previewImage,
          onVisibleChange: visible => !visible && setPreviewImage(undefined),
        }}
      />
    </div>
  );
}
