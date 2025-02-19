# React Big Upload Demo

这是一个使用React和NestJS实现的大文件上传示例项目。项目采用monorepo结构，使用pnpm Workspaces管理。

## 功能特点

- 前端使用Vite + React + TypeScript
- 服务端使用NestJS + NeDB
- 支持大文件分片上传
- 使用Web Worker处理文件分片
- SSR渲染支持

## 项目结构

```
├── packages/
│   ├── client/     # 前端项目
│   └── server/     # 后端项目
├── package.json
├── tsconfig.json
├── .eslintrc.js
└── .prettierrc
```

## 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 启动生产服务
pnpm start

# 代码格式化
pnpm format

# 代码检查
pnpm lint
```

## 技术栈

- React 18
- TypeScript
- Vite
- NestJS
- NeDB
- ESLint
- Prettier