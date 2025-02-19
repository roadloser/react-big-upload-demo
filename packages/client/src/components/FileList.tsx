import { useCallback, useEffect, useState } from 'react';
import { Button, Image, message, Space, Table } from 'antd';
import { DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import axios from 'axios';

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
      const response = await axios.get(`/api/upload/download/${filename}`, {
        responseType: 'blob'
      });
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      message.error('下载失败');
      console.error(err);
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
          >
            下载
          </Button>
          {record.type === 'image' && (
            <Button
              type="link"
              icon={<EyeOutlined />}
              onClick={() => setPreviewImage(`/api/upload/download/${record.filename}`)}
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
      <Table
        dataSource={uploadedFiles}
        columns={columns}
        rowKey="filename"
      />
      
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