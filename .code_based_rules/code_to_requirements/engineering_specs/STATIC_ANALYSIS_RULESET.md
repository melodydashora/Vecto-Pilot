# Engineering Specification: Static Analysis Ruleset

## 1. Scope

This specification defines the functional, operational, security, reliability, and non-functional requirements for the uploaded static-analysis ruleset, including rule structure, severity policy, secret detection, infrastructure-as-code safeguards, HTML template protections, Nginx hardening, CI governance, and scan acceptance behavior.

## 2. System purpose

The static analysis ruleset shall:
- detect insecure code, configuration, and template patterns
- identify hardcoded credentials and secret-like values
- enforce secure infrastructure and proxy configuration practices
- flag suspicious CI and repository-governance changes
- scope rules to relevant file types and technologies
- provide actionable findings with severity and remediation context
- reduce false positives through path and pattern exclusions

---

## 3. Functional requirements

### 3.1 Rule definition and metadata

#### FR-RULE-001
Each rule shall have a unique identifier.

#### FR-RULE-002
Each rule shall declare its applicable language, pattern engine, or matching mode.

#### FR-RULE-003
Each rule shall define a human-readable finding message.

#### FR-RULE-004
Each rule shall define a severity level.

#### FR-RULE-005
Each rule should include metadata sufficient to support triage and remediation, including:
- category
- technology
- references
- confidence
- impact
- likelihood
- CWE and OWASP mappings where available

#### FR-RULE-006
Rules may define path-based include and exclude constraints.

#### FR-RULE-007
Rules may define autofix guidance only where the transformation is deterministic and safe.

---

### 3.2 Pattern matching and applicability

#### FR-MATCH-001
The ruleset shall support structural pattern matching.

#### FR-MATCH-002
The ruleset shall support regex-based detection for raw token and secret formats.

#### FR-MATCH-003
Rules shall support positive, negative, and scoped matching constructs, including:
- `pattern`
- `pattern-either`
- `pattern-inside`
- `pattern-not-inside`
- `pattern-regex`
- metavariable constraints

#### FR-MATCH-004
Rules shall be scoped to relevant files or technologies where possible.

#### FR-MATCH-005
Rules should exclude known safe constructs and known noisy files where practical.

---

### 3.3 Severity and enforcement behavior

#### FR-SEV-001
The ruleset shall classify findings according to severity.

#### FR-SEV-002
High-risk exploit indicators shall be treated as blocking findings.

#### FR-SEV-003
Security misconfigurations, unsafe templating cases, and audit-relevant issues shall typically be surfaced as warnings.

#### FR-SEV-004
Broad or lower-confidence secret signatures may be surfaced as informational findings where appropriate.

#### FR-SEV-005
Severity assignment shall align with likely exploitability, confidence, and impact.

---

### 3.4 Secret and credential detection

#### FR-SECDET-001
The ruleset shall detect hardcoded secrets in source code, configuration files, and build files.

#### FR-SECDET-002
The ruleset shall detect generic credential patterns such as:
- key
- token
- secret
- password
- client secret
- access key

#### FR-SECDET-003
The ruleset shall detect vendor-specific credential formats using signature-based matching.

#### FR-SECDET-004
The ruleset shall flag secret-like parameters and variables when naming strongly implies sensitive content.

#### FR-SECDET-005
The ruleset should exclude known generated files and high-noise artifacts from generic secret matching when false-positive risk is excessive.

---

### 3.5 Infrastructure as Code: Bicep

#### FR-BICEP-001
The ruleset shall identify secret-like Bicep parameters declared as plain strings.

#### FR-BICEP-002
Bicep parameters with names implying sensitive values, such as `password`, `secret`, or `token`, shall require the `@secure()` decorator.

#### FR-BICEP-003
The ruleset shall flag unsecured Bicep secret parameters as a security finding.

---

### 3.6 CI and repository governance

#### FR-CI-001
The ruleset shall detect additions to `.semgrepignore`.

#### FR-CI-002
Changes that expand ignored analysis scope shall be surfaced for audit or security review.

#### FR-CI-003
The ruleset shall detect suspicious shell payloads associated with reverse shells.

#### FR-CI-004
Reverse shell indicators shall be treated as high-severity findings.

---

### 3.7 Build configuration security

#### FR-BUILD-001
The ruleset shall inspect relevant build configuration files for hardcoded credentials.

#### FR-BUILD-002
Gradle-style build files shall be flagged when secrets are embedded as fallback string literals.

#### FR-BUILD-003
The ruleset shall encourage use of environment variables, vaults, or equivalent secret stores instead of literal credential values.

---

### 3.8 HTML template security

#### FR-TPL-001
The ruleset shall detect unquoted template expressions inside HTML attributes.

#### FR-TPL-002
The ruleset shall detect template-variable usage in `href` attributes where malicious URL injection may occur.

#### FR-TPL-003
The ruleset shall detect template-variable usage in `script src` attributes where malicious script loading may occur.

#### FR-TPL-004
The ruleset shall detect template-variable usage directly inside `<script>` blocks where JavaScript-context escaping may be insufficient.

#### FR-TPL-005
The ruleset shall allow known safer framework patterns or constrained relative-link patterns to reduce false positives.

---

### 3.9 Nginx configuration security

#### FR-NGX-001
The ruleset shall detect alias-path traversal risks in Nginx configuration.

#### FR-NGX-002
The ruleset shall detect dynamically determined proxy hosts and schemes where proxy destinations may be attacker-influenced.

#### FR-NGX-003
The ruleset shall detect response-header injection risks caused by unsanitized variable use.

#### FR-NGX-004
The ruleset shall detect header redefinition behavior where `add_header` in a nested scope may override higher-level headers.

#### FR-NGX-005
The ruleset shall detect insecure redirect patterns that fail to enforce HTTPS explicitly.

#### FR-NGX-006
The ruleset shall detect insecure TLS protocol configuration.

#### FR-NGX-007
The ruleset shall detect missing explicit TLS version declarations in SSL-enabled server blocks.

#### FR-NGX-008
The ruleset shall detect proxy locations that should be constrained with `internal` when used as internal-only routing helpers.

#### FR-NGX-009
The ruleset shall detect possible H2C smuggling preconditions related to upgrade forwarding and proxy HTTP version behavior.

#### FR-NGX-010
The ruleset shall detect use of request-host-derived values such as `$host` and `$http_host` where spoofing risk exists.

---

### 3.10 Reporting and remediation support

#### FR-REP-001
Findings shall provide messages that explain the issue in actionable terms.

#### FR-REP-002
Where available, findings should reference security standards, documentation, or remediation guidance.

#### FR-REP-003
Where safe and deterministic, autofix guidance may be provided.

---

## 4. Security requirements

### 4.1 Secret protection

#### SEC-001
Sensitive credentials shall not be committed to source code, templates, or configuration.

#### SEC-002
Credential material shall be retrieved from approved secret storage mechanisms rather than hardcoded literals.

### 4.2 Template and injection safety

#### SEC-003
Rendered HTML shall not allow unsafe attribute injection through unquoted or unconstrained template variables.

#### SEC-004
Rendered templates shall not allow unsafe URL injection into anchors or script-loading attributes.

#### SEC-005
Template values shall not be embedded directly into JavaScript contexts without context-appropriate encoding.

### 4.3 Reverse proxy and configuration safety

#### SEC-006
Proxy routing shall not depend on attacker-controlled host or scheme values.

#### SEC-007
Response headers shall not incorporate unsanitized user-controlled variables.

#### SEC-008
Nginx configuration shall not permit path traversal, SSRF exposure, host-header abuse, header injection, or request-smuggling-enabling patterns.

### 4.4 Transport security

#### SEC-009
TLS configuration shall explicitly restrict use to secure protocol versions.

#### SEC-010
Redirect behavior shall not preserve insecure transport where HTTPS is required.

### 4.5 Infrastructure definition safety

#### SEC-011
Infrastructure-as-code definitions shall prevent accidental disclosure of secret-like parameter values.

---

## 5. Operational requirements

### 5.1 Scan scope and targeting

#### OPS-001
Rules shall be scoped to relevant file types and path patterns when feasible.

#### OPS-002
Template security rules shall apply only to template-relevant files such as:
- `.html`
- `.mustache`
- `.hbs`

#### OPS-003
Nginx configuration rules shall apply only to config-like files and standard Nginx path conventions.

#### OPS-004
Build-security rules shall apply only to relevant build files.

### 5.2 Triage support

#### OPS-005
Rules should include sufficient metadata to support triage, prioritization, and remediation.

#### OPS-006
Rules affecting scan coverage, such as ignore-list changes, shall themselves be monitored.

### 5.3 False-positive reduction

#### OPS-007
The ruleset should exclude known noisy file types and generated artifacts from broad secret scans where justified.

#### OPS-008
Rules should use negative-pattern logic to exempt known safe framework patterns where applicable.

---

## 6. Reliability requirements

### 6.1 Detection consistency

#### REL-001
The ruleset shall produce consistent findings for the same matching input and configuration.

#### REL-002
Structural and regex detections shall remain bounded to intended file scopes.

#### REL-003
Rules shall avoid silently broadening applicability beyond intended technologies or file types.

### 6.2 Signal quality

#### REL-004
The ruleset should maximize true-positive security signal while limiting avoidable false positives.

#### REL-005
Broad generic detections should be constrained through exclusions, scoped paths, or safe-pattern exemptions where practical.

#### REL-006
Autofix behavior shall not be used unless the proposed transformation is predictable and low risk.

---

## 7. Non-functional requirements

### 7.1 Maintainability

#### NFR-MAINT-001
The ruleset shall remain maintainable through stable rule identifiers and clearly structured metadata.

#### NFR-MAINT-002
Rules should remain grouped by security domain, technology, or detection family to support ongoing maintenance.

#### NFR-MAINT-003
Vendor-specific secret signatures should be maintainable as an extensible catalog rather than as ad hoc one-off logic.

### 7.2 Auditability

#### NFR-AUD-001
Each finding should be traceable to a rule ID, message, and severity.

#### NFR-AUD-002
Where possible, findings should reference external standards or documentation to support audit review.

#### NFR-AUD-003
Changes that reduce scan visibility, such as ignore-list expansion, shall remain auditable.

### 7.3 Usability

#### NFR-USE-001
Finding messages shall be understandable by engineers performing remediation.

#### NFR-USE-002
Rules should prefer actionable messaging over purely descriptive alerts.

#### NFR-USE-003
Where possible, rules should indicate safer alternatives such as quoting, allowlisting, secure decorators, helper functions, or secret-management mechanisms.

### 7.4 Scalability of enforcement

#### NFR-SCALE-001
The ruleset shall support both targeted structural rules and large catalogs of vendor-specific credential signatures.

#### NFR-SCALE-002
The ruleset should remain operable across mixed repositories containing application code, infrastructure, templates, CI files, and proxy configuration.

---

## 8. Required scanning behavior

The implementation shall follow this evaluation model:

1. identify the candidate file and applicable language or path scope
2. determine which rule families apply to that file type
3. evaluate structural rules and scoped exclusions
4. evaluate regex-based secret and credential signatures where applicable
5. suppress findings excluded by safe patterns or file-scope exclusions
6. assign severity and metadata to confirmed matches
7. emit actionable findings with remediation-oriented messaging
8. surface scan-governance findings, including ignore-list changes, alongside security findings

---

## 9. Explicit prohibitions

The ruleset shall not:
- allow hardcoded secrets to pass unflagged in intended scan scopes
- treat reverse shell indicators as low-priority findings
- allow secret-like Bicep parameters to remain unsecured without warning
- permit unsafe unquoted template expressions in HTML attributes without detection
- permit unsafe variable use in script, href, or proxy-sensitive contexts without detection
- rely solely on generic secret detection when vendor-specific credential signatures are available
- ignore scan-scope changes such as additions to `.semgrepignore`
- apply broad generic rules to irrelevant file classes when scoped exclusions are defined

---

## 10. Acceptance criteria

The ruleset is compliant if all of the following are true:

- every rule has an ID, severity, message, and matching scope or language
- metadata is present for meaningful triage where defined by the ruleset
- secret-like literals are detected across code, config, and build files within intended scope
- Bicep parameters implying secret usage are flagged when not marked with `@secure()`
- `.semgrepignore` changes are surfaced for review
- reverse shell indicators are treated as blocking or high-severity findings
- HTML template findings detect unsafe attribute, href, script-src, and inline-script variable usage
- Nginx findings detect traversal, insecure redirect, weak or missing TLS settings, dynamic proxy risks, header injection risks, and host-header misuse
- false positives are reduced through explicit path scoping, exclusions, and safe-pattern exemptions
- findings remain actionable through clear messages and remediation-oriented guidance