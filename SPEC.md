# opencode-http-capture 规范

## 1. 目的

`opencode-http-capture` 是一个默认关闭的本地 OpenCode 插件，用于检查宿主组装出的模型请求。显式选择 block 模式在 provider I/O 之前捕获、脱敏并阻断模型请求；record/all 透传真实请求，同时记录请求和响应。

## 2. 范围

- 仅限 OpenCode 插件运行时。
- 仅拦截 `globalThis.fetch`；这不是进程沙箱。
- 模型请求的识别基于已知的模型端点，或包含 `messages`、`input`、`contents` 的 JSON 请求体。
- 非模型请求交给原始 `fetch` 转发，使插件/MCP 发现可以继续；all 同时录制这些请求。

## 3. 启用与隔离

- 单参数入口 `OPENCODE_CAPTURE`：未设置、空字符串、`false`、`0` 均关闭；`block` 捕获并阻断模型请求；`record` 透传录制 model 范围；`all` 透传录制 all 范围。
- 新值 `block` / `record` / `all` 完全由该参数决定，不读取 `OPENCODE_CAPTURE_MODE` / `OPENCODE_CAPTURE_SCOPE`，即使旧值冲突或非法也忽略；关闭时同样不读取旧参数或录制大小设置。
- 兼容旧入口 `1` / `true`：仅此时读取 MODE（默认 `block`，可选 `record`）与 SCOPE（仅 record 生效，默认 `model`，可选 `all`）。旧 `OPENCODE_CAPTURE=1 OPENCODE_CAPTURE_MODE=record` 必须仍然透传录制，不得变成阻断。非法 MODE 或录制时非法 SCOPE 抛出配置错误；block 忽略 SCOPE/MAX_BYTES。
- 所有入口值严格区分大小写，不去除空白。其他非空 CAPTURE 值在安装及去重判断前抛出明确 `Invalid OPENCODE_CAPTURE` 配置错误，不创建目录、不修改 fetch、不发起请求，不静默关闭或猜测模式。错误拒绝插件初始化，不承诺宿主忽略错误后仍阻断网络；插件不是进程级防火墙。
- `OPENCODE_CAPTURE_DIR` 可选，用于指定一个已存在且可写的父目录；否则创建私有的系统临时目录。
- 每次成功安装都创建全新的捕获目录，文件权限为 `0600`；同一进程成功安装后重复 entry 调用不重复安装，不切换模式。更改模式或关闭已安装的包装器须重启 OpenCode。
- 本插件不得修改原始 Session。使用者应使用 OpenCode `--fork` 运行目标 Session。

## 4. block 模式捕获契约

每个捕获产物是 JSON，包含 `capturedAt`、`blocked`，以及含有 method、URL、headers 和 body 的 `request`。产物路径为绝对路径。OpenAI 兼容的 Chat Completions 会收到合成响应，其中 assistant 内容即为该路径。其他已识别的模型协议会被捕获，并返回包含该路径的错误。

## 5. 脱敏

插件必须对请求（包括 URL、headers/body）及响应元数据（包括 headers）脱敏：覆盖常见的凭据类 header 和对象键（包括 private_key、privateKey、secret_access_key、secretAccessKey）、PEM 私钥块、Bearer 凭据、常见 token 前缀，以及字符串值中出现的 URL。现有请求脱敏规则不变。**record 模式 response.body 不经过脱敏，JSON/SSE/文本中的 API key、token、URL 和其他内容全部保留。** 脱敏不保证覆盖请求中嵌入的任意机密；响应原文更可能含真实敏感信息，使用者承担此风险并负责安全存储、访问控制、清理，不得公开真实捕获文件。

## 6. block 模式失败与副作用

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

项目必须通过 `npm test` 和 `git diff --check`。入口测试使用模拟 fetch 覆盖三个命名模式、legacy 组合及默认值、冲突优先级、关闭、非法值、并发去重及失败重试，不调用真实 provider。人工验证 block 模式应确认：以 fork 方式运行的 OpenCode 会创建产物，且 provider 不会收到被捕获的模型请求。

## 9. record 模式

- `OPENCODE_CAPTURE=record` 启用 model 范围透传录制；`OPENCODE_CAPTURE=all` 启用 all 范围透传录制。旧参数兼容规则见第 3 节。
- all 仅指经过当前 fetch 包装器的流量，不覆盖 WebSocket、子进程或绕过 fetch 的网络实现。
- record 会真实调用 provider、产生费用并可能继续执行工具；fork 不隔离工具副作用。
- 请求参数原样交给原 fetch，不读取或克隆流式请求体。只有 init.body 中的 JSON 字符串会记录正文；Request 内置 body、二进制、非 JSON 和超限正文只记录省略原因。未知端点且正文无法检查时，model 范围可能不捕获，应使用 all。
- 请求快照仅支持标准 Request/URL/字符串、普通数据属性 init，以及可安全重读的 Headers、字符串键值对象或字符串二元组数组；一次性迭代器、getter、Proxy 和其他无法安全检查的参数直接跳过整个录制（all 也如此），不提前调用 getter、转换对象或消费迭代器。
- 每个请求写入独立 JSON，包含 ID、请求元数据、响应状态及 headers、时间、完整性状态。文件权限 0600，目录由 mkdtemp 创建。创建目录失败时不安装包装器；其他写盘失败仅发出不含原始错误内容的诊断，真实流量继续。
- 响应流按宿主消费进度转交，不等待完整响应才返回；保留响应 status、statusText、headers、url、redirected、type 和取消/错误行为，不保证 Response 对象身份不变。通过实例 clone() 创建的后续克隆也保留元数据，流分支和取消使用原生 clone/tee；绕过实例方法直接调用 Response.prototype.clone 不保证附加元数据。bodyUsed、locked 或包装失败时返回原响应，标记 recording-unavailable/omitted-unavailable。
- `OPENCODE_CAPTURE_MAX_BYTES` 为正安全整数，默认 1048576；分别限制每个请求/响应可记录的正文大小。响应录制使用单个几何增长的字节缓冲，忽略零长度 chunk，不保留逐 chunk 对象；扩容时新旧缓冲短暂并存，解码/解析/元数据脱敏/序列化还会产生额外内存。超过上限丢弃全部正文，不写部分前缀；并发请求各有独立缓冲，不是全局内存上限。宿主主动 clone/tee 的分支排队内存不属于录制缓冲上限。
- 完整 JSON 在流结束后解析并保存，绝不脱敏正文；SSE（text/event-stream）和其他 text/* 响应在流结束后统一 UTF-8 解码，保存原始文本，不重组事件或拼接 delta。保留空白、换行和 BOM，跨 chunk 的多字节字符不被拆坏；无效 UTF-8 使用替换字符。JSON 解析/序列化可能改变空白、数字表示等，不是字节级归档；真实响应字节始终原样交付。
- 响应 bodyState：支持且完整保存的正文为 complete（包括空文本）；无 body 流为 empty；二进制、未知或缺失 content-type 为 omitted-unsupported；JSON 解析失败为 omitted-unparseable；超限为 omitted-limit；取消或流错误为 omitted-incomplete；缓冲/包装不可用为 omitted-unavailable。超限和中断均省略全部正文，不保留前缀。正文类型依据 content-type 判断，不对任意字节自动嗅探。
- pending/streaming 表示尚未完成；未消费完或进程退出可能保留该状态。complete 表示传输消费结束，不代表正文一定保留，需同时检查 bodyState。取消、网络错误和流错误分别记录状态，不保存原始错误消息。
- 脱敏只作用于落盘请求及响应元数据副本，绝不遍历或改写 response.body，不更改真实请求或响应；不保证识别任意 prompt 机密，响应敏感性由使用者承担。录制仍有内存、CPU 和磁盘开销，元数据写入和完成写入可能增加延迟，不保证零延迟。
- record 模式的测试必须使用模拟 provider，覆盖透传、分块 SSE、大小限制、脱敏、取消、错误和写盘失败；真实 provider 验证需另行授权。
- entry 并发调用共享安装中的 Promise，成功后不重复包装 fetch；安装失败清除标记，后续调用可以重试。
