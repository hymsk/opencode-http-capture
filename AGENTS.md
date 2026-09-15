# AGENTS.md

本仓库维护一个独立、可安装的 OpenCode HTTP capture plugin。开始任务先阅读本文件和 [SPEC.md](./SPEC.md)。默认使用中文沟通；代码、命令、路径和 API 名称保留英文。

## 安全边界

- 插件默认关闭，只有 `OPENCODE_CAPTURE=1` 或 `true` 才启用。
- 启用后只捕获模型请求，捕获文件脱敏后写入临时目录，并阻断模型请求。
- 不使用代理，不调用真实 provider；非模型请求仍按原 fetch 转发。
- 以 `SPEC.md` 为当前行为契约；实现、测试和文档必须与其一致。
- 不记录、提交或输出 API key、token、cookie、私钥等敏感凭据。
- 不修改原始 Session；使用者应通过 `--fork` 运行目标 Session。

## 开发要求

- 保持项目小而独立，不引入不必要依赖。
- 修改后运行 `npm test` 和 `git diff --check`。
- 未明确要求时不执行 `git add`、`git commit` 或 `git push`。
- 不使用破坏性 Git 操作。
