---
apiVersion: aitp.dev/v1alpha1
kind: RuleFragment
id: git-no-implicit-push
displayName: Git push authorization
targets:
  - claude-code
  - codex
categories:
  - git
source:
  document: AGENTS.md
  lines: 3-3
fieldOrigins:
  categories: human
---

Only push after the user explicitly authorizes that push.
