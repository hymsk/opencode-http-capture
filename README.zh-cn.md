# opencode-http-capture

> 在本地查看 OpenCode 模型请求，无需代理。

这是一个 OpenCode 插件：截获经过其 fetch 包装器的模型请求，将脱敏 JSON 保存到临时文件，并阻断这些请求。用于研究 opencode 对话 prompt、消息结构、工具定义和生成参数等。

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

开启捕获并启动 OpenCode：

```bash
OPENCODE_CAPTURE=1 opencode
```

查看已有 Session 的继续请求时，使用 fork 避免向原会话追加内容：

```bash
OPENCODE_CAPTURE=1 opencode run --session ses_xxx --fork "继续"
```

## 获取结果

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
OPENCODE_CAPTURE=1 OPENCODE_CAPTURE_DIR=/tmp/my-captures opencode
```

## 关闭捕获

退出 OpenCode，随后不带 `OPENCODE_CAPTURE` 重新启动即可，日常不影响正常使用。

## 卸载

```bash
bash uninstall.sh
```

卸载后重启 OpenCode。捕获文件保留，查看后自行清理。

## 许可证

[AGPL-3.0-or-later](LICENSE)。
