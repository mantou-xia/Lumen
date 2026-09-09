import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CircleCheck,
  Cpu,
  Database,
  HardDrive,
  MousePointer2,
  MoveHorizontal,
  Network,
  Palette,
  RotateCcw,
  Rows3,
  Sparkles,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";

import type { HealthResponse, ProviderStatus } from "@lumen/api-contract";

import { getHealth } from "../api/health";
import { getLearningItems } from "../api/learning";
import { getDocuments } from "../api/library";
import { getProviderStatus } from "../api/translation";
import { AppIcon } from "../app/AppIcon";
import { AppShell } from "../app/AppShell";
import {
  Button,
  ButtonBase,
  ScrollArea,
  StatusNotice,
  SurfaceCard,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
} from "../app/ui";
import {
  type ColorTheme,
  type ReadingFontSize,
  type ReadingLineHeight,
  type ReadingWidth,
  usePreferences,
} from "../app/preferences";
import "./settings.css";

const themes: Array<{ id: ColorTheme; name: string; description: string }> = [
  { id: "light", name: "明亮纸张", description: "中性纸白，适合高亮度与学术阅读" },
  { id: "sepia", name: "柔和暖纸", description: "典雅复古，长时间阅读更柔和" },
  { id: "dark", name: "深色低光", description: "低光环境使用，减少屏幕刺激" },
];

export function SettingsPage() {
  const [searchParams] = useSearchParams();
  const { preferences, resetPreferences, updatePreferences } = usePreferences();
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [documentCount, setDocumentCount] = useState(0);
  const [expressionCount, setExpressionCount] = useState(0);
  const [contextCount, setContextCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([getHealth(), getProviderStatus(), getDocuments(), getLearningItems()])
      .then(([nextHealth, nextProvider, documents, learning]) => {
        if (!active) return;
        setHealth(nextHealth);
        setProvider(nextProvider);
        setDocumentCount(documents.length);
        setExpressionCount(learning.totalExpressions);
        setContextCount(learning.totalContexts);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "无法读取本地设置状态");
      });
    return () => { active = false; };
  }, []);

  const providerLabel = useMemo(() => {
    if (provider === null) return "正在读取";
    return provider.provider === "deepseek" ? "DeepSeek 预设" : "OpenAI-compatible 中转站";
  }, [provider]);
  const requestedReturnTo = searchParams.get("returnTo");
  const returnTo = requestedReturnTo?.startsWith("/reader/") && !requestedReturnTo.startsWith("//")
    ? requestedReturnTo
    : null;

  return (
    <AppShell activeSection="settings" quickSearchLabel="快速检索文献" workspaceLabel="System Preferences">
      <div className="settings-page">
        <header className="settings-heading">
          <div>
            <p className="settings-kicker">System Preferences &amp; AI Engine</p>
            <h1>设置</h1>
            <p>管理阅读外观、交互习惯、本地 AI 模型连接与数据概览。偏好仅保存在本设备。</p>
          </div>
          <div className="settings-heading-actions">
            {returnTo !== null && (
              <Link className="settings-return-reading" to={returnTo}>
                <AppIcon icon={ArrowLeft} size={15} />返回阅读
              </Link>
            )}
            <span className={`settings-health${health === null ? "" : " is-ready"}`}>
              <i />{health === null ? "正在连接本地服务" : `Local Service v${health.version}`}
            </span>
          </div>
        </header>

        {loadError !== null && <StatusNotice className="settings-alert" tone="danger">{loadError}</StatusNotice>}

        <div className="settings-layout">
          <ScrollArea axis="x" className="settings-section-nav" component="nav" aria-label="设置分区">
            <a href="#appearance"><AppIcon icon={Palette} size={16} />阅读外观</a>
            <a href="#interaction"><AppIcon icon={MousePointer2} size={16} />阅读交互</a>
            <a href="#provider"><AppIcon icon={Cpu} size={16} />AI Provider</a>
            <a href="#storage"><AppIcon icon={Database} size={16} />本地数据与隐私</a>
            <Button type="button" variant="ghost" onClick={resetPreferences}><AppIcon icon={RotateCcw} size={16} />恢复默认偏好</Button>
          </ScrollArea>

          <div className="settings-sections">
            <SettingsSection id="appearance" index="01" eyebrow="Aesthetic Scheme" title="阅读外观" note="实时自动生效">
              <div className="theme-grid" role="radiogroup" aria-label="主题风格">
                {themes.map((theme) => (
                  <ButtonBase
                    aria-checked={preferences.colorTheme === theme.id}
                    className={`theme-choice theme-choice--${theme.id}${preferences.colorTheme === theme.id ? " is-active" : ""}`}
                    key={theme.id}
                    onClick={() => updatePreferences({ colorTheme: theme.id })}
                    role="radio"
                    type="button"
                  >
                    <span className="theme-preview"><i /><i /><i /></span>
                    <strong>{theme.name}</strong>
                    <small>{theme.description}</small>
                    <em>{preferences.colorTheme === theme.id && <AppIcon icon={CircleCheck} size={13} />}{preferences.colorTheme === theme.id ? "当前选择" : "切换主题"}</em>
                  </ButtonBase>
                ))}
              </div>

              <div className="reading-controls">
                <PreferenceRow icon={MoveHorizontal} label="排版宽度" description="控制正文每行长度，避免视线横向移动过远">
                  <SegmentedControl<ReadingWidth>
                    options={[680, 760, 840]}
                    value={preferences.readingWidth}
                    format={(value) => `${value}px`}
                    onChange={(readingWidth) => updatePreferences({ readingWidth })}
                  />
                </PreferenceRow>
                <PreferenceRow icon={Type} label="正文字号" description="调整 Reader 中正文与标题的基础比例">
                  <SegmentedControl<ReadingFontSize>
                    options={[16, 18, 20]}
                    value={preferences.readingFontSize}
                    format={(value) => `${value}px`}
                    onChange={(readingFontSize) => updatePreferences({ readingFontSize })}
                  />
                </PreferenceRow>
                <PreferenceRow icon={Rows3} label="阅读行高" description="调整段落垂直节奏与文本呼吸感">
                  <SegmentedControl<ReadingLineHeight>
                    options={[1.6, 1.75, 1.9]}
                    value={preferences.readingLineHeight}
                    format={(value) => String(value)}
                    onChange={(readingLineHeight) => updatePreferences({ readingLineHeight })}
                  />
                </PreferenceRow>
              </div>
            </SettingsSection>

            <SettingsSection id="interaction" index="02" eyebrow="Interactive Habits" title="阅读交互" note="专注于阅读">
              <ToggleRow
                checked={preferences.autoTranslateSelection}
                description="选择英文表达后自动生成当前语境翻译；关闭后不会发起翻译请求。"
                label="划词自动翻译"
                onChange={(autoTranslateSelection) => updatePreferences({ autoTranslateSelection })}
              />
              <ToggleRow
                checked={preferences.recallEnabled}
                description="阅读中再次遇到已收藏表达时，保留标记并允许主动打开 Recall。"
                label="阅读中 Recall 提示"
                onChange={(recallEnabled) => updatePreferences({ recallEnabled })}
              />
            </SettingsSection>

            <SettingsSection id="provider" index="03" eyebrow="Local Intelligence Bridge" title="AI Provider" note={provider?.configured ? "连接正常" : "等待配置"}>
              <div className="provider-presets">
                <div className={`provider-preset${provider?.provider === "deepseek" ? " is-active" : ""}`}>
                  <strong><AppIcon icon={Sparkles} size={17} />DeepSeek 预设</strong>
                  <span>只需在根目录 .env 中填写 LUMEN_AI_API_KEY</span>
                </div>
                <div className={`provider-preset${provider?.provider === "openai-compatible" ? " is-active" : ""}`}>
                  <strong><AppIcon icon={Network} size={17} />OpenAI-compatible</strong>
                  <span>支持实现 OpenAI Chat Completions 协议的通用中转站</span>
                </div>
              </div>
              <dl className="provider-details">
                <div><dt>当前 Provider</dt><dd>{providerLabel}</dd></div>
                <div><dt>Base URL</dt><dd>{provider?.baseUrl ?? "由 Local Service 环境变量提供"}</dd></div>
                <div><dt>模型</dt><dd>{provider?.model ?? "尚未配置"}</dd></div>
                <div><dt>API Key</dt><dd>{provider?.configured ? "已由 Local Service 安全加载" : "未配置（不会存入浏览器）"}</dd></div>
              </dl>
              <p className={`provider-status${provider?.configured ? " is-ready" : ""}`}>
                <i />{provider?.configured ? "Provider 已配置，可使用划词翻译" : "请修改根目录 .env 后重启 Local Service"}
              </p>
            </SettingsSection>

            <SettingsSection id="storage" index="04" eyebrow="Offline Data & Privacy" title="本地数据" note={`SQLite schema ${health?.database.schemaVersion ?? "-"}`}>
              <p className="storage-owner"><AppIcon icon={HardDrive} size={17} />SQLite 与文档资源均由 Local Service 统一管理，Web UI 不直接访问数据库或业务文件。</p>
              <div className="storage-stats">
                <span><strong>{documentCount}</strong>已导入文档</span>
                <span><strong>{expressionCount}</strong>收藏表达</span>
                <span><strong>{contextCount}</strong>真实阅读语境</span>
                <span><strong>{health?.database.status === "ready" ? "就绪" : "连接中"}</strong>数据库状态</span>
              </div>
            </SettingsSection>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SettingsSection({ children, eyebrow, id, index, note, title }: {
  children: React.ReactNode;
  eyebrow: string;
  id: string;
  index: string;
  note: string;
  title: string;
}) {
  return (
    <SurfaceCard className="settings-card" id={id}>
      <header><div><p>{index} / {eyebrow}</p><h2>{title}</h2></div><span>{note}</span></header>
      {children}
    </SurfaceCard>
  );
}

function PreferenceRow({ children, description, icon, label }: { children: React.ReactNode; description: string; icon: LucideIcon; label: string }) {
  return <div className="preference-row"><div><strong><AppIcon icon={icon} size={16} />{label}</strong><small>{description}</small></div>{children}</div>;
}

function SegmentedControl<T extends number>({ format, onChange, options, value }: {
  format: (option: T) => string;
  onChange: (option: T) => void;
  options: T[];
  value: T;
}) {
  return (
    <ToggleButtonGroup
      className="segmented-control"
      exclusive
      size="small"
      value={value}
      onChange={(_event, option: T | null) => {
        if (option !== null) onChange(option);
      }}
    >
      {options.map((option) => (
        <ToggleButton className={option === value ? "is-active" : ""} key={option} value={option}>
          {format(option)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

function ToggleRow({ checked, description, label, onChange }: { checked: boolean; description: string; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span><strong>{label}</strong><small>{description}</small></span>
      <Switch checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
