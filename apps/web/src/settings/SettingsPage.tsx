import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
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

import type {
  HealthResponse,
  NetworkRouteMode,
  NetworkRouteStatus,
  NetworkSettings,
  ProviderStatus,
} from "@lumen/api-contract";

import { getHealth } from "../api/health";
import { getLearningItems } from "../api/learning";
import { getDocuments } from "../api/library";
import { getNetworkSettings, updateNetworkSettings } from "../api/network-settings";
import { getProviderStatus } from "../api/translation";
import { AppIcon } from "../app/AppIcon";
import { AppShell } from "../app/AppShell";
import {
  Button,
  ButtonBase,
  Field,
  MenuItem,
  ScrollArea,
  Select,
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
import {
  findActiveSettingsSection,
  parseSettingsSectionHash,
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "./settings-navigation";
import "./settings.css";

const themes: Array<{ id: ColorTheme; name: string; description: string }> = [
  { id: "light", name: "明亮纸张", description: "中性纸白，适合高亮度与学术阅读" },
  { id: "sepia", name: "柔和暖纸", description: "典雅复古，长时间阅读更柔和" },
  { id: "dark", name: "深色低光", description: "低光环境使用，减少屏幕刺激" },
];

const settingsNavigation: Array<{ id: SettingsSectionId; icon: LucideIcon; label: string }> = [
  { id: "appearance", icon: Palette, label: "阅读外观" },
  { id: "interaction", icon: MousePointer2, label: "阅读交互" },
  { id: "network", icon: Network, label: "网络线路" },
  { id: "provider", icon: Cpu, label: "AI Provider" },
  { id: "storage", icon: Database, label: "本地数据与隐私" },
];

const sectionActivationOffset = 112;

export function SettingsPage() {
  const [searchParams] = useSearchParams();
  const { preferences, resetPreferences, updatePreferences } = usePreferences();
  const pageRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const navigationTargetRef = useRef<SettingsSectionId | null>(null);
  const navigationUnlockTimerRef = useRef<number | null>(null);
  const scheduleActiveSectionSyncRef = useRef<(() => void) | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>("appearance");
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [networkStatus, setNetworkStatus] = useState<NetworkRouteStatus | null>(null);
  const [networkDraft, setNetworkDraft] = useState<NetworkSettings | null>(null);
  const [networkSaving, setNetworkSaving] = useState(false);
  const [networkMessage, setNetworkMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [documentCount, setDocumentCount] = useState(0);
  const [expressionCount, setExpressionCount] = useState(0);
  const [contextCount, setContextCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getHealth(),
      getProviderStatus(),
      getNetworkSettings(),
      getDocuments(),
      getLearningItems(),
    ])
      .then(([nextHealth, nextProvider, nextNetwork, documents, learning]) => {
        if (!active) return;
        setHealth(nextHealth);
        setProvider(nextProvider);
        setNetworkStatus(nextNetwork);
        setNetworkDraft(nextNetwork.settings);
        setDocumentCount(documents.length);
        setExpressionCount(learning.totalExpressions);
        setContextCount(learning.totalContexts);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "无法读取本地设置状态");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    const scrollRoot = page?.closest<HTMLElement>(".library-main");
    if (page === null || scrollRoot === null || scrollRoot === undefined) return;

    let animationFrame = 0;
    const sectionElements = SETTINGS_SECTION_IDS.flatMap((id) => {
      const element = document.getElementById(id);
      return element === null ? [] : [{ id, element }];
    });
    const syncActiveSection = () => {
      animationFrame = 0;
      const rootRect = scrollRoot.getBoundingClientRect();
      const atBottom = scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 2;
      const navigationTarget = navigationTargetRef.current;
      if (navigationTarget !== null) {
        const targetElement = document.getElementById(navigationTarget);
        const targetTop = targetElement === null
          ? Number.POSITIVE_INFINITY
          : targetElement.getBoundingClientRect().top - rootRect.top;
        const targetReached = Math.abs(targetTop - 86) <= 12
          || (navigationTarget === "storage" && atBottom);
        if (!targetReached) return;
        navigationTargetRef.current = null;
      }

      const positions = sectionElements.map(({ id, element }) => ({
        id,
        top: element.getBoundingClientRect().top - rootRect.top + scrollRoot.scrollTop,
      }));
      setActiveSectionId(findActiveSettingsSection(
        positions,
        scrollRoot.scrollTop + sectionActivationOffset,
        atBottom,
      ));
    };
    const scheduleSync = () => {
      if (animationFrame !== 0) return;
      animationFrame = window.requestAnimationFrame(syncActiveSection);
    };
    scheduleActiveSectionSyncRef.current = scheduleSync;
    const handleHashChange = () => {
      const sectionId = parseSettingsSectionHash(window.location.hash);
      setActiveSectionId(sectionId);
      document.getElementById(sectionId)?.scrollIntoView({ block: "start" });
    };

    const initialSectionId = parseSettingsSectionHash(window.location.hash);
    setActiveSectionId(initialSectionId);
    if (window.location.hash !== "") {
      window.requestAnimationFrame(() => {
        document.getElementById(initialSectionId)?.scrollIntoView({ block: "start" });
      });
    }
    scrollRoot.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("hashchange", handleHashChange);
    scheduleSync();

    return () => {
      scrollRoot.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("hashchange", handleHashChange);
      scheduleActiveSectionSyncRef.current = null;
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      if (navigationUnlockTimerRef.current !== null) {
        window.clearTimeout(navigationUnlockTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const navigation = navigationRef.current;
    const activeLink = navigation?.querySelector<HTMLElement>(`[data-section-id="${activeSectionId}"]`);
    if (navigation === null || activeLink === null || activeLink === undefined) return;
    const navigationRect = navigation.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    if (linkRect.left < navigationRect.left || linkRect.right > navigationRect.right) {
      navigation.scrollTo({
        behavior: "smooth",
        left: navigation.scrollLeft + linkRect.left - navigationRect.left - 12,
      });
    }
  }, [activeSectionId]);

  const providerLabel = useMemo(() => {
    if (provider === null) return "正在读取";
    return provider.provider === "deepseek" ? "DeepSeek 预设" : "OpenAI-compatible 中转站";
  }, [provider]);
  const networkRouteLabel = networkStatus?.activeRoute === "proxy" ? "代理线路" : "正常直连";
  const networkSourceLabel = networkStatus?.proxySource === "environment"
    ? "环境变量"
    : networkStatus?.proxySource === "system"
      ? "Windows 系统代理"
      : networkStatus?.proxySource === "manual"
        ? "手动配置"
        : "未发现代理";
  const handleSaveNetwork = async () => {
    if (networkDraft === null) return;
    setNetworkSaving(true);
    setNetworkMessage(null);
    try {
      const nextStatus = await updateNetworkSettings(networkDraft);
      setNetworkStatus(nextStatus);
      setNetworkDraft(nextStatus.settings);
      setNetworkMessage({ tone: "success", text: "网络线路设置已保存，并已用于后续外部资料请求。" });
    } catch (error) {
      setNetworkMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "无法保存网络线路设置",
      });
    } finally {
      setNetworkSaving(false);
    }
  };
  const handleSectionNavigation = (event: MouseEvent<HTMLAnchorElement>, sectionId: SettingsSectionId) => {
    event.preventDefault();
    const section = document.getElementById(sectionId);
    if (section === null) return;

    setActiveSectionId(sectionId);
    navigationTargetRef.current = sectionId;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}#${sectionId}`,
    );
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    if (navigationUnlockTimerRef.current !== null) {
      window.clearTimeout(navigationUnlockTimerRef.current);
    }
    navigationUnlockTimerRef.current = window.setTimeout(() => {
      navigationTargetRef.current = null;
      navigationUnlockTimerRef.current = null;
      scheduleActiveSectionSyncRef.current?.();
    }, reduceMotion ? 0 : 900);
  };
  const requestedReturnTo = searchParams.get("returnTo");
  const returnTo = requestedReturnTo?.startsWith("/reader/") && !requestedReturnTo.startsWith("//")
    ? requestedReturnTo
    : null;

  return (
    <AppShell activeSection="settings" quickSearchLabel="快速检索文献" workspaceLabel="System Preferences">
      <div className="settings-page" ref={pageRef}>
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
            <span className={`settings-health${health === null ? "" : " is-ready"}`} role="status">
              <i />{health === null ? "正在连接本地服务" : `Local Service v${health.version}`}
            </span>
          </div>
        </header>

        {loadError !== null && <StatusNotice className="settings-alert" tone="danger">{loadError}</StatusNotice>}

        <div className="settings-layout">
          <ScrollArea axis="x" className="settings-section-nav" component="nav" aria-label="设置分区" ref={navigationRef}>
            <p className="settings-nav-label">设置目录</p>
            {settingsNavigation.map((item) => (
              <a
                aria-current={activeSectionId === item.id ? "location" : undefined}
                className={activeSectionId === item.id ? "is-active" : undefined}
                data-section-id={item.id}
                href={`#${item.id}`}
                key={item.id}
                onClick={(event) => handleSectionNavigation(event, item.id)}
              >
                <AppIcon icon={item.icon} size={16} />{item.label}
              </a>
            ))}
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
              <div className="settings-toggle-list">
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
              </div>
            </SettingsSection>

            <SettingsSection id="network" index="03" eyebrow="External Data Routing" title="网络线路" note={networkStatus === null ? "正在检测" : networkRouteLabel}>
              <p className="network-introduction">
                控制 English Wiktionary 外部资料请求。自动模式会检测候选代理端口，代理在线时使用代理，离线时立即改用正常直连。
              </p>
              {networkDraft !== null && (
                <div className="network-controls">
                  <PreferenceRow icon={Network} label="线路模式" description="默认自动判断；需要完全绕过代理时选择直连。">
                    <SegmentedControl<NetworkRouteMode>
                      options={["auto", "direct", "manual"]}
                      value={networkDraft.mode}
                      format={(value) => value === "auto" ? "自动" : value === "direct" ? "直连" : "手动代理"}
                      onChange={(mode) => setNetworkDraft({ ...networkDraft, mode })}
                    />
                  </PreferenceRow>
                  <div className="network-proxy-fields">
                    <Select
                      aria-label="代理协议"
                      disabled={networkDraft.mode !== "manual"}
                      size="small"
                      value={networkDraft.proxyProtocol}
                      onChange={(event) => setNetworkDraft({
                        ...networkDraft,
                        proxyProtocol: event.target.value as NetworkSettings["proxyProtocol"],
                      })}
                    >
                      <MenuItem value="http">HTTP</MenuItem>
                      <MenuItem value="https">HTTPS</MenuItem>
                    </Select>
                    <Field
                      disabled={networkDraft.mode !== "manual"}
                      label="代理主机"
                      value={networkDraft.proxyHost}
                      onChange={(event) => setNetworkDraft({ ...networkDraft, proxyHost: event.target.value })}
                    />
                    <Field
                      disabled={networkDraft.mode !== "manual"}
                      label="代理端口"
                      slotProps={{ htmlInput: { min: 1, max: 65535 } }}
                      type="number"
                      value={networkDraft.proxyPort}
                      onChange={(event) => setNetworkDraft({
                        ...networkDraft,
                        proxyPort: Number(event.target.value),
                      })}
                    />
                  </div>
                  <dl className="network-status-details">
                    <div><dt>当前实际线路</dt><dd>{networkRouteLabel}</dd></div>
                    <div><dt>代理来源</dt><dd>{networkSourceLabel}</dd></div>
                    <div><dt>候选代理</dt><dd>{networkStatus?.candidateProxyUrl ?? "无"}</dd></div>
                    <div><dt>端口状态</dt><dd>{networkStatus?.candidateProxyUrl === null ? "无需检测" : networkStatus?.proxyReachable ? "可连接" : "不可连接"}</dd></div>
                  </dl>
                  {networkStatus?.settings.mode === "manual" && !networkStatus.proxyReachable && (
                    <StatusNotice tone="warning">手动代理端口当前不可连接；保持手动模式时，外部资料请求会失败。</StatusNotice>
                  )}
                  {networkMessage !== null && <StatusNotice tone={networkMessage.tone}>{networkMessage.text}</StatusNotice>}
                  <div className="network-actions">
                    <Button disabled={networkSaving} type="button" onClick={() => void handleSaveNetwork()}>
                      {networkSaving ? "正在保存" : "保存网络设置"}
                    </Button>
                  </div>
                </div>
              )}
            </SettingsSection>

            <SettingsSection id="provider" index="04" eyebrow="Local Intelligence Bridge" title="AI Provider" note={provider?.configured ? "连接正常" : "等待配置"}>
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

            <SettingsSection id="storage" index="05" eyebrow="Offline Data & Privacy" title="本地数据" note={`SQLite schema ${health?.database.schemaVersion ?? "-"}`}>
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
      <header>
        <div><p>{index} / {eyebrow}</p><h2>{title}</h2></div>
        <span className="settings-section-note">{note}</span>
      </header>
      <div className="settings-card-content">{children}</div>
    </SurfaceCard>
  );
}

function PreferenceRow({ children, description, icon, label }: { children: React.ReactNode; description: string; icon: LucideIcon; label: string }) {
  return <div className="preference-row"><div><strong><AppIcon icon={icon} size={16} />{label}</strong><small>{description}</small></div>{children}</div>;
}

function SegmentedControl<T extends number | string>({ format, onChange, options, value }: {
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
