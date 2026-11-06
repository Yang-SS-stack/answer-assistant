# Project instructions

- Read README.md and THIRD_PARTY_NOTICES.md before changing platform behavior. This extension never submits homework or exams. Do not add automatic submission as a recovery path.
- Before implementing a feature or bug fix, examine the relevant OCS upstream modules first. Record the exact commit, applicable design/code, compatibility constraints, and the reason for independent implementation where direct reuse is unsuitable. A limited search cannot establish that no open-source solution exists.
- Check the license for the specific files and revision before reuse. Preserve copyright headers and complete license notices; document source files and modifications in THIRD_PARTY_NOTICES.md. A design reference must not be described as copied implementation or vice versa.
- Keep request/parse failures, explicit model uncertainty, conflicting answers, page verification failures, and record persistence failures separate. Operational failures must not become reusable manual-review decisions.
- Use synthetic tests for normal development. Never call real model APIs, modify a real assignment, or submit an answer as a test unless explicitly authorized; the no-submission boundary remains in force.
- Run npm test for changes. Browser and independent-package checks require separately available internal fixtures; report their scope honestly and do not claim real-platform acceptance from synthetic tests.
- Keep credentials, diagnostic exports, browser profiles, private course captures and historical local repository data out of Git. Do not print API keys or tokens while debugging.
