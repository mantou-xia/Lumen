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
import type {
  ExpressionType,
  LexicalAttribution,
  TranslationResult,
} from "@lumen/api-contract";

import { AppIcon } from "../app/AppIcon";
import { Button, ScrollArea } from "../app/ui";
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

export function getLexicalTranslationId(
  translation: Pick<TranslationResult, "expressionType" | "translationId"> | null,
): string | null {
  return translation === null || translation.expressionType === "sentence"
    ? null
    : translation.translationId;
}

function normalizeComparableText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function getSupportingExplanation(
  translation: Pick<TranslationResult, "contextualMeaning" | "contextualTranslation" | "explanation">,
): string | null {
  const explanation = translation.explanation.trim();
  if (explanation.length === 0) return null;
  const normalizedExplanation = normalizeComparableText(explanation);
  if (
    normalizedExplanation === normalizeComparableText(translation.contextualMeaning)
    || normalizedExplanation === normalizeComparableText(translation.contextualTranslation)
  ) {
    return null;
  }
  return explanation;
}

function expressionTypeLabel(expressionType: ExpressionType): string {
  return {
    word: "word",
    phrase: "phrase",
    collocation: "collocation",
    sentence: "sentence",
  }[expressionType];
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
  const lexical = useLexicalProfile(getLexicalTranslationId(props.translation));
  const { lensRef, style } = useAnchoredOverlayPosition(props.anchor);
  const setRefs = useCallback((element: HTMLElement | null) => {
    lensRef.current = element;
    props.overlayRef.current = element;
  }, [lensRef, props.overlayRef]);
  const selectedText = props.translation?.selection.selectedText ?? props.activeSelectionText;
  const isSentence = props.translation?.expressionType === "sentence";
  const supportingExplanation = props.translation === null
    ? null
    : getSupportingExplanation(props.translation);
  const lexicalProfile = lexical.response?.status === "ready" ? lexical.response.profile : null;
  const pronunciation = lexicalProfile?.pronunciations.map((item) => item.value).join(" · ") ?? "";
  const sourceLabel = lexicalProfile === null
    ? "AI 语境翻译"
    : "AI 语境翻译 · English Wiktionary";

  return (
    <aside
      className={`translation-lens translation-lens--result${isSentence ? " translation-lens--sentence" : ""}`}
      ref={setRefs}
      data-reader-overlay
      tabIndex={-1}
      aria-live="polite"
      aria-label="AI 语境翻译"
      style={style}
    >
      {selectedText !== null && (
        <header className="translation-heading">
          <div className="translation-title-row">
            <h2>{selectedText}</h2>
            {pronunciation.length > 0 && <span className="translation-phonetic">{pronunciation}</span>}
            {props.translation !== null && (
              <span className="translation-type">{expressionTypeLabel(props.translation.expressionType)}</span>
            )}
          </div>
        </header>
      )}
      <ScrollArea axis="y" className="translation-lens-body">
        {props.status === "loading" && props.translation === null && (
          <div className="translation-loading">
            <span />
            <p>正在结合当前语境理解…</p>
            <span />
          </div>
        )}
        {props.status === "error" && <p className="lens-error">{props.error}</p>}
        {props.translation !== null && (
          <>
            <section className="translation-summary">
              <strong>{props.translation.contextualTranslation}</strong>
              <p>{props.translation.contextualMeaning}</p>
            </section>
            {supportingExplanation !== null && (
              <section className="translation-insight">
                <strong>{isSentence ? "理解要点" : "在本句中"}</strong>
                <p>{supportingExplanation}</p>
              </section>
            )}
            {props.translation.uncertainty.trim().length > 0 && (
              <section className="translation-uncertainty">
                <strong><AppIcon icon={CircleHelp} size={14} />不确定性</strong>
                <p>{props.translation.uncertainty}</p>
              </section>
            )}
            {!isSentence && <LexicalProfilePanel lexical={lexical} />}
          </>
        )}
      </ScrollArea>
      {props.translation !== null && (
        <div className="translation-actions">
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
            {props.saveState === "idle" && "收藏表达"}
          </Button>
          <Button
            className="translation-reference"
            type="button"
            variant="secondary"
            aria-label="引用到 Workspace"
            onClick={props.onReferenceWorkspace}
          ><AppIcon icon={Quote} size={15} />引用</Button>
          <Button
            className="translation-retry"
            type="button"
            variant="secondary"
            aria-label={props.status === "loading" ? "正在重新翻译" : "重新翻译"}
            title={props.status === "loading" ? "正在重新翻译" : "重新翻译"}
            disabled={props.status === "loading"}
            onClick={props.onRetry}
          >
            <AppIcon className={props.status === "loading" ? "is-spinning" : undefined} icon={props.status === "loading" ? LoaderCircle : RotateCw} size={15} />
          </Button>
        </div>
      )}
    </aside>
  );
}

function LexicalAttributionFooter({ attribution }: { attribution: LexicalAttribution }) {
  return (
    <footer className="lexical-attribution">
      <span>词汇事实来源：</span>
      <a href={attribution.sourceUrl} target="_blank" rel="noreferrer">
        {attribution.sourceName}<AppIcon icon={ExternalLink} size={11} />
      </a>
      <span> · </span>
      <a href={attribution.licenseUrl} target="_blank" rel="noreferrer">
        {attribution.licenseName}<AppIcon icon={ExternalLink} size={11} />
      </a>
    </footer>
  );
}

function LexicalProfileHeader({
  isLoading,
  onRefresh,
}: {
  isLoading: boolean;
  onRefresh(): void;
}) {
  return (
    <header>
      <strong><AppIcon icon={BookA} size={14} />词汇补充</strong>
      <Button
        type="button"
        variant="secondary"
        aria-label={isLoading ? "正在更新词汇资料" : "更新词汇资料"}
        title={isLoading ? "正在更新词汇资料" : "更新词汇资料"}
        disabled={isLoading}
        onClick={onRefresh}
      >
        <AppIcon className={isLoading ? "is-spinning" : undefined} icon={isLoading ? LoaderCircle : RefreshCw} size={14} />
      </Button>
    </header>
  );
}

function LexicalRetry({ onRefresh }: { onRefresh(): void }) {
  return (
    <Button type="button" variant="secondary" onClick={onRefresh}>
      <AppIcon icon={RefreshCw} size={14} />重新获取
    </Button>
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
        <strong><AppIcon icon={BookA} size={14} />词汇补充</strong>
        <div className="translation-loading"><span /><p>正在加载 English Wiktionary 资料…</p></div>
      </section>
    );
  }
  if (lexical.status === "error") {
    return (
      <section className="lexical-profile lexical-profile--status">
        <strong><AppIcon icon={BookA} size={14} />词汇补充</strong>
        <p>{lexical.error}</p>
        <LexicalRetry onRefresh={lexical.refresh} />
      </section>
    );
  }
  const response = lexical.response;
  if (response === null) return null;
  if (response.status !== "ready" || response.profile === null) {
    return (
      <section className="lexical-profile lexical-profile--status">
        <strong><AppIcon icon={BookA} size={14} />词汇补充</strong>
        <p>{response.message ?? "当前没有可用的稳定词汇资料。"}</p>
        <LexicalRetry onRefresh={lexical.refresh} />
        <LexicalAttributionFooter attribution={response.attribution} />
      </section>
    );
  }

  const localizedSenses = response.localization?.senses ?? [];
  const firstPart = response.profile.partsOfSpeech.find((part) => part.senses.length > 0);
  const firstSense = firstPart?.senses[0];
  const firstLocalizedSense = firstSense === undefined
    ? undefined
    : localizedSenses.find((item) => item.sourceGloss === firstSense.gloss);
  return (
    <section className="lexical-profile">
      <LexicalProfileHeader
        isLoading={lexical.status === "loading"}
        onRefresh={lexical.refresh}
      />
      {response.message !== null && <p className="lexical-message">{response.message}</p>}
      {firstPart !== undefined && firstSense !== undefined && (
        <div className="lexical-quick">
          <b>常见含义</b>
          <span>
            <strong>{response.profile.lemma}</strong>
            {` · ${firstPart.partOfSpeech} · ${firstLocalizedSense?.chineseGloss ?? firstSense.gloss}`}
          </span>
        </div>
      )}
      <div className="lexical-details" aria-label="更多词义与构词">
        <strong className="lexical-details-title">更多词义与构词</strong>
        <div className="lexical-content">
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
          <LexicalAttributionFooter attribution={response.attribution} />
        </div>
      </div>
    </section>
  );
}
