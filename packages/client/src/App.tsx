import { FileUploader } from './components/FileUploader';
import { FileList } from './components/FileList';
import { useEffect, useState } from 'react';
import { Typography } from 'antd';

const { Title, Paragraph } = Typography;

function App() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const handleResize = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };

    handleResize(mediaQuery); // 初始检查
    mediaQuery.addListener(handleResize);

    return () => mediaQuery.removeListener(handleResize);
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <Typography style={{ marginBottom: 24 }}>
        <Title level={2}>大文件上传演示</Title>
        <Paragraph>
          本演示展示了一个完整的大文件上传解决方案，包含以下特性：
          <ul>
            <li>支持文件分片上传，每个分片2MB</li>
            <li>支持并发上传（同时上传3个分片）</li>
            <li>支持断点续传（上传失败自动重试）</li>
            <li>支持实时上传进度显示</li>
            <li>支持已上传文件预览（图片类型）和下载</li>
            <li>支持移动端自适应布局</li>
          </ul>
        </Paragraph>
      </Typography>
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: '24px'
        }}
      >
        <div>
          <FileUploader />
        </div>
        <div style={{ flex: 1 }}>
          <FileList />
        </div>
      </div>
    </div>
  );
}

export default App;
