# opencode-http-capture 规范

## 1. 目的

`opencode-http-capture` 是一个本地 OpenCode 插件，用于检查宿主组装出的模型请求。它在 provider I/O 之前捕获该请求，写入脱敏后的 JSON 产物，并阻止该模型请求到达 provider。

## 2. 范围

- 仅限 OpenCode 插件运行时。
- 仅拦截 `globalThis.fetch`；这不是进程沙箱。
- 模型请求的识别基于已知的模型端点，或包含 `messages`、`input`、`contents` 的 JSON 请求体。
- 非模型请求交给原始 `fetch` 转发，使插件/MCP 发现可以继续。

## 3. 启用与隔离

- 只有当 `OPENCODE_CAPTURE` 为 `1` 或 `true` 时插件才启用。
- `OPENCODE_CAPTURE_DIR` 可选，用于指定一个已存在且可写的父目录；否则创建私有的系统临时目录。
- 每次调用都创建全新的捕获目录，文件权限为 `0600`。
- 本插件不得修改原始 Session。使用者应使用 OpenCode `--fork` 运行目标 Session。

## 4. 捕获契约

每个捕获产物是 JSON，包含 `capturedAt`、`blocked`，以及含有 method、URL、headers 和 body 的 `request`。产物路径为绝对路径。OpenAI 兼容的 Chat Completions 会收到合成响应，其中 assistant 内容即为该路径。其他已识别的模型协议会被捕获，并返回包含该路径的错误。

## 5. 脱敏

插件必须脱敏常见的凭据类 header 和对象键、Bearer 凭据、常见 token 前缀，以及字符串值中出现的 URL。脱敏是保守的，但不保证能覆盖 prompt 文本中嵌入的任意机密。由于 prompt、工具和工具结果可能仍被保留，捕获文件属于敏感数据。

## 6. 失败与副作用

- 成功捕获后，模型请求绝不会再传给原始 `fetch`。
- 无法读取的模型请求体会被阻断，不予转发。
- 捕获写入失败必须阻止转发该模型请求。
- 非模型请求的行为仍委托给原始 `fetch`。
- 插件不删除 Session 数据或捕获产物。

## 7. 安装与卸载

- `install.sh` 只在配置的 OpenCode 插件目录下创建符号链接。
- 安装必须拒绝覆盖无关的既有路径。
- `uninstall.sh` 必须只删除指向本 checkout 的符号链接。
- 两个脚本都不修改 provider 凭据或 OpenCode Session 存储。

## 8. 验证

项目必须通过 `npm test` 和 `git diff --check`。人工验证应确认：以 fork 方式运行的 OpenCode 会创建产物，且 provider 不会收到被捕获的模型请求。
