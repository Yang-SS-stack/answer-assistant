# Third-party references and notices

## OCS (ocsjs/ocsjs)

- Project: https://github.com/ocsjs/ocsjs
- Reviewed branch: 5.0
- Reviewed commit: 06c2af62d2708f5042b913caf4a3cabb251e66a9
- Reviewed files: packages/core/src/core/worker/worker.ts; packages/core/src/core/worker/interface.ts; packages/scripts/src/utils/work.ts
- Additional review for identity diagnostics (4.11.3): packages/core/src/core/answer-wrapper/answer.wrapper.parser.ts; packages/core/src/core/answer-wrapper/interface.ts, at the same pinned commit. These describe answer-bank configuration validation and query/result/error data, not this extension's outer/nested model identity protocol or serialized MV3 review migration. No parser implementation was copied; bounded diagnostic fields and strict identity validation use this extension's existing code.
- License at that commit: MIT; Copyright (c) 2022 enncy.
- Additional review for 4.12.0: repository tree and worker/answer-wrapper code were checked for balance/quota and Native Messaging support. No applicable balance/quota implementation was found in that reviewed scope; the worker file contains no `connectNative`/`nativeMessaging` transport. Monitoring, the usage ledger and Windows bridge are independently implemented. This is a scoped review, not a claim that no other open-source implementation exists.

The request/resolve/error state separation was consulted as a design reference. This extension does not bundle OCS or copy its worker implementation. OCS's userscript worker and answer-bank architecture is different from this extension's MV3 background transport, independent dual-model decisions, and persisted manual review. Existing code was already being repaired when the OCS-reference instruction was added; relevant upstream code and its exact license were then reviewed. This is attribution for that review, not a claim that OCS implements this extension's dual-model recovery behavior.

For later reuse, record the exact upstream commit, files and modifications, retain original copyright headers and complete license text, and check licenses for the particular files and versions rather than assuming every OCS project uses the same license.

## Alibaba Cloud Model Studio official CLI (modelstudioai/cli)

- Project: https://github.com/modelstudioai/cli
- Pinned revision: cadc301d078f0fd1f2c56f7bf94f32c55bbb055d (CLI 2.8.4).
- Copyright 2026 Aliyun Model Studio (DashScope) AI Platform.
- License: Apache License, Version 2.0. Complete upstream text is distributed as `native/LICENSE-bailian.txt` in the source tree and as `LICENSE-bailian.txt` in the embedded component archive and installation.
- Adapted protocol/reference files: `packages/commands/src/commands/auth/login-console.ts`, `packages/commands/src/commands/usage/free.ts`, `packages/commands/src/commands/usage/shared.ts`, `packages/core/src/console/gateway.ts`, `packages/core/src/client/console-session.ts`. Auth login/status, store and config paths were also reviewed. The pinned tree has no upstream NOTICE file.
- Modified implementation: `native/qwen-console.mjs`. It adapts the official console-login callback and free-tier quota gateway to a restricted Native Messaging component: fixed China/Beijing read-only API, no `needapikey=true`, no API Key creation, no full CLI installation, no telemetry or skill setup, bounded validated responses, a single loopback callback with random state, cancellation and guarded Windows DPAPI storage. API Keys used by the extension are not passed to the component.
- The original copyright, Apache license pointer and a modification notice remain in the adapted source. This project's MIT license does not replace the upstream Apache terms for that adaptation. Both notices and full license texts accompany the component.

### OCS license text (reviewed commit)

MIT License

Copyright (c) 2022 enncy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
