import {
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import {
  BookA,
  BookmarkCheck,
  BookmarkPlus,
  CircleHelp,
  ExternalLink,
  GitBranch,
  LoaderCircle,
  Quote,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import type { TranslationResult } from "@lumen/api-contract";

import { AppIcon } from "../app/AppIcon";
import { Button } from "../app/ui";
import type { RendererBounds } from "../document-renderers/renderer-contract";
import { useLexicalProfile } from "./useLexicalProfile";

export interface TranslationAnchor {
  bounds: RendererBounds;
  scrollX: number;
  scrollY: number;
}

interface TranslationLensProps {
  activeSelectionText: string | null;
  anchor: TranslationAnchor | null;
  error: string | null;
  overlayRef: MutableRefObject<HTMLElement | null>;
  saveState: "idle" | "saving" | "saved" | "error";
  status: "idle" | "loading" | "error";
  translation: TranslationResult | null;
  onRetry(): void;
  onReferenceWorkspace(): void;
  onSave(): void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function calculateLensPosition(input: {
  anchor: TranslationAnchor | null;
  elementWidth: number;
  elementHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
}): { top: number; left: number } {
  const margin = 14;
  const gap = 10;
  if (input.anchor === null) {
    return {
      top: clamp(120, margin, input.viewportHeight - input.elementHeight - margin),
      left: clamp(
        (input.viewportWidth - input.elementWidth) / 2,
        margin,
        input.viewportWidth - input.elementWidth - margin,
      ),
    };
  }
  const horizontalScroll = input.scrollX - input.anchor.scrollX;
  const verticalScroll = input.scrollY - input.anchor.scrollY;
  const bounds = {
    top: input.anchor.bounds.top - verticalScroll,
    bottom: input.anchor.bounds.bottom - verticalScroll,
    left: input.anchor.bounds.left - horizontalScroll,
  };
  const spaceBelow = input.viewportHeight - input.anchor.bounds.bottom - gap - margin;
  const spaceAbove = input.anchor.bounds.top - gap - margin;
  const placeBelow = spaceBelow >= input.elementHeight || spaceBelow >= spaceAbove;
  const desiredTop = placeBelow
    ? bounds.bottom + gap
    : bounds.top - input.elementHeight - gap;
  const initialLeft = clamp(
    input.anchor.bounds.left,
    margin,
    input.viewportWidth - input.elementWidth - margin,
  );
  return {
    top: desiredTop,
    left: initialLeft - horizontalScroll,
  };
}

export function useAnchoredOverlayPosition(anchor: TranslationAnchor | null) {
  const lensRef = useRef<HTMLElement | null>(null);
  const style: CSSProperties = { top: 0, left: 0 };

  useLayoutEffect(() => {
    const update = () => {
      const element = lensRef.current;
      if (element === null) return;
      const position = calculateLensPosition({
        anchor,
        elementWidth: element.offsetWidth,
        elementHeight: element.offsetHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      });
      element.style.transform = `translate3d(${position.left}px, ${position.top}px, 0)`;
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (lensRef.current !== null) observer?.observe(lensRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor]);

  return { lensRef, style };
}

export function TranslationLens(props: TranslationLensProps) {
  const lexical = useLexicalProfile(props.translation?.translationId ?? null);
  const { lensRef, style } = useAnchoredOverlayPosition(props.anchor);
  const setRefs = useCallback((element: HTMLElement | null) => {
    lensRef.current = element;
    props.overlayRef.current = element;
  }, [lensRef, props.overlayRef]);
  const selectedText = props.translation?.selection.selectedText ?? props.activeSelectionText;

  return (
    <aside
      className="translation-lens"
      ref={setRefs}
      data-reader-overlay
      tabIndex={-1}
      aria-live="polite"
      style={style}
    >
      {selectedText !== null && (
        <div className="translation-heading">
          <div>
            <h2>{selectedText}</h2>
            {props.translation !== null && <span>{props.translation.expressionType}</span>}
          </div>
        </div>
      )}
      {props.status === "loading" && props.translation === null && (
        <div className="translation-loading">
          <span />
          <p>正在结合当前语境理解…</p>
          <span />
          <p>词汇资料将在语境翻译完成后独立加载…</p>
        </div>
      )}
      {props.status === "error" && <p className="lens-error">{props.error}</p>}
      {props.translation !== null && (
        <>
          <section className="contextual-result">
            <p className="translation-primary">{props.translation.contextualTranslation}</p>
          </section>
          <section>
            <strong>含义说明</strong>
            <p>{props.translation.contextualMeaning}</p>
            {props.translation.explanation.length > 0 && <p>{props.translation.explanation}</p>}
          </section>
          {props.translation.uncertainty.length > 0 && (
            <section><strong><AppIcon icon={CircleHelp} size={15} />不确定性</strong><p>{props.translation.uncertainty}</p></section>
          )}
          <LexicalProfilePanel lexical={lexical} />
          <div className="translation-actions">
            <Button
              className="translation-retry"
              type="button"
              variant="secondary"
              disabled={props.status === "loading"}
              onClick={props.onRetry}
            >
              <AppIcon className={props.status === "loading" ? "is-spinning" : undefined} icon={props.status === "loading" ? LoaderCircle : RotateCw} size={15} />
              {props.status === "loading" ? "正在重新翻译…" : "重新翻译"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={props.onReferenceWorkspace}
            ><AppIcon icon={Quote} size={15} />引用到 Workspace</Button>
            <Button
              className="save-expression"
              type="button"
              aria-label={props.saveState === "saved" ? "已收藏" : "收藏表达"}
              disabled={props.saveState === "saving" || props.saveState === "saved"}
              onClick={props.onSave}
            >
              <AppIcon
                className={props.saveState === "saving" ? "is-spinning" : undefined}
                icon={props.saveState === "saving" ? LoaderCircle : props.saveState === "saved" ? BookmarkCheck : BookmarkPlus}
                size={16}
              />
              {props.saveState === "saving" && "正在收藏…"}
              {props.saveState === "saved" && "已收藏"}
              {props.saveState === "error" && "收藏失败，重试"}
              {props.saveState === "idle" && "收藏这个表达"}
            </Button>
          </div>
        </>
      )}
    </aside>
  );
}

function LexicalProfilePanel({
  lexical,
}: {
  lexical: ReturnType<typeof useLexicalProfile>;
}) {
  if (lexical.status === "loading" && lexical.response === null) {
    return (
      <section className="lexical-profile lexical-profile--loading">
        <strong><AppIcon icon={BookA} size={15} />稳定词汇资料</strong>
        <div className="translation-loading"><span /><p>正在独立加载 English Wiktionary 资料…</p></div>
      </section>
    );
  }
  if (lexical.status === "error") {
    return (
      <section className="lexical-profile">
        <strong><AppIcon icon={BookA} size={15} />稳定词汇资料</strong>
        <p>{lexical.error}</p>
        <Button type="button" variant="secondary" onClick={lexical.refresh}><AppIcon icon={RefreshCw} size={14} />重新获取</Button>
      </section>
    );
  }
  const response = lexical.response;
  if (response === null) return null;
  if (response.status !== "ready" || response.profile === null) {
    return (
      <section className="lexical-profile">
        <strong><AppIcon icon={BookA} size={15} />稳定词汇资料</strong>
        <p>{response.message}</p>
        <Button type="button" variant="secondary" onClick={lexical.refresh}><AppIcon icon={RefreshCw} size={14} />重新获取</Button>
      </section>
    );
  }

  const localizedSenses = response.localization?.senses ?? [];
  return (
    <section className="lexical-profile">
      <header>
        <div>
          <strong><AppIcon icon={BookA} size={15} />常见含义 · {response.profile.lemma}</strong>
          {response.profile.pronunciations.length > 0 && (
            <small>{response.profile.pronunciations.map((item) => item.value).join(" · ")}</small>
          )}
        </div>
        <Button type="button" variant="secondary" disabled={lexical.status === "loading"} onClick={lexical.refresh}>
          <AppIcon className={lexical.status === "loading" ? "is-spinning" : undefined} icon={lexical.status === "loading" ? LoaderCircle : RefreshCw} size={14} />
          {lexical.status === "loading" ? "更新中…" : "更新资料"}
        </Button>
      </header>
      {response.message !== null && <p className="lexical-message">{response.message}</p>}
      {response.profile.partsOfSpeech.map((part) => (
        <div className="lexical-part" key={part.partOfSpeech}>
          <b>{part.partOfSpeech}</b>
          <ol>
            {part.senses.map((sense, index) => {
              const localized = localizedSenses.find((item) => item.sourceGloss === sense.gloss);
              return (
                <li key={`${part.partOfSpeech}:${index}`}>
                  <span>{localized?.chineseGloss ?? sense.gloss}</span>
                  {localized !== undefined && <small>{sense.gloss}</small>}
                  {localized?.usageNote && <small>使用：{localized.usageNote}</small>}
                  {sense.usageLabels.length > 0 && <em>{sense.usageLabels.join(" · ")}</em>}
                  {sense.examples.map((example) => <small key={example}>例：{example}</small>)}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      {(response.localization?.etymologySummary || response.profile.etymology) && (
        <div className="lexical-extra">
          <b><AppIcon icon={GitBranch} size={14} />构词</b>
          <p>{response.localization?.etymologySummary || response.profile.etymology}</p>
        </div>
      )}
      {(response.profile.derivedTerms.length > 0 || response.profile.relatedTerms.length > 0) && (
        <div className="lexical-extra">
          <b><AppIcon icon={GitBranch} size={14} />词族</b>
          <p>{[...response.profile.derivedTerms, ...response.profile.relatedTerms].join(" · ")}</p>
        </div>
      )}
      <footer>
        <a href={response.attribution.sourceUrl} target="_blank" rel="noreferrer">
          {response.attribution.sourceName}<AppIcon icon={ExternalLink} size={11} />
        </a>
        <span> · </span>
        <a href={response.attribution.licenseUrl} target="_blank" rel="noreferrer">
          {response.attribution.licenseName}<AppIcon icon={ExternalLink} size={11} />
        </a>
      </footer>
    </section>
  );
}
