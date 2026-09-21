# npm 发布指南

## 首发目标

- 包名：`opencode-http-capture`
- 版本：`0.1.1`（从本地分发的 `0.1.0` 递增补丁版本，作为首个 npm 版本）
- 入口：`dist/entry.js`，ESM，仅默认导出插件函数
- 工具链：Node.js 24+、npm，无第三方构建或运行时依赖
- 状态：`0.1.1` 已发布，核验时 `latest` 指向 `0.1.1`；`0.x` 为早期版本

## 本地门禁

```bash
npm test
git diff --check
npm pack --dry-run
```

`npm test` 自动构建，验证功能及打包文件，离线安装真实 tarball 并在独立进程中测试包名导入、默认关闭、三个命名模式、非法值和去重。全部使用模拟 fetch；不会调用真实 provider。`prepack` 自动重建，`prepublishOnly` 自动运行测试；不要通过 `--ignore-scripts` 绕过实际发布门禁。

构建使用 Node 内置的 `stripTypeScriptTypes`（该 API 可能输出 ExperimentalWarning），只去除可擦除类型并改写本地扩展名，不进行类型检查。`dist/` 与 `*.tgz` 是生成文件，不提交。npm 包不含测试、维护脚本、本地安装脚本或捕获数据。

另行运行 `npm run test:host` 验证实际 OpenCode/Bun 宿主：从真实 tarball 安装后加载 JavaScript 入口，使用临时 HOME、独立配置及会话存储、虚构凭据和回环 HTTP provider，覆盖 block 不转发、record/all 流式回复与落盘。宿主可下载 SDK 依赖，不代表全程离线；不得为测试访问真实模型服务。它验证宿主加载已安装文件，不替代发布后从 registry 按包名自动安装的检查。发布包前，检查中英文 README 的安装配置与实际版本一致。宿主验收未通过时不要发布。

## registry 与权限检查

本次 `0.1.1` 准备阶段已在 Node.js 24.13.0 / npm 11.6.2 下通过 36 项自动化检查和正常 `npm pack --dry-run`。OpenCode 1.18.31 隔离宿主验收也已通过：block 捕获 2 个模型请求且回环 provider 调用为 0；record/all 各捕获 2 个模型请求、调用 provider 2 次，并验证流式答案及完整落盘。测试脚本显式关闭 stdin，预装一次匹配宿主版本的 SDK 并复制到各隔离配置目录，避免隐式安装等待和重复联网；SDK 优先从 npm 缓存离线安装。全部使用虚构输入与回环 provider，不代表所有宿主版本或真实 provider 均已验证。线上发布状态须以 registry 查询为准。

发布后已使用空缓存从公共 registry 隔离安装 `opencode-http-capture@0.1.1`，验证包名导入及默认关闭、不修改 fetch 的行为。registry 的 SHA-1 为 `8c66ff724ab738393ef58f3236b0c620275d6772`，与发布前验收的包一致，安装锁文件中的 SHA-512 integrity 也一致。发布源码提交为 `f1041e4`；当前源码中的发布成功说明是发布后文档更新，不改变 npm 已发布 tarball，其内仍保留发布准备时的说明。尚未验证 OpenCode 从空缓存按 npm 包名自动安装的完整流程；宿主验收使用的是已安装 tarball 的文件入口。

在有网络访问的维护者环境确认：

```bash
npm view opencode-http-capture versions --json --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

首次发布查询可能返回 E404，这不保证名称一定允许注册；如果包已存在，核对维护权限并确认 `0.1.1` 未占用。超时不是“包名可用”的证据。通过 npm 官方交互流程完成登录及所需 2FA/OTP，不把凭据写入仓库、命令示例或日志。

## 正式发布（须明确授权）

1. 复核完整 diff、版本、许可证、发布白名单及测试结论。
2. 完成实际宿主验收，核对 registry 包名/版本和发布权限。
3. 将发布分支的完整改动（尤其是中英文安装、录制说明）交由维护者审查。获得审查通过及对应提交授权后，才提交发布准备改动；提交正文说明首发能力、安全边界、Node.js 要求变化及实际验证。按获准策略快进合入并推送 `main`，遇到分叉、冲突或推送失败立即停止，不自动变基或强推。
4. 在明确获准公开发布后，从已审阅的干净发布提交运行：

   ```bash
   npm publish --access public --registry=https://registry.npmjs.org/
   ```

5. 查询 `npm view opencode-http-capture@0.1.1 version dist.integrity --registry=https://registry.npmjs.org/`，并验证从 registry 安装的包。发布失败时保留现场，不盲目重试或覆盖版本。
6. 确认成功后，将 README 的发布前提示和 CHANGELOG 的 `unreleased` 状态改为真实发布状态。记录实际验证环境，不用本地模拟测试代替宿主验证结论。

npm 发布、Git 提交、推送、tag 和 GitHub Release 是不同授权范围。不要自动执行未经明确授权的外部操作；不移动既有 tag 或改写公开历史。
