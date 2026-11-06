# Third-party references and notices

## OCS (ocsjs/ocsjs)

- Project: https://github.com/ocsjs/ocsjs
- Reviewed branch: 5.0
- Reviewed commit: 06c2af62d2708f5042b913caf4a3cabb251e66a9
- Reviewed files: packages/core/src/core/worker/worker.ts; packages/core/src/core/worker/interface.ts; packages/scripts/src/utils/work.ts
- License at that commit: MIT; Copyright (c) 2022 enncy.

The request/resolve/error state separation was consulted as a design reference. This extension does not bundle OCS or copy its worker implementation. OCS's userscript worker and answer-bank architecture is different from this extension's MV3 background transport, independent dual-model decisions, and persisted manual review. Existing code was already being repaired when the OCS-reference instruction was added; relevant upstream code and its exact license were then reviewed. This is attribution for that review, not a claim that OCS implements this extension's dual-model recovery behavior.

For later reuse, record the exact upstream commit, files and modifications, retain original copyright headers and complete license text, and check licenses for the particular files and versions rather than assuming every OCS project uses the same license.

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
