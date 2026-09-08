import { type ReactNode, useEffect, useState } from "react";
import {
  Languages,
  Laptop,
  LibraryBig,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
} from "lucide-react";
import { Link } from "react-router";

import lumenWordmarkUrl from "../../../../assets/logo/文字logo.png";
import { waitForHealth } from "../api/health";
import { AppIcon } from "./AppIcon";
import "../library/library.css";

type AppSection = "library" | "learning" | "settings";

export function AppShell({
  activeSection,
  children,
  quickSearchLabel,
  onQuickSearch,
  workspaceLabel,
}: {
  activeSection: AppSection;
  children: ReactNode;
  quickSearchLabel: string;
  onQuickSearch?: () => void;
  workspaceLabel: string;
}) {
  const [serviceStatus, setServiceStatus] = useState<"loading" | "ready" | "error">("loading");
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem("lumen.sidebar.collapsed") === "true",
  );

  useEffect(() => {
    const controller = new AbortController();
    void waitForHealth((input, init) => fetch(input, { ...init, signal: controller.signal }))
      .then(() => setServiceStatus("ready"))
      .catch(() => {
        if (!controller.signal.aborted) setServiceStatus("error");
      });
    return () => controller.abort();
  }, []);

  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("lumen.sidebar.collapsed", String(next));
      return next;
    });
  };

  return (
    <main className={`library-workspace${collapsed ? " library-workspace--collapsed" : ""}`}>
      <aside className="library-sidebar" aria-label="应用导航">
        <Link className="library-brand" to="/" aria-label="Lumen 文档库">
          <img src={lumenWordmarkUrl} alt="Lumen" />
          <small>本地阅读</small>
        </Link>
        <nav className="library-navigation">
          <Link className={`library-navigation-item${activeSection === "library" ? " is-active" : ""}`} to="/">
            <AppIcon className="nav-icon" icon={LibraryBig} /><span>文档库</span>
          </Link>
          <Link className={`library-navigation-item${activeSection === "learning" ? " is-active" : ""}`} to="/learning">
            <AppIcon className="nav-icon" icon={Languages} /><span>表达收藏</span>
          </Link>
        </nav>
        <div className="library-sidebar-footer">
          <Link className={`library-navigation-item${activeSection === "settings" ? " is-active" : ""}`} to="/settings">
            <AppIcon className="nav-icon" icon={Settings2} /><span>设置</span>
          </Link>
          <button
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            className="library-navigation-item library-sidebar-toggle"
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            type="button"
            onClick={toggleSidebar}
          >
            <AppIcon className="nav-icon" icon={collapsed ? PanelLeftOpen : PanelLeftClose} />
            <span>{collapsed ? "展开侧边栏" : "收起侧边栏"}</span>
          </button>
          <div className="library-local-profile">
            <span className="library-avatar"><AppIcon icon={Laptop} size={17} /></span>
            <span className="library-profile-copy">
              <strong>本地工作区</strong>
              <small className={`library-service library-service--${serviceStatus}`}>
                <i />{serviceStatus === "loading" ? "正在连接本地服务" : serviceStatus === "ready" ? "本地服务就绪" : "本地服务不可用"}
              </small>
            </span>
          </div>
        </div>
      </aside>
      <section className="library-main">
        <header className="library-workspace-bar">
          <p><span>Lumen Workspace</span><i>/</i>{workspaceLabel}</p>
          <button type="button" disabled={onQuickSearch === undefined} onClick={onQuickSearch}>
            <AppIcon icon={Search} size={16} /><span>{quickSearchLabel}</span><kbd>⌘ K</kbd>
          </button>
        </header>
        {children}
      </section>
    </main>
  );
}
