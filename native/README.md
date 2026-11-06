# Qwen 北京免费 Token 额度本机组件 4.12.0

本组件供 Edge 扩展通过 Native Messaging 读取中国站北京模型免费 Token 余量。它不是人民币余额，也不代表阿里云账户的全部资金。仅查询额度，不调用模型，不创建或替换 API Key，不提交作业。

## 一次安装

先解压完整组件包，确保 Node.js **24.5.0 或更新版本**已安装且 `node.exe` 在当前用户命令路径中。组件依赖 Windows 自带 PowerShell 和 .NET Framework 4 编译器，不修改系统 Node、npm 或百炼 CLI，不需要管理员。

在 Edge 扩展详情页复制当前扩展 ID（32 个 a–p 小写字母），在此目录的 PowerShell 执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -ExtensionId '替换为扩展详情中的32字符ID' -DryRun
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -ExtensionId '替换为扩展详情中的32字符ID'
```

第一条只检查环境、已有注册的归属和显示安装计划，不写文件或注册表。第二条将明确列出的组件文件复制到 `%LOCALAPPDATA%\AnswerAssistant\quota-bridge\4.12.0`，在该目录编译启动器，生成仅允许此 ID 的 manifest，最后注册当前用户的 `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.answer_assistant.quota`。两种模式均核验已有注册路径位于本产品目录、产品标记及 manifest 的主机名、stdio 类型、启动器路径和单个合法扩展来源；不属于本组件或被改动的注册会拒绝覆盖。扩展 ID 变化后重新安装以更新授权来源。不覆盖没有产品标记的同名安装目录，不支持链接安装目录。

安装后重载扩展，再使用扩展的“连接 Qwen”流程。本人在官方页面完成授权，并确认账号关联；扩展关闭不会把令牌导出。授权仅支持中国站北京，其他地区/站点会拒绝。

## 凭证与本机范围

答题 API Key **不会传给本组件**。本组件只保留自身授权产生的会话，不读取百炼 CLI、浏览器资料或其他工具的已有凭证。令牌不会返回扩展或写入命令行、日志、诊断输出。

`credential-store.mjs` 的 `createCredentialStore({directory,protect?,unprotect?})` 提供 `load()`、`save(credential,guard)`、`clear()`。主机指定本组件自己的目录。默认用固定的 `Protect.ps1`，经标准输入/输出的 base64 管道调用 Windows DPAPI **CurrentUser**。`session.dat` 只保存密文；不能把此文件复制到别的用户或电脑来登录。加密后及提交前检查 guard；密文先写随机临时文件，再原子替换 session.dat，失败清理临时文件并保留旧会话。损坏或解密失败读取为未连接；存储错误只暴露固定错误。

启动器只接受安装配置中的精确扩展 origin，用配置中的绝对 Node 路径启动相邻固定 `host.mjs`，双向传递标准输入/输出帧，丢弃子进程诊断。输入结束后给当前子进程最多两秒处理已入队请求，然后仅结束自己启动的 Node。

代理仅允许无用户名/密码、明确有效端口的 HTTP 回环地址（127.0.0.1 或 localhost），不能带路径、查询或片段。继承的 `HTTPS_PROXY`、`HTTP_PROXY` 分别执行相同校验，合格值保留，不合格值在 Node 子进程环境中清除；明确提供但不合格的代理不会自动替换为系统代理。没有继承代理时，可读取系统启用的合格 HTTP 回环代理。代理内容不会输出。

## 断开与卸载

先在扩展中断开以清除此组件的本地授权，再执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Uninstall.ps1 -DryRun
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Uninstall.ps1
```

卸载核验注册路径在自有根目录、产品标记和 manifest 后，仅删除自己的当前用户 Edge 主机注册，不删除安装文件、其他主机或用户数据。不自动清理历史版本。升级保留其他版本目录。

## 来源与验证边界

OCS 已固定审查提交 `06c2af62d2708f5042b913caf4a3cabb251e66a9` 的 worker/interface、work 工具及 answer-wrapper 解析/接口；该审查范围提供请求/结果分离参考，不提供本组件 Windows Native Messaging 安装、启动器或 DPAPI 的直接替代。本组件这些部分独立实现，未复制 OCS 代码。这不表示其他开源项目不存在类似组件。

`qwen-console.mjs` 的官方控制台协议适配来源固定为 `modelstudioai/cli` 提交 `cadc301d078f0fd1f2c56f7bf94f32c55bbb055d`，保留源文件版权与修改说明，完整 Apache-2.0 许可见 `LICENSE-bailian.txt`。

完整组件包和安装目录同时包含本项目 MIT `LICENSE`、官方协议适配的 Apache-2.0 `LICENSE-bailian.txt` 与 `THIRD_PARTY_NOTICES.md`。源码开发目录安装时，项目 `LICENSE` 和 `THIRD_PARTY_NOTICES.md` 可从 v4 根目录按明确文件名读取；发布包将其放在组件根目录，安装器不会搜集其他文件。

`node --test v4/tests/native-install.test.mjs` 在临时目录使用合成凭证，验证加密、失败清理、安装 dry-run、编译及合成原生帧，并以替身注册表读取验证已有注册的归属拒绝、代理白名单和剥离。测试不写真实主机注册，不读取已有凭证，不连接官方授权或模型网络。**真实安装、本人授权及真实账户额度仍未验收**；局部测试通过不代表真实平台验收或答案准确率。
