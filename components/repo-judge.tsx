"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import { Github, FileJson, FileText, Code, TrendingUp, Shield, Book, Zap, Eye, EyeOff } from "lucide-react"

const GITHUB_API = "https://api.github.com"

type RubricItem = { score_0_5: number; weight: number; points: number }
type Report = {
  project: { repo_url: string; branch: string; name: string; license: string; stack: { frontend: string; backend: string; contracts_tooling: string }; commit_sample: string[] }
  deploy: { url?: string; network?: string; usdt_address?: string; wdk_used?: boolean }
  contracts: { list: Array<{ name?: string; address?: string; network?: string; verified_on_snowtrace?: boolean; snowtrace_url?: string; events_emitted?: string[] }> }
  payments_flow: { happy_path: { tx_hash?: string; screenshot_or_log?: string }; idempotency_check: "pass" | "fail" | "unknown"; double_send_prevented: "yes" | "no" | "unknown"; error_handling: "documented" | "weak" | "missing" }
  refunds_splits: { refund: { present: boolean; tx_hash?: string }; splits: { present: boolean; tx_hash?: string } }
  security: { allowances: { pattern: "minimal" | "infinite" | "permit" | "unknown"; revocation_documented: boolean }; patterns: { cei: boolean; reentrancy_guard: boolean; access_control: string[] }; secrets_in_repo: boolean; threat_model_present: boolean }
  observability: { logs: "structured" | "basic" | "none"; metrics: "present" | "none"; retries_timeouts: "present" | "none" }
  performance_costs: { latency_ms: { p50: number; p95: number }; gas: { payment: number; refund: number; split: number }; monthly_cost_estimate_usd: number }
  code_quality_tests: { lint_ok: boolean; tests_present: boolean; coverage_pct: number }
  documentation_devex: { readme_complete: boolean; env_example_present: boolean; arch_diagram_present: boolean }
  technical_ux: { tx_status_feedback: boolean; double_submit_guard: boolean; shows_tx_hash: boolean }
  bonus: { eip4337: boolean; subnets: boolean; stress_test: boolean; on_off_ramp: boolean }
  penalties: { no_onchain_tx: boolean; secrets_exposed: boolean; copy_without_attrib: boolean }
  scoring: {
    rubric: Record<
      | "payments_functionality"
      | "blockchain_integration"
      | "security_safety"
      | "reliability_observ"
      | "performance_cost"
      | "code_quality_tests"
      | "docs_devex"
      | "technical_ux",
      RubricItem
    >
    bonus_points: number
    penalties_points: number
    total: number
  }
  evidence: { repo_metadata_file: string; env_audit_file: string; gas_report_file: string; perf_file: string; attachments: { path: string }[] }
  summary: { highlights: string[]; risks: string[]; recommendations: string[] }
}
type ScoreData = {
  owner: string; repo: string; technical_score: number; security_risk: number; on_chain_proof: number;
  docs_completeness: number; payment_robustness: number; overall_score: number; timestamp: string; report: Report
}

const toFixed1 = (n: number) => Math.round(n * 10) / 10
const parseRepoUrl = (url: string): { owner: string; repo: string; branch?: string } => {
  const u = new URL(url); const parts = u.pathname.split("/").filter(Boolean)
  const owner = parts[0]; const repo = parts[1]; let branch: string | undefined
  if (parts[2] === "tree" && parts[3]) branch = parts[3]; return { owner, repo, branch }
}
async function gh<T = any>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${GITHUB_API}${path}`, { headers })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
  return res.json()
}
async function getRaw(owner: string, repo: string, path: string, ref: string, token?: string) {
  const meta: any = await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`, token)
  if (Array.isArray(meta) || !meta.download_url) return ""
  const headers: Record<string, string> = {}; if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(meta.download_url, { headers }); return res.ok ? res.text() : ""
}
const TX_RE = /0x[a-fA-F0-9]{64}/g
const ADDRESS_RE = /0x[a-fA-F0-9]{40}/g
function jsonToYaml(obj: any): string {
  const recur = (v: any, indent = 0): string => {
    const pad = " ".repeat(indent)
    if (Array.isArray(v)) return v.map((x) => `${pad}- ${typeof x === "object" ? "\n" + recur(x, indent + 2) : String(x)}`).join("\n")
    if (v && typeof v === "object") return Object.entries(v).map(([k, val]) => `${pad}${k}: ${val && typeof val === "object" ? "\n" + recur(val, indent + 2) : String(val)}`).join("\n")
    return `${pad}${String(v)}`
  }
  return recur(obj)
}

export function RepoJudge() {
  const [repoUrl, setRepoUrl] = useState("")
  const [projectName, setProjectName] = useState("")
  const [token, setToken] = useState<string | undefined>(undefined)   // ← solo en memoria
  const [showToken, setShowToken] = useState(false)                   // ← toggle ojo

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<ScoreData | null>(null)
  const [history, setHistory] = useState<ScoreData[]>([])

  useEffect(() => {
    const raw = localStorage.getItem("repoJudgeHistoryV2")
    if (raw) setHistory(JSON.parse(raw))
  }, [])
  useEffect(() => {
    localStorage.setItem("repoJudgeHistoryV2", JSON.stringify(history))
  }, [history])

  const analyze = async () => {
    try {
      setLoading(true)
      setError(null)
      if (!repoUrl) throw new Error("Ingresa la URL del repo de GitHub")
      const { owner, repo, branch } = parseRepoUrl(repoUrl)

      const meta: any = await gh(`/repos/${owner}/${repo}`, token)
      const defaultBranch = branch || meta.default_branch || "main"
      const license = meta.license?.spdx_id || meta.license?.key || "UNKNOWN"

      const commits: any[] = await gh(`/repos/${owner}/${repo}/commits?per_page=5&sha=${defaultBranch}`, token)
      const commit_sample = (commits || []).slice(0, 5).map((c: any) => c.sha)

      const head: any = await gh(`/repos/${owner}/${repo}/commits/${defaultBranch}`, token)
      const headSha = head?.sha
      const treeRes: any = await gh(`/repos/${owner}/${repo}/git/trees/${headSha}?recursive=1`, token)
      const all = (treeRes.tree || []) as Array<{ path: string; type: string; size?: number }>

      const include = [/^README\.md$/i, /^docs\//i, /^contracts\//i, /^src\//i, /^app\//i, /^test\//i, /^package\.json$/i, /^\.env\.example$/i, /^foundry\.toml$/i, /^hardhat\.config\.(js|ts|cjs|mjs)$/i]
      const exclude = [/^node_modules\//, /^dist\//, /^build\//, /^out\//, /^\.next\//, /\.(png|jpe?g|gif|webp|svg)$/i, /\.lock$/]
      const interesting = all.filter((e) =>
        e.type === "blob" && (e.size ?? 0) <= 60_000 && include.some((rx) => rx.test(e.path)) && !exclude.some((rx) => rx.test(e.path))
      ).slice(0, 60)

      const texts: Record<string, string> = {}
      for (const f of interesting) {
        try { texts[f.path] = await getRaw(owner, repo, f.path, defaultBranch, token) } catch {}
      }

      const join = (pred: (p: string) => boolean) =>
        Object.entries(texts).filter(([p]) => pred(p)).map(([, t]) => t).join("\n\n")

      const readme = texts["README.md"] || ""
      const docs = join((p) => p.startsWith("docs/") || p.toLowerCase().includes("readme"))
      const src = join((p) => p.startsWith("src/") || p.startsWith("app/") || /\.(ts|tsx|js|jsx)$/i.test(p))
      const contractsSrc = join((p) => p.startsWith("contracts/"))

      const mentionsAvalanche = /(Avalanche|C-?Chain|Fuji|Subnet)/i.test(readme + docs)
      const network = /Fuji/i.test(readme + docs) ? "fuji" : /Subnet/i.test(readme + docs) ? "subnet" : /Avalanche|C-?Chain/i.test(readme + docs) ? "avalanche mainnet" : ""
      const mentionsUSDT = /\b(USDT|Tether)\b/i.test(readme + docs + src)
      const mentionsWDK = /\b(WDK|Tether\s+WDK)\b/i.test(readme + docs)
      const usdtAddress = (readme + docs).match(ADDRESS_RE)?.find((a) => a) || ""
      const snowtraceLinks = Array.from(new Set((readme + docs).match(/https?:\/\/[^)\s]+snowtrace[^)\s]+/gi) || []))

      const happyPath = /(flujo|flow|pago|payment).*(exitos|success|confirm)/i.test(readme + docs)
      const idempotency = /idempotenc/i.test(readme + docs + src) ? "pass" : "unknown"
      const errorHandling: Report["payments_flow"]["error_handling"] =
        /(error handling|manejo de errores|retry|timeout|backoff)/i.test(readme + docs + src) ? "documented" : "missing"
      const doubleSend = /(double\s*(click|submit|env[ií]o)|idempotent)/i.test(readme + docs + src) ? "yes" : "unknown"
      const txHashes = (readme + docs).match(TX_RE) || []
      const txHappy = txHashes[0]

      const refundDoc = /(refund|reembolso)/i.test(readme + docs)
      const splitDoc = /(split|revenue\s*split|divisi[oó]n de ingresos)/i.test(readme + docs)
      const refundTx = refundDoc ? txHashes.find((h) => h) : undefined
      const splitTx = splitDoc ? txHashes.slice(1).find((h) => h) : undefined

      const hasNonReentrant = /nonReentrant/i.test(contractsSrc)
      const hasAccess = /(onlyOwner|AccessControl)/i.test(contractsSrc)
      const hasPausable = /Pausable/i.test(contractsSrc)
      const hasSelfdestruct = /selfdestruct\s*\(/i.test(contractsSrc)
      const hasDelegatecall = /delegatecall\s*\(/i.test(contractsSrc)
      const usesTxOrigin = /tx\.origin/i.test(contractsSrc)
      const ceiHeuristic = /(require\(|revert|if\s*\().*?;\s*(?:\/\/.*)?\s*[^]*?(transfer|call|send)/is.test(contractsSrc)

      const allowancesPattern: Report["security"]["allowances"]["pattern"] =
        /permit/i.test(src + readme + docs) ? "permit" : /approve\([^,]+,\s*max|infinite/i.test(src + readme + docs) ? "infinite" : /approve/i.test(src + readme + docs) ? "minimal" : "unknown"
      const revokeMention = /(revoke|revocar|revoke\.cash)/i.test(readme + docs)

      const secretsFound = /(PRIVATE_KEY|MNEMONIC|SEED|API_KEY|RPC_URL)\s*=\s*["']?[A-Za-z0-9_-]{10,}/.test(readme + docs + src)
      const threatModel = /(threat\s*model|modelo\s*de\s*amenazas)/i.test(readme + docs)

      const logsDoc: Report["observability"]["logs"] =
        /(structured\s*log|pino|winston)/i.test(src + readme + docs) ? "structured" :
        /(console\.log|logger)/i.test(src + readme + docs) ? "basic" : "none"
      const metricsDoc: Report["observability"]["metrics"] = /(metrics|prometheus|otel|openTelemetry)/i.test(src + readme + docs) ? "present" : "none"
      const retriesDoc: Report["observability"]["retries_timeouts"] = /(retry|backoff|timeout)/i.test(src + readme + docs) ? "present" : "none"

      const latencyMention = /(latenc(y|ia)|p50|p95)/i.test(readme + docs)
      const gasMention = /\bgas\b/i.test(readme + docs)

      const readmeComplete = /setup|instalaci[oó]n|getting\s*started/i.test(readme) && /network|address|direcci[oó]n|fuji|avalanche/i.test(readme)
      const envExample = !!texts[".env.example"]
      const archDiagram = /(architecture|arquitectura|diagram)/i.test(readme + docs)

      const testsPresent = Object.keys(texts).some((p) => p.startsWith("test/"))
      const lintOk = /lint|eslint|prettier/i.test(readme + docs + (texts["package.json"] || ""))
      const coveragePct = /coverage/i.test(readme + docs) ? 60 : 0

      const showsTxHash = /(tx\s*hash|hash de transacci[oó]n)/i.test(readme + docs + src)
      const txStatusFeedback = /(loading|cargando|pending).*tx|estado\s*de\s*transacci[oó]n/i.test(readme + docs + src)

      const has4337 = /4337|account\s*abstraction/i.test(readme + docs + src)
      const hasSubnets = /subnet/i.test(readme + docs)
      const stressTest = /(k6|artillery|wrk)/i.test(readme + docs)
      const onOffRamp = /(ramp|transak|moonpay|onramp|offramp)/i.test(readme + docs)

      const noOnchainTx = !txHappy
      const copyWithoutAttrib = false

      const report: Report = {
        project: {
          repo_url: repoUrl, branch: defaultBranch, name: projectName || `${owner}/${repo}`, license,
          stack: {
            frontend: /next|vite|react/i.test(readme + docs + (texts["package.json"] || "")) ? "web" : "",
            backend: /node|express|fastify/i.test(readme + docs + (texts["package.json"] || "")) ? "node" : "",
            contracts_tooling: /hardhat/i.test(readme + docs + contractsSrc) ? "hardhat" : /foundry/i.test(readme + docs + contractsSrc) ? "foundry" : "",
          },
          commit_sample,
        },
        deploy: { network, usdt_address: usdtAddress || "", wdk_used: !!mentionsWDK },
        contracts: { list: [{ name: undefined, address: usdtAddress || undefined, network: network || undefined, verified_on_snowtrace: snowtraceLinks.length > 0, snowtrace_url: snowtraceLinks[0], events_emitted: (contractsSrc.match(/event\s+([A-Za-z0-9_]+)/g) || []).map((e) => e.replace(/event\s+/, "")) }] },
        payments_flow: { happy_path: { tx_hash: txHappy, screenshot_or_log: "" }, idempotency_check: idempotency, double_send_prevented: doubleSend, error_handling: errorHandling },
        refunds_splits: { refund: { present: refundDoc, tx_hash: refundTx }, splits: { present: splitDoc, tx_hash: splitTx } },
        security: {
          allowances: { pattern: allowancesPattern, revocation_documented: revokeMention },
          patterns: { cei: ceiHeuristic, reentrancy_guard: hasNonReentrant, access_control: [hasAccess ? "roles/onlyOwner" : "", hasPausable ? "pausable" : ""].filter(Boolean) },
          secrets_in_repo: secretsFound, threat_model_present: threatModel,
        },
        observability: { logs: logsDoc, metrics: metricsDoc, retries_timeouts: retriesDoc },
        performance_costs: { latency_ms: { p50: latencyMention ? 300 : 0, p95: latencyMention ? 800 : 0 }, gas: { payment: gasMention ? 70000 : 0, refund: gasMention ? 50000 : 0, split: gasMention ? 60000 : 0 }, monthly_cost_estimate_usd: 0 },
        code_quality_tests: { lint_ok: !!lintOk, tests_present: !!testsPresent, coverage_pct: coveragePct },
        documentation_devex: { readme_complete: readmeComplete, env_example_present: envExample, arch_diagram_present: archDiagram },
        technical_ux: { tx_status_feedback: txStatusFeedback, double_submit_guard: doubleSend === "yes", shows_tx_hash: showsTxHash },
        bonus: { eip4337: has4337, subnets: hasSubnets, stress_test: stressTest, on_off_ramp: onOffRamp },
        penalties: { no_onchain_tx: noOnchainTx, secrets_exposed: secretsFound, copy_without_attrib: copyWithoutAttrib },
        scoring: {
          rubric: {
            payments_functionality: { score_0_5: (happyPath ? 2 : 0) + (txHappy ? 2 : 0) + (mentionsUSDT || mentionsWDK ? 1 : 0), weight: 25, points: 0 },
            blockchain_integration: { score_0_5: (mentionsAvalanche ? 2 : 0) + (mentionsWDK ? 2 : 0) + (snowtraceLinks.length ? 1 : 0), weight: 20, points: 0 },
            security_safety: { score_0_5: 5 - Math.min(4, (secretsFound ? 2 : 0) + (hasSelfdestruct ? 1 : 0) + (hasDelegatecall ? 1 : 0) + (usesTxOrigin ? 1 : 0)), weight: 15, points: 0 },
            reliability_observ: { score_0_5: (logsDoc !== "none" ? 2 : 0) + (metricsDoc === "present" ? 2 : 0) + (retriesDoc === "present" ? 1 : 0), weight: 10, points: 0 },
            performance_cost: { score_0_5: (latencyMention ? 2 : 0) + (gasMention ? 2 : 0) + 1, weight: 10, points: 0 },
            code_quality_tests: { score_0_5: (testsPresent ? 2 : 0) + (coveragePct > 0 ? 1 : 0) + (lintOk ? 1 : 0) + 1, weight: 10, points: 0 },
            docs_devex: { score_0_5: (readmeComplete ? 2 : 0) + (envExample ? 2 : 0) + (archDiagram ? 1 : 0), weight: 5, points: 0 },
            technical_ux: { score_0_5: (showsTxHash ? 2 : 0) + (txStatusFeedback ? 2 : 0) + (doubleSend === "yes" ? 1 : 0), weight: 5, points: 0 },
          },
          bonus_points: (has4337 ? 2 : 0) + (hasSubnets ? 2 : 0) + (stressTest ? 2 : 0) + (onOffRamp ? 2 : 0),
          penalties_points: (noOnchainTx ? 15 : 0) + (secretsFound ? 20 : 0) + 0,
          total: 0,
        },
        evidence: { repo_metadata_file: "repo_metadata.json", env_audit_file: "env_audit.txt", gas_report_file: "gas_report.txt", perf_file: "perf.json", attachments: [] },
        summary: { highlights: [], risks: [], recommendations: [] },
      }

      let total = 0
      ;(Object.keys(report.scoring.rubric) as Array<keyof Report["scoring"]["rubric"]>).forEach((k) => {
        const it = report.scoring.rubric[k]
        it.points = Number(((Math.max(0, Math.min(5, it.score_0_5)) / 5) * it.weight).toFixed(2))
        total += it.points
      })
      total += report.scoring.bonus_points
      total -= report.scoring.penalties_points
      report.scoring.total = Number(total.toFixed(2))

      const securityRiskIndex = Math.min(100, (report.security.secrets_in_repo ? 40 : 0) + (hasSelfdestruct ? 10 : 0) + (hasDelegatecall ? 10 : 0) + (usesTxOrigin ? 10 : 0))
      const onChainProof = (() => { let pts = 0; if (txHappy) pts += 1; if (refundDoc && refundTx) pts += 1; if (splitDoc && splitTx) pts += 1; return (pts / 3) * 100 })()
      const docsCompleteness = (100 * [report.documentation_devex.readme_complete, report.documentation_devex.env_example_present, report.documentation_devex.arch_diagram_present, mentionsWDK].filter(Boolean).length) / 4
      const paymentRobustness = 20 * [happyPath, idempotency === "pass", errorHandling === "documented", doubleSend === "yes", showsTxHash].filter(Boolean).length
      const overallFiveScale = (report.scoring.total / 100) * 5

      const scoreData: ScoreData = {
        owner, repo,
        technical_score: toFixed1((report.scoring.total / 100) * 5),
        security_risk: toFixed1(securityRiskIndex / 20),
        on_chain_proof: Number(onChainProof.toFixed(2)),
        docs_completeness: Number(docsCompleteness.toFixed(2)),
        payment_robustness: paymentRobustness,
        overall_score: toFixed1(overallFiveScale),
        timestamp: new Date().toISOString(),
        report,
      }

      setCurrent(scoreData)
      setHistory((prev) => [scoreData, ...prev].slice(0, 20))
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
      // NOTA: NO limpiamos el token aquí. Vive solo en memoria y desaparece al cerrar la pestaña.
    }
  }

  const exportData = (format: "json" | "csv" | "yaml") => {
    if (!current) return
    if (format === "json") {
      const blob = new Blob([JSON.stringify(current.report, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url
      a.download = `${current.owner}-${current.repo}-report.json`; a.click(); return
    }
    if (format === "yaml") {
      const blob = new Blob([jsonToYaml(current.report)], { type: "text/yaml" })
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url
      a.download = `${current.owner}-${current.repo}-report.yaml`; a.click(); return
    }
    const row = [
      `${current.owner}/${current.repo}`, current.overall_score, current.technical_score, current.security_risk,
      current.on_chain_proof, current.docs_completeness, current.payment_robustness, current.timestamp,
    ].join(",")
    const csv = `Repository,Overall(0-5),Technical(0-5),SecurityRisk(~0-5),OnChain(%),Docs(%),Payment(0-100),Timestamp\n${row}\n`
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url
    a.download = `${current.owner}-${current.repo}.csv`; a.click()
  }

  const ScoreCard = ({ label, value, icon: Icon }: { label: string; value: number; icon: any }) => (
    <div className="bg-gradient-to-br from-sidebar-accent to-sidebar-accent/50 rounded-lg p-4 border border-sidebar-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-sidebar-foreground/70">{label}</span>
        <Icon className="w-4 h-4 text-chart-1" />
      </div>
      <div className="text-2xl font-bold text-sidebar-foreground">{value.toFixed(1)}</div>
      <div className="text-xs text-sidebar-foreground/50 mt-1">Scaled</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-chart-1 to-chart-2 rounded-lg p-2">
              <Github className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Repo Judge — Avalanche + WDK</h1>
              <p className="text-sm text-muted-foreground">Static audit for the hackathon rubric</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <Card className="p-6 bg-card border-border">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-2">GitHub Repository URL</label>
              <Input
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && analyze()}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Project name (optional)</label>
              <Input placeholder="Team / dApp name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </div>

            {/* Campo de token efímero (password con ojo) */}
            <div className="md:col-span-3">
              <label className="block text-xs text-muted-foreground mb-2">
                GitHub token (opcional, solo para evitar rate-limit). No se guarda.
              </label>
              <div className="relative">
                <Input
                  type={showToken ? "text" : "password"}
                  placeholder="ghp_..."
                  value={token || ""}
                  onChange={(e) => setToken(e.target.value || undefined)}
                  autoComplete="off"
                  spellCheck={false}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                  className="absolute inset-y-0 right-0 px-3 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="md:col-span-3 flex gap-2">
              <Button onClick={analyze} disabled={!repoUrl || loading} className="bg-chart-1 hover:bg-chart-1/90 text-white">
                {loading ? "Analyzing..." : "Analyze & Score"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setCurrent(null)
                  setHistory([])
                  localStorage.removeItem("repoJudgeHistoryV2")
                  // *No* tocamos el token aquí.
                }}
              >
                Clear
              </Button>
            </div>

            {error && (
              <div className="md:col-span-3 bg-destructive/10 text-destructive border border-destructive/20 rounded p-3 text-sm">
                {error}
              </div>
            )}
          </div>
        </Card>

        {current && (
          <div className="space-y-8">
            <Card className="p-6 bg-gradient-to-br from-card to-card/50 border-border">
              <div className="text-center mb-6">
                <h2 className="text-lg font-semibold text-foreground mb-2">
                  {current.owner}/{current.repo}
                </h2>
                <div className="inline-flex items-center justify-center">
                  <div className="relative w-32 h-32">
                    <svg className="w-32 h-32 transform -rotate-90">
                      <circle cx="64" cy="64" r="60" fill="none" stroke="var(--color-border)" strokeWidth="8" />
                      <circle
                        cx="64" cy="64" r="60" fill="none" stroke="var(--color-chart-1)" strokeWidth="8"
                        strokeLinecap="round" strokeDasharray={`${(current.overall_score / 5) * 376.99} 376.99`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-3xl font-bold text-foreground">{current.overall_score.toFixed(1)}</div>
                        <div className="text-xs text-muted-foreground">/5.0</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <ScoreCard label="Technical (0–5)" value={current.technical_score} icon={Code} />
              <ScoreCard label="Security (~0–5)" value={current.security_risk} icon={Shield} />
              <ScoreCard label="On-Chain (%)" value={current.on_chain_proof / 20} icon={Zap} />
              <ScoreCard label="Docs (%)" value={current.docs_completeness / 20} icon={Book} />
              <ScoreCard label="Payment (0–100)" value={current.payment_robustness / 20} icon={TrendingUp} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6 bg-card border-border">
                <h3 className="text-lg font-semibold text-foreground mb-4">Score Breakdown</h3>
                <div className="rounded-lg p-2" style={{ background: "var(--chart-bg)" }}>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={[{ name: "Score", Technical: current.technical_score, Security: current.security_risk, OnChain: current.on_chain_proof / 20, Docs: current.docs_completeness / 20, Payment: Math.min(5, current.payment_robustness / 20) }]}
                    >
                      <CartesianGrid stroke="var(--chart-grid)" />
                      <XAxis dataKey="name" tick={{ fill: "var(--chart-tick)", fontSize: 12 }} axisLine={{ stroke: "var(--chart-grid)" }} tickLine={{ stroke: "var(--chart-grid)" }} />
                      <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 12 }} axisLine={{ stroke: "var(--chart-grid)" }} tickLine={{ stroke: "var(--chart-grid)" }} domain={[0, 5]} />
                      <Tooltip
                        contentStyle={{ background: "var(--chart-tooltip)", border: "1px solid var(--chart-tooltip-b)", borderRadius: 8 }}
                        labelStyle={{ color: "var(--foreground)" }} itemStyle={{ color: "var(--foreground)" }}
                      />
                      <Bar dataKey="Technical" fill="var(--color-chart-1)" radius={[8,8,0,0]} />
                      <Bar dataKey="Security"  fill="var(--color-chart-2)" radius={[8,8,0,0]} />
                      <Bar dataKey="OnChain"   fill="var(--color-chart-3)" radius={[8,8,0,0]} />
                      <Bar dataKey="Docs"      fill="var(--color-chart-4)" radius={[8,8,0,0]} />
                      <Bar dataKey="Payment"   fill="var(--color-chart-5)" radius={[8,8,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-6 bg-card border-border">
                <h3 className="text-lg font-semibold text-foreground mb-4">Metrics Radar</h3>
                <div className="rounded-lg p-2" style={{ background: "var(--chart-bg)" }}>
                  <ResponsiveContainer width="100%" height={300}>
                    <RadarChart data={[
                      { metric: "Technical", value: current.technical_score, fullMark: 5 },
                      { metric: "Security", value: current.security_risk, fullMark: 5 },
                      { metric: "On-Chain", value: current.on_chain_proof / 20, fullMark: 5 },
                      { metric: "Docs", value: current.docs_completeness / 20, fullMark: 5 },
                      { metric: "Payment", value: Math.min(5, current.payment_robustness / 20), fullMark: 5 },
                    ]}>
                      <PolarGrid stroke="var(--chart-grid)" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: "var(--chart-tick)", fontSize: 12 }} />
                      <PolarRadiusAxis tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-grid)" />
                      <Radar dataKey="value" stroke="var(--color-chart-1)" strokeWidth={2} fill="var(--color-chart-1)" fillOpacity={0.30} />
                      <Tooltip
                        contentStyle={{ background: "var(--chart-tooltip)", border: "1px solid var(--chart-tooltip-b)", borderRadius: 8 }}
                        labelStyle={{ color: "var(--foreground)" }} itemStyle={{ color: "var(--foreground)" }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">Analysis Details</h3>
              <Tabs defaultValue="payments" className="w-full">
                <TabsList className="grid w-full grid-cols-4 bg-sidebar/50">
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                  <TabsTrigger value="security">Security</TabsTrigger>
                  <TabsTrigger value="documentation">Docs</TabsTrigger>
                  <TabsTrigger value="web3">Web3</TabsTrigger>
                </TabsList>

                <TabsContent value="payments" className="mt-4">
                  <div className="space-y-2 text-sm text-foreground">
                    <div>Happy path: {current.report.payments_flow.happy_path.tx_hash ? "documented" : "missing"}</div>
                    <div>Idempotency: {current.report.payments_flow.idempotency_check}</div>
                    <div>Double send: {current.report.payments_flow.double_send_prevented}</div>
                    <div>Error handling: {current.report.payments_flow.error_handling}</div>
                    <div>USDT/WDK: {current.report.deploy.wdk_used ? "WDK" : current.report.deploy.usdt_address ? "USDT" : "—"}</div>
                  </div>
                </TabsContent>

                <TabsContent value="security" className="mt-4">
                  <div className="space-y-2 text-sm text-foreground">
                    <div>nonReentrant: {current.report.security.patterns.reentrancy_guard ? "yes" : "no"}</div>
                    <div>Access control: {current.report.security.patterns.access_control.join(", ") || "—"}</div>
                    <div>Pausable: {current.report.security.patterns.access_control.includes("pausable") ? "yes" : "no"}</div>
                    <div>Secrets in repo: {current.report.security.secrets_in_repo ? "YES" : "no"}</div>
                    <div>Allowances: {current.report.security.allowances.pattern}</div>
                  </div>
                </TabsContent>

                <TabsContent value="documentation" className="mt-4">
                  <div className="space-y-2 text-sm text-foreground">
                    <div>README completo: {current.report.documentation_devex.readme_complete ? "yes" : "no"}</div>
                    <div>.env.example: {current.report.documentation_devex.env_example_present ? "yes" : "no"}</div>
                    <div>Arquitectura: {current.report.documentation_devex.arch_diagram_present ? "yes" : "no"}</div>
                  </div>
                </TabsContent>

                <TabsContent value="web3" className="mt-4">
                  <div className="space-y-2 text-sm text-foreground">
                    <div>Network: {current.report.deploy.network || "—"}</div>
                    <div>SnowTrace links: {current.report.contracts.list[0]?.snowtrace_url ? "yes" : "no"}</div>
                    <div>Events: {(current.report.contracts.list[0]?.events_emitted || []).join(", ") || "—"}</div>
                  </div>
                </TabsContent>
              </Tabs>
            </Card>

            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">Export Results</h3>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => exportData("json")} variant="outline" className="gap-2"><FileJson className="w-4 h-4" /> JSON (report)</Button>
                <Button onClick={() => exportData("yaml")} variant="outline" className="gap-2"><Code className="w-4 h-4" /> YAML (report)</Button>
                <Button onClick={() => exportData("csv")} variant="outline" className="gap-2"><FileText className="w-4 h-4" /> CSV (metrics)</Button>
              </div>
            </Card>

            {history.length > 1 && (
              <Card className="p-6 bg-card border-border">
                <h3 className="text-lg font-semibold text-foreground mb-4">Recent Analyses</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {history.slice(1).map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 bg-sidebar/30 rounded border border-border/50 cursor-pointer hover:bg-sidebar/50 transition-colors"
                      onClick={() => { setRepoUrl(`https://github.com/${item.owner}/${item.repo}`); setCurrent(item) }}
                    >
                      <span className="text-sm text-foreground">{item.owner}/{item.repo}</span>
                      <span className="text-sm font-semibold text-chart-1">{item.overall_score}/5</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {!current && !loading && (
          <Card className="p-12 bg-card/50 border-border border-dashed text-center">
            <Github className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Repository Analyzed</h3>
            <p className="text-muted-foreground">Paste a GitHub URL and we’ll score it with the Avalanche + WDK rubric.</p>
          </Card>
        )}
      </main>
    </div>
  )
}
