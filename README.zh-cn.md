# opencode-http-capture

> 在本地查看 OpenCode 模型请求，无需代理。

这是一个默认关闭的 OpenCode 插件：选择 `block` 截获并阻断模型请求，将脱敏 JSON 保存到临时文件；选择 `record` / `all` 透传记录真实请求和响应。用于研究 opencode 对话 prompt、消息结构、工具定义和生成参数等。

[English](README.md) · [规范](SPEC.md) · [Agent 协作规则](AGENTS.md)

## 安装

环境要求：支持外部插件的 OpenCode v1 版本。

```bash
git clone git@github.com:hymsk/opencode-http-capture.git
cd opencode-http-capture
bash install.sh
```

安装器在 `~/.config/opencode/plugins/` 创建符号链接。请保留源码目录，安装后重启 OpenCode。可在运行安装器时通过 `OPENCODE_CONFIG_DIR` 指定其他配置目录。

## 使用方式

只用一个环境变量选择模式：

| `OPENCODE_CAPTURE` | 行为 |
| --- | --- |
| 未设置、空字符串、`false`、`0` | 关闭，不修改 fetch |
| `block` | 捕获并阻断模型请求，其他请求透传 |
| `record` | 透传真实流量，仅录制模型请求和响应 |
| `all` | 透传真实流量，录制当前 fetch 包装器覆盖的全部请求和响应 |

取值严格区分大小写，不去除首尾空白。除下述 legacy `1` / `true` 外，其他非空值在安装前抛出明确配置错误，不静默关闭或切换模式。这只会拒绝插件初始化，并非进程级网络防火墙；请勿忽略插件加载错误。

开启模型请求阻断并启动 OpenCode：

```bash
OPENCODE_CAPTURE=block opencode
```

查看已有 Session 的继续请求时，使用 fork 避免向原会话追加内容：

```bash
OPENCODE_CAPTURE=block opencode run --session ses_xxx --fork "继续"
```

## 透传记录请求和响应

```bash
OPENCODE_CAPTURE=record opencode

# 捕获当前 fetch 包装器覆盖的全部请求，而不只是模型请求
OPENCODE_CAPTURE=all opencode
```

**`record` 和 `all` 都会真实调用 provider、产生费用并可能执行工具。** `--fork` 仅保护原会话，不隔离工具副作用。不显式启用时插件默认关闭。

启动时 stderr 输出录制目录；每个请求对应 `<目录>/<ID>.json`。响应保持流式交付，响应正文在读取结束后**不脱敏落盘**。请求 headers/body 和响应元数据（包括 headers）继续凭据脱敏。查看 `state` 和请求/响应 `bodyState` 确认完整性，pending/streaming 不代表完整录制。录制失败不会阻断真实请求。

默认每个请求和响应正文上限为 1 MiB，可用 `OPENCODE_CAPTURE_MAX_BYTES` 设置正整数字节数。完整 JSON 响应解析后保存，不脱敏；SSE（`text/event-stream`）及其他 `text/*` 响应保存为 UTF-8 文本，保留事件格式、空白和内容，不做协议重组。缓冲完成后统一解码，因此 chunk 边界不影响录制文本；无效 UTF-8 使用替换字符。交给调用方的响应字节不变。二进制及未知/缺失 content-type 省略（`omitted-unsupported`），无效 JSON 省略（`omitted-unparseable`）；超限或中断时全部省略（`omitted-limit` / `omitted-incomplete`），不保存部分前缀。`bodyState=complete` 表示支持的正文已保存（包括空文本），`empty` 表示没有响应 body 流。请求仅记录通过 `init.body` 传入的 JSON 字符串，Request 内置 body 和上传流不读取。未知端点的这类请求请用 all 范围捕获元数据。

请求快照支持普通数据属性参数和可安全重读的 Headers、字符串键值对象、字符串二元组数组。一次性迭代器、getter、Proxy 等无法安全检查的参数会直接跳过整个录制，all 范围也不例外。locked、bodyUsed 或包装失败的响应原样返回，录制标记为不可用。实例 `clone()` 保留响应元数据并沿用原生流分支/取消行为。录制采用有界字节缓冲，不逐 chunk 保留对象；扩容、文本/JSON 处理和调用方主动创建的克隆队列仍有额外内存开销。常见私钥字段和 PEM 私钥仅在请求及响应元数据中脱敏，仍不保证识别其中任意机密。

all 不覆盖 WebSocket、子进程或绕过 fetch 的通信；这不是全进程抓包或逐字节存档。**响应正文有意保留全部内容，包括 provider 返回的 API key、token、URL、个人信息或其他机密；使用者承担敏感信息风险，并负责安全存储、访问控制和删除。** 请求即使凭据脱敏也可能包含敏感 prompt、代码和工具结果，请勿公开捕获文件。没有自动轮转或清理，长时间录制需关注磁盘占用。

## 获取结果（block 模式）

对于 Chat Completions，assistant 回复为捕获文件的绝对路径：

```text
/tmp/opencode-http-capture-AbCdEf/1.json
```

使用 `jq` 查看或保存请求体：

```bash
jq '.request.body' /tmp/opencode-http-capture-AbCdEf/1.json
jq '.request.body' /tmp/opencode-http-capture-AbCdEf/1.json > request.json
```

指定捕获文件的父目录时，先创建该目录：

```bash
mkdir -p /tmp/my-captures
OPENCODE_CAPTURE=block OPENCODE_CAPTURE_DIR=/tmp/my-captures opencode
```

所有启用模式均可选配 `OPENCODE_CAPTURE_DIR`，默认父目录为系统临时目录。录制模式（`record` / `all`）可选配 `OPENCODE_CAPTURE_MAX_BYTES`；`block` 不使用该限制。

## Legacy 兼容

仅 `OPENCODE_CAPTURE=1` 或 `true` 读取 `OPENCODE_CAPTURE_MODE`（默认 `block`，可选 `record`）和 `OPENCODE_CAPTURE_SCOPE`（默认 `model`，可选 `all`，仅录制时生效）。因此旧命令 `OPENCODE_CAPTURE=1 OPENCODE_CAPTURE_MODE=record` 仍然录制，不会变成阻断；追加 `OPENCODE_CAPTURE_SCOPE=all` 仍录制全部 fetch 流量。非法 legacy MODE，或录制时的非法 SCOPE，会抛出配置错误。

新值 `block` / `record` / `all` 完全忽略 MODE 和 SCOPE，即使旧值冲突或非法也如此；关闭值也忽略它们。目录和录制大小设置仍可选。安装按进程去重；切换模式或关闭已安装的包装器需重启 OpenCode。

## 关闭捕获

退出 OpenCode，随后不带 `OPENCODE_CAPTURE` 重新启动，或将它设为空字符串、`false`、`0`，日常不影响正常使用。

## 卸载

```bash
bash uninstall.sh
```

卸载后重启 OpenCode。捕获文件保留，查看后自行清理。

## 许可证

[AGPL-3.0-or-later](LICENSE)。
