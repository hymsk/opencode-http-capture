# AGENTS.md

本仓库维护一个独立、可安装的 OpenCode HTTP capture plugin。开始任务先阅读本文件和 [SPEC.md](./SPEC.md)。默认使用中文沟通；代码、命令、路径和 API 名称保留英文。

## 安全边界

- 插件默认关闭；`OPENCODE_CAPTURE` 未设置、空字符串、`false`、`0` 均关闭；`block` 只捕获并阻断模型请求；`record` 透传录制 model；`all` 透传录制 all。
- 仅 legacy `1` / `true` 读取 MODE/SCOPE，保留旧组合及默认 block/model；新命名模式完全忽略旧 MODE/SCOPE。其他非空 CAPTURE 值须抛明确配置错误，不得静默关闭；目录与录制大小仍可选。
- 不使用代理；block 模式不得转发捕获的模型请求，record 模式会调用真实 provider，录制失败不得阻断真实流量。
- 以 `SPEC.md` 为当前行为契约；实现、测试和文档必须与其一致。
- 请求和响应元数据（包括 headers）中的凭据继续脱敏；record 模式响应正文不脱敏，按 SPEC 保留真实内容，使用者承担其中敏感信息的风险。开发测试只用虚构凭据，不提交或公开真实捕获数据。
- 不修改原始 Session；使用者应通过 `--fork` 运行目标 Session。

## 开发要求

- 保持项目小而独立，不引入不必要依赖。
- 修改后运行 `npm test` 和 `git diff --check`。
- 未明确要求时不执行 `git add`、`git commit` 或 `git push`。
- 不使用破坏性 Git 操作。
