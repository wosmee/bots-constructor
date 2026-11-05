import { createPortal } from 'react-dom';
import { nextPopoverState } from './journey';
import {
  Fragment,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  ViewportPortal,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeTypes,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import { Scenario, Block, BlockType, BlockParams, emptyScenario, usesBranches } from '../../shared/types';
import { validateScenario, countIssues } from '../../shared/validate';
import { blockSupportedOn, type Platform } from '../../shared/platform';
import { selectionIo } from '../../shared/subflow';
import { decideDraft, shouldFlushDraft } from './drafts';
import {
  BLOCK_META,
  PALETTE_GROUPS,
  WHAT_IF,
  defaultBlock,
  summary,
  nodeLabel,
  nextOpenGroups,
  parseOpenGroups,
  matchPalette,
  normalizeSearch,
  visiblePaletteGroups,
  DEFAULT_OPEN_GROUPS,
  type PaletteGroupId,
} from './blocks';
import { api, type Collection } from './api';
import { Inspector } from './Inspector';
import { PublishModal } from './Publish';
import { SettingsModal } from './SettingsModal';
import { updateSettings, useSettings, useSettingsLoaded } from './settings';
import { useT } from './i18n';
// Стили холста (@xyflow) грузятся вместе с ленивым чанком конструктора:
// на логине и дашборде они не нужны. Порядок важен: сначала база react-flow,
// затем наши переопределения (flow.css) — они вставляются позже и побеждают
// при равной специфичности. Дизайн-система (styles.css) остаётся в entry.
import '@xyflow/react/dist/style.css';
import './flow.css';
import ErrorBoundary from './ErrorBoundary';
import { errorToMessage } from './boundaryCore';
import { friendlyApiError, isVersionConflict, versionConflictCurrent } from './journey';
import { analyzeConflicts, groupConflicts, branchFrom, conflictLevel } from './conflicts';
import { explainBranch } from './explain';
import { CanvasHintsContext, useCanvasHints, type CanvasHints } from './canvasContext';
import {
  graphToScenario,
  structuralHash,
  autoLayout,
  copySubgraph,
  duplicateWithLinks,
  createGroupAround,
  membersAfterDrag,
  collapseRect,
  sanitizeGroups,
  copiedGroups,
  copyIdMap,
  nodesWithCollapsedHidden,
  newGroupId,
  GROUP_COLORS,
  GROUP_MIN_W,
  GROUP_MIN_H,
  type NodeData,
  type CopiedSubgraph,
  type CanvasGroup,
  type CanvasScenario,
} from './graph';
import './canvasGroups.css';
import './subflow.css';
import { portsForNode, handleIdFor, parseHandleId } from './ports';
import { PreviewServer } from './preview';
import { SearchPanel } from './SearchPanel';
import { VarsPanel } from './VarsPanel';
import { LogsModal } from './LogsModal';
import { VersionsModal } from './VersionsModal';
import { useModalA11y } from './useModalA11y';
import { OnboardingTour } from './OnboardingTour';
import {
  TOPBAR_TRIGGER_HEIGHT,
  ensureTopbarMode,
  getTopbarMode,
  subscribeTopbarMode,
  topbarExpanded,
  topbarToggleVisible,
} from './topbar';
import {
  TOPBAR_ACTIONS,
  editorOverflowActions,
  primaryActions,
  type TopbarActionId,
} from './topbarActions';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart,
  BookOpen,
  Braces,
  ChevronDown,
  ChevronRight,
  Compass,
  CornerDownRight,
  Database,
  FolderTree,
  HelpCircle,
  History,
  Keyboard,
  LayoutTemplate,
  MoreHorizontal,
  Play,
  Rocket,
  Save,
  Search,
  Settings,
  Snowflake,
  Trash,
  Undo,
  Redo,
  X,
} from './icons';
import { ExitHost } from './Surface';

// Тяжёлые и редко нужные модули грузим отдельными чанками: каталог готовых
// сценариев и гайды не должны лежать в стартовом бандле.
const TemplatesModal = lazy(() => import('./TemplatesModal'));
const Guide = lazy(() => import('./Guide').then((m) => ({ default: m.Guide })));

// Какие группы палитры раскрыты — состояние окна, а не пользовательская
// настройка: оно не синхронизируется между устройствами и живёт в localStorage.
const PALETTE_OPEN_KEY = 'palette.openGroups';

interface LocalNodeData extends NodeData {}

function BotNode({ data, id }: NodeProps) {
  const block = (data as LocalNodeData).block;
  const meta = BLOCK_META[block.type];
  const hints = useCanvasHints();
  // Неизвестный тип блока (сценарий из будущей версии / битый JSON) — узел не
  // рисуем, но и весь холст не роняем (WU-01). Гард после хуков: порядок их
  // вызова обязан оставаться стабильным.
  if (!meta) return null;
  const off = !!block.params.disabled;
  const problems = hints.conflicts.get(id) ?? [];
  // Warn-конфликты (страховочная ветка не нарисована) подсвечиваются мягче:
  // сценарий работоспособен, это напоминание, а не ошибка.
  const hasError = problems.some((c) => conflictLevel(c) === 'error');
  const dimmed = !!hints.sleepActive && !hints.sleepActive.has(id);
  const ports = portsForNode(block, hints.lang);
  const connectFrom = hints.connectFrom ?? null;
  // Блок-источник в режиме соединения: с него тянут, целью он быть не может.
  const isSource = connectFrom?.nodeId === id;
  const isTargetCandidate = !!connectFrom && !isSource;
  // Подсценарий: статус вызова (устарел/потерян/цикл) — из subflow-check.
  const sf = block.type === 'subflow' ? hints.sfStatus?.get(id) : undefined;

  const cls = ['node'];
  if (off) cls.push('frozen');
  if (hasError) cls.push('has-conflict');
  else if (problems.length) cls.push('has-conflict-warn');
  if (dimmed) cls.push('sleeping');
  if (isSource) cls.push('linking');
  if (isTargetCandidate) cls.push('link-target');
  // Вызов подсценария рисуется «дверью»: акцентированная рамка с двойным
  // контуром — узел читается как вход во фрагмент, а не как обычный шаг.
  if (block.type === 'subflow') cls.push('subflow-node');
  if (block.type === 'subflow_return') cls.push('subflow-return-node');

  return (
    <div
      className={cls.join(' ')}
      style={{ borderColor: problems.length ? undefined : meta.color }}
      title={problems.length ? hints.conflictText.get(id) : undefined}
      /* Клик по конфликтному узлу открывает список проблем блока. Событие не
         гасим: выделение узла и pan холста — работа react-flow, ломать её нельзя.
         В режиме соединения приоритет у выбора цели, поэтому конфликт молчит. */
      onClick={problems.length && !isTargetCandidate ? () => hints.onConflictClick?.(id) : undefined}
      onDoubleClick={(e) => {
        e.stopPropagation();
        hints.onNodeDoubleClick?.(id);
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-title" style={{ background: meta.color }}>
        {meta.label}
        {/* Бейдж ревизии фрагмента: закреплённая или «актуальная» (rev из библиотеки). */}
        {block.type === 'subflow' && block.params.subflowRevision != null && (
          <span className="node-badge badge" title={hints.sfLabels?.outdated}>
            rev {String(block.params.subflowRevision)}
          </span>
        )}
        {sf && sf.status !== 'ok' && (
          <span className={`node-badge badge ${sf.status === 'outdated' ? 'warn' : 'danger'}`}>
            {sf.status === 'outdated'
              ? hints.sfLabels?.outdated ?? '!'
              : sf.status === 'missing' || sf.status === 'revision-missing'
              ? hints.sfLabels?.missing ?? '?'
              : hints.sfLabels?.cycle ?? '∞'}
          </span>
        )}
        {off && (
          <span className="node-badge" title={hints.tFrozen}>
            <Snowflake size={11} />
          </span>
        )}
        {problems.length > 0 && (
          <span className={`node-conflict${hasError ? '' : ' warn'}`} title={hints.conflictText.get(id)}>
            <AlertTriangle size={11} />
          </span>
        )}
      </div>
      <div className="node-body">{summary(block) || ' '}</div>
      {/* Одна исходящая ветка — один порт. Подпись берётся из самой ветки
          (имя кнопки, «да»/«нет»), поэтому связь видно на холсте. */}
      {ports.map((p) => (
        <div className={`node-port${p.kind === 'next' ? ' node-port-next' : ''}`} key={p.id} title={hints.connectTargetHint}>
          {/* Узлы рендерятся вне дерева переводов: сюда строки приходят через
              подсказки холста (canvasContext), поэтому запасная подпись порта —
              просто стрелка, а не t(...). */}
          <span className="node-port-label">{p.label || '→'}</span>
          <Handle
            id={p.id}
            type="source"
            position={Position.Right}
            onClick={(e) => {
              e.stopPropagation();
              hints.onPortClick?.(id, p.id);
            }}
          />
        </div>
      ))}
    </div>
  );
}
const nodeTypes: NodeTypes = { bot: BotNode };

// ---------------------------------------------------------------- группы холста

// Подписи группы: компонент модульный, переводы приходят строками (как
// canvasContext у BotNode — узлы живут вне дерева useT).
export interface CanvasGroupLabels {
  defaultTitle: string;
  panelAria: string;
  colorTitle: string;
  collapseTitle: string;
  expandTitle: string;
  deleteTitle: string;
  moveTitle: string;
  resizeTitle: string;
  renameTitle: string;
  renamePlaceholder: string;
}

// Визуальная группа блоков: рамка в координатах flow внутри ViewportPortal,
// рисуется ПОД узлами (z-index: -1 в стековом контексте viewport). Интерактив —
// заголовок (drag/переименование), мини-панель (цвет/свернуть/удалить) и уголок
// resize. Тело рамки клики пропускает к холсту.
function CanvasGroupView({
  group,
  selected,
  labels,
  countLabel,
  onClick,
  onRename,
  onColor,
  onToggleCollapse,
  onDelete,
  onHeaderPointerDown,
  onResizePointerDown,
}: {
  group: CanvasGroup;
  selected: boolean;
  labels: CanvasGroupLabels;
  countLabel: (n: number) => string;
  onClick: (g: CanvasGroup) => void;
  onRename: (id: string, title: string) => void;
  onColor: (id: string, color: string) => void;
  onToggleCollapse: (g: CanvasGroup) => void;
  onDelete: (id: string) => void;
  onHeaderPointerDown: (e: React.PointerEvent, g: CanvasGroup) => void;
  onResizePointerDown: (e: React.PointerEvent, g: CanvasGroup) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const rect = group.collapsed
    ? collapseRect(group)
    : { x: group.x, y: group.y, w: group.w, h: group.h };
  const title = group.title || labels.defaultTitle;

  const commit = () => {
    setEditing(false);
    const v = draftTitle.trim();
    if (v !== group.title) onRename(group.id, v);
  };

  return (
    <div
      className={`canvas-group${group.collapsed ? ' collapsed' : ''}${selected ? ' selected' : ''}`}
      style={{
        transform: `translate(${rect.x}px, ${rect.y}px)`,
        width: rect.w,
        height: rect.h,
        borderColor: group.color,
        background: `${group.color}1f`,
      }}
      role="group"
      aria-label={title}
      title={group.collapsed ? labels.expandTitle : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onClick(group);
      }}
    >
      <div
        className="canvas-group-header nopan"
        title={labels.moveTitle}
        onPointerDown={(e) => onHeaderPointerDown(e, group)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (group.collapsed) return;
          setDraftTitle(group.title);
          setEditing(true);
        }}
      >
        <FolderTree size={13} />
        {editing ? (
          <input
            className="canvas-group-input nodrag nopan nokey"
            autoFocus
            value={draftTitle}
            placeholder={labels.renamePlaceholder}
            aria-label={labels.renameTitle}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={commit}
          />
        ) : (
          <span className="canvas-group-title">{title}</span>
        )}
        {group.collapsed && (
          <span className="canvas-group-count muted">{countLabel(group.members.length)}</span>
        )}
      </div>
      {selected && !group.collapsed && (
        <div
          className="canvas-group-tools nopan"
          role="toolbar"
          aria-label={labels.panelAria}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              className={`canvas-group-swatch${group.color === c ? ' active' : ''}`}
              style={{ background: c }}
              title={labels.colorTitle}
              aria-label={labels.colorTitle}
              onClick={() => onColor(group.id, c)}
            />
          ))}
          <button
            className="ghost icon-btn"
            title={labels.collapseTitle}
            aria-label={labels.collapseTitle}
            onClick={() => onToggleCollapse(group)}
          >
            <ChevronDown size={13} />
          </button>
          <button
            className="ghost icon-btn"
            title={labels.deleteTitle}
            aria-label={labels.deleteTitle}
            onClick={() => onDelete(group.id)}
          >
            <Trash size={13} />
          </button>
        </div>
      )}
      {selected && !group.collapsed && (
        <div
          className="canvas-group-resize nopan"
          title={labels.resizeTitle}
          onPointerDown={(e) => onResizePointerDown(e, group)}
        />
      )}
    </div>
  );
}

function scenarioToGraph(sc: Scenario): { nodes: Node[]; edges: Edge[] } {
  const entries = Object.values(sc.blocks);
  const nodes: Node[] = entries.map((b, i) => ({
    id: b.id,
    type: 'bot',
    position: b.position ?? { x: 80 + (i % 4) * 260, y: 80 + Math.floor(i / 4) * 160 },
    data: { block: b },
  }));
  const edges: Edge[] = [];
  for (const b of entries) {
    if (b.next)
      edges.push({
        id: `e-${b.id}-next`,
        source: b.id,
        target: b.next,
        sourceHandle: 'next',
        markerEnd: { type: MarkerType.ArrowClosed },
      });
    if (b.branches) {
      for (const [k, t] of Object.entries(b.branches)) {
        if (t)
          edges.push({
            id: `e-${b.id}-${k}`,
            source: b.id,
            target: t,
            sourceHandle: handleIdFor('branch', k),
            label: k,
            animated: true,
            style: { stroke: '#f59e0b' },
            markerEnd: { type: MarkerType.ArrowClosed },
          });
      }
    }
  }
  return { nodes, edges };
}

type CtxMenu = { nodeId: string; x: number; y: number } | null;

// Снимок истории правок: узлы, связи и визуальные группы. Группы добавлены
// в Промпт 2 (TASK 9): каждое групповое действие — один шаг undo/redo.
type HistorySnap = { nodes: Node[]; edges: Edge[]; groups: CanvasGroup[] };

function ConstructorInner({
  botId,
  name,
  platform = 'telegram',
  onBack,
  onOpenCatalog,
  onOpenData,
  onOpenPayments,
}: {
  botId: string;
  name: string;
  // Платформа бота: палитра скрывает Telegram-only блоки у VK-бота
  // (матрица в shared/platform.ts), валидация выдаёт platform-unsupported.
  platform?: 'telegram' | 'vk';
  onBack: () => void;
  onOpenCatalog?: (scenarioJson: string) => void;
  // Вкладка «Данные»: клиенты бота и его таблицы. Живёт отдельной страницей,
  // но открывается отсюда — автору не нужно возвращаться в список ботов.
  onOpenData?: () => void;
  // Вкладка «Оплата»: подключения платёжного провайдера.
  onOpenPayments?: () => void;
}) {
  const settings = useSettings();
  const settingsLoaded = useSettingsLoaded();
  const t = useT();
  // Уровень ещё не выбран (например, вход по admin-ключу) — считаем средним.
  const level = settings.skill_level || 'medium';
  const isPro = level === 'high';

  // Склонение числа блоков в заголовке группы: 1 блок / 3 блока / 5 блоков.
  const groupCount = (n: number) => {
    if (settings.language === 'en') return t('palette.groupCount', { n });
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return t('palette.groupCount1', { n });
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t('palette.groupCount2', { n });
    return t('palette.groupCount', { n });
  };

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  // Кнопка «Повторить» в статусной строке показывается, когда status всё ещё
  // равен этому тексту (S3-09): раньше её видимость решала эвристика по
  // подстрокам «не удалось/failed» — она зависела от языка и ломалась от
  // любой переформулировки. Любой другой статус прячет кнопку автоматически.
  const [saveErrorStatus, setSaveErrorStatus] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [stats, setStats] = useState<any>(null);
  // Esc + фокус-треп инлайн-модалок (WU-05/UX-02). Хуки зовутся безусловно,
  // но слушатели живут только пока узел окна в DOM (узел монтируется по условию).
  const statsModalRef = useModalA11y<HTMLDivElement>(() => setStats(null));
  const sfExtractModalRef = useModalA11y<HTMLDivElement>(() => setSfExtract(null));
  const sfPreviewModalRef = useModalA11y<HTMLDivElement>(() => setSfPreview(null));
  const shortcutsModalRef = useModalA11y<HTMLDivElement>(() => setShowShortcuts(false));
  const [statsLoading, setStatsLoading] = useState(false);
  // Таблицы бота (коллекции) — нужны инспектору блока «Данные», чтобы
  // выбирать, куда писать. Грузим один раз на открытие конструктора.
  const [collections, setCollections] = useState<Collection[]>([]);
  const [ctx, setCtx] = useState<CtxMenu>(null);
  const [customStart, setCustomStart] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  // F10: раскрытие верхней панели. На десктопе — наведение, на тач-устройстве —
  // тап. Оба триггера держат один и тот же компонент, отдельной реализации нет.
  const [barOpen, setBarOpen] = useState(false);
  // Режим панели живёт в localStorage (состояние устройства, не аккаунта) и
  // читается через внешний стор: его же меняет SettingsModal, и редактор должен
  // увидеть это сразу, без перезагрузки.
  const barMode = useSyncExternalStore(subscribeTopbarMode, getTopbarMode, getTopbarMode);
  // Пока курсор в широкой зоне у верхней кромки окна — панель выезжает.
  const [nearTop, setNearTop] = useState(false);
  const [showBarMore, setShowBarMore] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const [explain, setExplain] = useState<{ blockId: string; x: number; y: number } | null>(null);
  const [whatIf, setWhatIf] = useState<string | null>(null);
  const whatIfRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, setCenter, getNode } = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // --- новые панели ---
  const [showSearch, setShowSearch] = useState(false);
  const [showVars, setShowVars] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // --- палитра: раскрытые группы и поиск ---
  const [openGroups, setOpenGroups] = useState<PaletteGroupId[]>(() => {
    try {
      return parseOpenGroups(localStorage.getItem(PALETTE_OPEN_KEY));
    } catch {
      return [...DEFAULT_OPEN_GROUPS];
    }
  });
  const [paletteQuery, setPaletteQuery] = useState('');

  // --- соединение портов кликом ---
  const [connectFrom, setConnectFrom] = useState<{ nodeId: string; handleId: string } | null>(null);

  // --- сохранение ---
  const [hydrated, setHydrated] = useState(false);
  // Загрузка сценария упала: вместо голого холста показываем карточку с retry.
  const [loadFailed, setLoadFailed] = useState(false);
  // Инкремент перезапускает загрузку сценария (кнопка «Повторить»).
  const [reloadKey, setReloadKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const savedJson = useRef<string>('');
  // Версия сохранённого сценария (WU-03): отправляется в PUT /scenario, чтобы
  // сервер мог заметить параллельную правку из другой вкладки.
  const scenarioVersion = useRef<number | null>(null);
  const [draft, setDraft] = useState<{ ts: number; scenario: CanvasScenario } | null>(null);
  // F-015: сервер ответил 409 version-conflict — сценарий успели сохранить
  // из другой вкладки. Полосу с выбором действия показываем явно, молча не
  // перезаписываем. current — актуальная версия с сервера.
  const [versionConflict, setVersionConflict] = useState<{ current: number | null } | null>(null);

  // --- визуальные группы блоков (чисто canvas-метаданные, TASK 9) ---
  const [groups, setGroups] = useState<CanvasGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // --- подсценарии (библиотека фрагментов) ---
  // Режим редактирования фрагмента: тот же холст/палитра/инспектор, но
  // сохранение идёт в /api/subflows/:id, а поверх холста — хлебные крошки.
  // Второй редактор принципиально не заводим (решение промпта).
  const [sfEditing, setSfEditing] = useState<{ id: string; name: string; revision: number } | null>(null);
  // Библиотека: нужна инспектору блока subflow (выбор фрагмента, входы/выходы).
  const [sfLibrary, setSfLibrary] = useState<
    { id: string; name: string; revision: number; description: string; inputs: { name: string; description: string; required: boolean }[]; outputs: { name: string; description: string; required: boolean }[] }[]
  >([]);
  // Статусы вызовов (бейджи «устарел»/«потерян»/«цикл») — из /subflow-check.
  const [sfChecks, setSfChecks] = useState<Map<string, { status: string; latestRevision?: number }>>(new Map());
  // Снимок холста бота перед входом во фрагмент: возврат восстанавливает его.
  const sfSavedCanvas = useRef<{ nodes: Node[]; edges: Edge[]; groups: CanvasGroup[]; start: string | null } | null>(null);
  // Диалог «создать подсценарий из выделения»: показываем дефолтное
  // отображение входов/выходов ДО действия (выглядит разрушительно — должно
  // быть отменяемо и undoable).
  const [sfExtract, setSfExtract] = useState<{
    ids: string[];
    inputs: string[];
    outputs: string[];
    name: string;
  } | null>(null);
  // Счётчик дефолтных alias'ов: два вызова без имени не должны столкнуться.
  const callIdsCounter = useRef(1);

  // --- история правок ---
  const past = useRef<HistorySnap[]>([]);
  const future = useRef<HistorySnap[]>([]);
  const prevSnap = useRef<HistorySnap | null>(null);
  const lastKey = useRef<string>('');
  const suppress = useRef(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);

  const clipboard = useRef<(CopiedSubgraph & { groups?: CanvasGroup[] }) | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);

  // Черновик несохранённых правок живёт на сервере (F9): он принадлежит
  // аккаунту, а не браузеру. Здесь держим последний отправленный JSON, чтобы
  // не гонять по сети одно и то же на каждое движение блока.
  const lastDraftJson = useRef<string>('');

  // ---------------------------------------------------------------- load

  // Загрузка сценария вынесена в callback: кнопка «Повторить» (loadFailed)
  // перезапускает ту же загрузку инкрементом reloadKey, без дублирования кода.
  const loadScenario = useCallback(() => {
    setHydrated(false);
    setLoadFailed(false);
    setDirty(false);
    past.current = [];
    future.current = [];
    prevSnap.current = null;
    lastKey.current = '';
    setUndoDepth(0);
    setRedoDepth(0);
    setDraft(null);
    lastDraftJson.current = '';
    setGroups([]);
    setSelectedGroupId(null);

    (async () => {
      try {
        const r: any = await api.getScenario(botId);
        if (r?.flow_json) {
          const sc: CanvasScenario = JSON.parse(r.flow_json);
          const g = scenarioToGraph(sc);
          setNodes(g.nodes);
          setEdges(g.edges);
          setGroups(sanitizeGroups(sc.groups));
          setCustomStart(sc.start ?? null);
          savedJson.current = r.flow_json;
          scenarioVersion.current = typeof r.version === 'number' ? r.version : null;
          setStatus('');
        } else {
          // Legacy bots may predate starter seeding. Keep the editor usable
          // without treating a missing draft as a transport failure.
          const starter = emptyScenario();
          const g = scenarioToGraph(starter);
          setNodes(g.nodes);
          setEdges(g.edges);
          setCustomStart(starter.start);
          savedJson.current = JSON.stringify(starter);
          scenarioVersion.current = null;
          setStatus(t('status.emptyScenario'));
        }

        // Черновик с сервера: если он отличается от сохранённого сценария,
        // значит есть незавершённые правки. Молча их не применяем — автор
        // должен выбрать сам.
        const d = await api.getDraft(botId).catch(() => null);
        const draftJson = d?.draft?.flow_json ?? '';
        const verdict = decideDraft(savedJson.current, d?.draft ?? null);
        if (verdict.kind === 'differs') {
          try {
            setDraft({ ts: verdict.updatedAt, scenario: JSON.parse(draftJson) as CanvasScenario });
          } catch {
            // Битый черновик не должен блокировать редактор.
            void api.deleteDraft(botId).catch(() => {});
          }
        } else if (verdict.kind === 'same') {
          // Черновик совпал с сохранённым — он больше не нужен.
          void api.deleteDraft(botId).catch(() => {});
          lastDraftJson.current = draftJson;
        }
      } catch {
        setStatus(t('status.noScenario'));
        setLoadFailed(true);
      } finally {
        setHydrated(true);
      }
    })();
  }, [botId, reloadKey, setNodes, setEdges]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadScenario();
  }, [loadScenario]);

  // «Повторить» в карточке ошибки загрузки: новая попытка тем же кодом.
  const retryLoad = useCallback(() => setReloadKey((k) => k + 1), []);

  // Тур — при первом открытии бота, если уровень не «высокий». Флаг живёт на
  // аккаунте (tour_done_at), поэтому на новом устройстве тур не вернётся (F9).
  // Ждём загрузки настроек: до неё tour_done_at — это дефолт, а не факт.
  useEffect(() => {
    if (!settingsLoaded) return;
    if (!settings.skill_level || settings.skill_level === 'high') return;
    if (settings.tour_done_at) return;
    setShowTour(true);
  }, [settingsLoaded, settings.skill_level, settings.tour_done_at]);

  const closeTour = useCallback(() => {
    setShowTour(false);
    // Если запись не удалась — тур просто покажется снова, данные не теряются.
    void updateSettings({ tour_done_at: Date.now() }).catch(() => {});
  }, []);

  // Связь из порта пишется в данные блока: 'next' → block.next,
  // 'branch:<ключ>' → branches[ключ]. По положению порта ничего не угадываем.
  const connect = useCallback(
    (source: string, handleId: string, target: string) => {
      if (!source || !target || source === target) return;
      const { kind, branchKey } = parseHandleId(handleId);
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== source) return n;
          const b = (n.data as NodeData).block;
          if (kind === 'branch') {
            const nb: Block = { ...b, branches: { ...(b.branches || {}), [branchKey as string]: target } };
            return { ...n, data: { ...n.data, block: nb } };
          }
          return { ...n, data: { ...n.data, block: { ...b, next: target } } };
        })
      );
      setEdges((eds) => {
        // Перезаписываем связь с этого же порта, а не плодим дубли.
        const kept = eds.filter((e) => !(e.source === source && (e.sourceHandle ?? 'next') === handleId));
        if (kind === 'branch') {
          kept.push({
            id: `e-${source}-${branchKey}`,
            source,
            target,
            sourceHandle: handleId,
            label: branchKey,
            animated: true,
            style: { stroke: '#f59e0b' },
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        } else {
          kept.push({
            id: `e-${source}-next`,
            source,
            target,
            sourceHandle: handleId,
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
        return kept;
      });
    },
    [setNodes, setEdges]
  );

  const onConnect = useCallback(
    (c: Connection) => connect(c.source, c.sourceHandle ?? 'next', c.target),
    [connect]
  );

  // Пользователь может удалить стрелку прямо на холсте (Backspace). Тогда из
  // данных блока надо убрать и саму ветку: иначе связь вернётся при следующей
  // загрузке сценария, и «удаление» окажется ложным.
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id);
      onEdgesChange(changes);
      if (!removed.length) return;
      const byId = new Map(edges.map((e) => [e.id, e]));
      const cleared = removed.map((id) => byId.get(id)).filter(Boolean) as Edge[];
      if (!cleared.length) return;
      setNodes((nds) =>
        nds.map((n) => {
          const mine = cleared.filter((e) => e.source === n.id);
          if (!mine.length) return n;
          const b = (n.data as NodeData).block;
          let next = b.next;
          const branches = { ...(b.branches || {}) };
          for (const e of mine) {
            const { kind, branchKey } = parseHandleId(e.sourceHandle ?? 'next');
            if (kind === 'branch' && branchKey) {
              if (branches[branchKey] === e.target) branches[branchKey] = '';
            } else if (next === e.target) {
              next = '';
            }
          }
          return { ...n, data: { ...n.data, block: { ...b, next, branches } } };
        })
      );
    },
    [onEdgesChange, edges, setNodes]
  );

  // Backspace удаляет узлы самим react-flow (мимо deleteBlocks): чистим
  // членство в группах и здесь, иначе в рамке останутся мёртвые участники.
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      onNodesChange(changes);
      if (!removed.length) return;
      const set = new Set(removed);
      const next = groups
        .map((g) => (g.members.some((m) => set.has(m)) ? { ...g, members: g.members.filter((m) => !set.has(m)) } : g))
        .filter((g) => g.members.length);
      if (next.length !== groups.length || next.some((g, i) => g !== groups[i])) setGroups(next);
      // Выделение могло указывать на снятую группу.
      if (selectedGroupId && !next.some((g) => g.id === selectedGroupId)) setSelectedGroupId(null);
    },
    [onNodesChange, groups, selectedGroupId]
  );

  // Клик по порту входит в режим соединения, клик по блоку — завершает его.
  // Перетаскивание при этом продолжает работать: это два независимых пути.
  const onPortClick = useCallback((nodeId: string, handleId: string) => {
    setConnectFrom((prev) => (prev && prev.nodeId === nodeId && prev.handleId === handleId ? null : { nodeId, handleId }));
  }, []);

  const connectTargetHint = t('connect.hint');

  const cancelConnect = useCallback(() => setConnectFrom(null), []);

  const finishConnect = useCallback(
    (targetId: string) => {
      setConnectFrom((prev) => {
        if (prev) connect(prev.nodeId, prev.handleId, targetId);
        return null;
      });
    },
    [connect]
  );

  const newId = () => `b_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`;

  const addBlock = useCallback(
    (type: BlockType, position?: { x: number; y: number }) => {
      const id = newId();
      const block = defaultBlock(type, id);
      // Клик по палитре кладёт блок в центр текущего вида — иначе он уезжает
      // за край холста и кажется, что «ничего не происходит».
      const rect = canvasRef.current?.getBoundingClientRect();
      const center = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 240, y: 160 };
      setNodes((nds) => {
        const i = nds.length;
        const pos = position ?? { x: center.x - 90 + (i % 4) * 44, y: center.y - 48 + (i % 4) * 38 };
        return [...nds, { id, type: 'bot', position: pos, data: { block } }];
      });
      if (type === 'start') setCustomStart(id);
      setSelected(id);
      setStatus('');
      return id;
    },
    [setNodes, screenToFlowPosition]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/botblock') as BlockType;
      if (!type) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addBlock(type, position);
    },
    [addBlock, screenToFlowPosition]
  );

  const updateBlock = useCallback(
    (id: string, params: BlockParams, branches?: Record<string, string>, next?: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          const b = (n.data as NodeData).block;
          const nb: Block = { ...b, params: { ...b.params, ...params } };
          if (branches) nb.branches = branches;
          if (typeof next === 'string') nb.next = next;
          return { ...n, data: { ...n.data, block: nb } };
        })
      );
      if (branches || typeof next === 'string') {
        setEdges((eds) => {
          // Стрелки этого блока пересобираем целиком: так удаление кнопки не
          // оставляет висящую связь от порта, которого больше нет.
          const kept = eds.filter((e) => e.source !== id);
          if (branches) {
            for (const [k, tt] of Object.entries(branches)) {
              if (tt)
                kept.push({
                  id: `e-${id}-${k}`,
                  source: id,
                  target: tt,
                  sourceHandle: handleIdFor('branch', k),
                  label: k,
                  animated: true,
                  style: { stroke: '#f59e0b' },
                  markerEnd: { type: MarkerType.ArrowClosed },
                });
            }
          }
          // `next` не рисуем, если вызвали ради веток: у ветвящихся блоков связь
          // живёт в branches, и общий «далее» им не нужен.
          if (typeof next === 'string' && next) {
            kept.push({
              id: `e-${id}-next`,
              source: id,
              target: next,
              sourceHandle: 'next',
              markerEnd: { type: MarkerType.ArrowClosed },
            });
          }
          return kept;
        });
      }
    },
    [setNodes, setEdges]
  );

  const selectedIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);

  const deleteBlocks = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      if (!set.size) return;
      setNodes((nds) => nds.filter((n) => !set.has(n.id)));
      setEdges((eds) => eds.filter((e) => !set.has(e.source) && !set.has(e.target)));
      // Членство в группах чистим сразу: группа без участников не имеет смысла.
      // Шага истории не добавляем — удаление блоков уже шаг (structureKey).
      const nextGroups = groups
        .map((g) => (g.members.some((m) => set.has(m)) ? { ...g, members: g.members.filter((m) => !set.has(m)) } : g))
        .filter((g) => g.members.length);
      if (nextGroups.length !== groups.length || nextGroups.some((g, i) => g !== groups[i])) setGroups(nextGroups);
      if (selectedGroupId && !nextGroups.some((g) => g.id === selectedGroupId)) setSelectedGroupId(null);
      if (customStart && set.has(customStart)) setCustomStart(null);
      if (selected && set.has(selected)) setSelected(null);
    },
    [setNodes, setEdges, groups, selectedGroupId, customStart, selected]
  );

  const duplicateBlocks = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const copy = copySubgraph(nodes, edges, ids, 48);
      // Группировка переносится на копию, только если продублированы ВСЕ
      // участники группы (чистая логика — copiedGroups в graph.ts).
      const gs = copiedGroups(groups, copyIdMap(nodes, ids, copy.nodes), 48, 48);
      setNodes((nds) => [...nds.map((n) => (n.selected ? { ...n, selected: false } : n)), ...copy.nodes]);
      setEdges((eds) => [...eds, ...copy.edges]);
      if (gs.length) setGroups((cur) => [...cur, ...gs]);
      if (copy.nodes.length === 1) setSelected(copy.nodes[0].id);
    },
    [nodes, edges, groups, setNodes, setEdges]
  );

  // Дублирование со связями: обычная копия обнуляет `next`, поэтому стрелки
  // приходилось тянуть заново. Чистая логика — в graph.ts (покрыта тестом).
  const duplicateKeepingLinks = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const copy = duplicateWithLinks(nodes, edges, ids);
      const gs = copiedGroups(groups, copyIdMap(nodes, ids, copy.nodes), 48, 48);
      const withMarkers = {
        nodes: copy.nodes,
        edges: copy.edges.map((e) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed } })),
      };
      setNodes((nds) => [
        ...nds.map((x) => (x.selected ? { ...x, selected: false } : x)),
        ...withMarkers.nodes,
      ]);
      setEdges((eds) => [...eds, ...withMarkers.edges]);
      if (gs.length) setGroups((cur) => [...cur, ...gs]);
      if (withMarkers.nodes.length === 1) setSelected(withMarkers.nodes[0].id);
      setStatus(t('status.duplicatedWithLinks', { n: withMarkers.nodes.length }));
    },
    [nodes, edges, groups, setNodes, setEdges, t]
  );

  const toggleDisabled = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      if (!set.size) return;
      setNodes((nds) =>
        nds.map((n) => {
          if (!set.has(n.id)) return n;
          const b = (n.data as NodeData).block;
          return { ...n, data: { ...n.data, block: { ...b, params: { ...b.params, disabled: !b.params.disabled } } } };
        })
      );
    },
    [setNodes]
  );

  const clearLinks = useCallback(
    (id: string) => {
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, block: { ...(n.data as NodeData).block, next: '', branches: undefined } } }
            : n
        )
      );
    },
    [setEdges, setNodes]
  );

  // ---------------------------------------------------------------- группы холста

  // Групповое действие = ОДИН шаг истории: снапшот {nodes, edges, groups}
  // кладём в past сами, структурный эффект ниже его не увидит (structureKey
  // от групп не зависит).
  const applyGroups = useCallback(
    (updater: (gs: CanvasGroup[]) => CanvasGroup[]) => {
      const nextGroups = updater(groups);
      if (nextGroups === groups) return;
      past.current.push({ nodes, edges, groups });
      if (past.current.length > 60) past.current.shift();
      future.current = [];
      prevSnap.current = { nodes, edges, groups: nextGroups };
      setGroups(nextGroups);
      setUndoDepth(past.current.length);
      setRedoDepth(0);
    },
    [nodes, edges, groups]
  );

  const groupSelection = useCallback(
    (ids: string[]) => {
      if (ids.length < 2) return;
      const idSet = new Set(ids);
      const sel = nodes.filter((n) => idSet.has(n.id));
      const g = createGroupAround(newGroupId(), sel);
      if (!g) return;
      applyGroups((gs) => [...gs, g]);
      setSelectedGroupId(g.id);
      setStatus(t('status.grouped', { n: sel.length }));
    },
    [nodes, applyGroups, t]
  );

  const removeGroup = useCallback(
    (id: string) => {
      if (!groups.some((g) => g.id === id)) {
        setSelectedGroupId(null);
        return;
      }
      // Блоки не трогаем: группа — чисто визуальная рамка.
      applyGroups((gs) => gs.filter((g) => g.id !== id));
      setSelectedGroupId((cur) => (cur === id ? null : cur));
      setStatus(t('status.ungrouped'));
    },
    [groups, applyGroups, t]
  );

  const renameGroup = useCallback(
    (id: string, title: string) => {
      applyGroups((gs) => gs.map((g) => (g.id === id ? { ...g, title } : g)));
    },
    [applyGroups]
  );

  const recolorGroup = useCallback(
    (id: string, color: string) => {
      applyGroups((gs) => gs.map((g) => (g.id === id ? { ...g, color } : g)));
    },
    [applyGroups]
  );

  const toggleCollapseGroup = useCallback(
    (g: CanvasGroup) => {
      applyGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, collapsed: !x.collapsed } : x)));
    },
    [applyGroups]
  );

  // --- drag/resize рамки: свой pointer-драг (группа — не узел react-flow) ---

  const groupDrag = useRef<{
    mode: 'move' | 'resize';
    snap: HistorySnap;
    group: CanvasGroup;
    start: { x: number; y: number };
    memberPos: Map<string, { x: number; y: number }>;
    moved: boolean;
  } | null>(null);
  // Клик после состоявшегося драга не должен превращаться в выбор/разворот.
  const groupDragMoved = useRef(false);
  const groupDragFrame = useRef<number | null>(null);
  const pendingGroupPointer = useRef<PointerEvent | null>(null);
  // Свежее состояние для window-слушателей (они переживают замыкание рендера).
  const stateRef = useRef<HistorySnap>({ nodes, edges, groups });
  stateRef.current = { nodes, edges, groups };

  const applyGroupPointerMove = useCallback(
    (e: PointerEvent) => {
      const st = groupDrag.current;
      if (!st) return;
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const dx = p.x - st.start.x;
      const dy = p.y - st.start.y;
      if (!st.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      st.moved = true;
      if (st.mode === 'move') {
        setGroups((gs) =>
          gs.map((g) => (g.id === st.group.id ? { ...g, x: st.group.x + dx, y: st.group.y + dy } : g))
        );
        // Рамка тянет участников за собой.
        setNodes((nds) =>
          nds.map((n) => {
            const p0 = st.memberPos.get(n.id);
            return p0 ? { ...n, position: { x: p0.x + dx, y: p0.y + dy } } : n;
          })
        );
      } else {
        setGroups((gs) =>
          gs.map((g) =>
            g.id === st.group.id
              ? {
                  ...g,
                  w: Math.max(GROUP_MIN_W, st.group.w + dx),
                  h: Math.max(GROUP_MIN_H, st.group.h + dy),
                }
              : g
          )
        );
      }
    },
    [screenToFlowPosition, setNodes]
  );

  const onGroupPointerMove = useCallback((e: PointerEvent) => {
    pendingGroupPointer.current = e;
    if (groupDragFrame.current != null) return;
    groupDragFrame.current = requestAnimationFrame(() => {
      groupDragFrame.current = null;
      const latest = pendingGroupPointer.current;
      if (latest) applyGroupPointerMove(latest);
    });
  }, [applyGroupPointerMove]);

  const onGroupPointerUp = useCallback(() => {
    const st = groupDrag.current;
    groupDrag.current = null;
    window.removeEventListener('pointermove', onGroupPointerMove);
    window.removeEventListener('pointerup', onGroupPointerUp);
    if (groupDragFrame.current != null) cancelAnimationFrame(groupDragFrame.current);
    groupDragFrame.current = null;
    const latest = pendingGroupPointer.current;
    pendingGroupPointer.current = null;
    if (latest) applyGroupPointerMove(latest);
    if (!st) return;
    groupDragMoved.current = st.moved;
    if (!st.moved) return;
    // Один драг — один шаг истории: снимок ДО драга кладём в past на отпускании.
    past.current.push(st.snap);
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    const cur = stateRef.current;
    prevSnap.current = { nodes: cur.nodes, edges: cur.edges, groups: cur.groups };
    setUndoDepth(past.current.length);
    setRedoDepth(0);
  }, [onGroupPointerMove, applyGroupPointerMove]);

  const beginGroupDrag = useCallback(
    (mode: 'move' | 'resize') => (e: React.PointerEvent, g: CanvasGroup) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      groupDragMoved.current = false;
      setSelectedGroupId(g.id);
      const memberPos = new Map(
        nodes.filter((n) => g.members.includes(n.id)).map((n) => [n.id, n.position])
      );
      groupDrag.current = {
        mode,
        snap: { nodes, edges, groups },
        group: g,
        start: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
        memberPos,
        moved: false,
      };
      window.addEventListener('pointermove', onGroupPointerMove);
      window.addEventListener('pointerup', onGroupPointerUp);
    },
    [nodes, edges, groups, screenToFlowPosition, onGroupPointerMove, onGroupPointerUp]
  );

  const beginGroupMove = useCallback(
    (e: React.PointerEvent, g: CanvasGroup) => beginGroupDrag('move')(e, g),
    [beginGroupDrag]
  );
  const beginGroupResize = useCallback(
    (e: React.PointerEvent, g: CanvasGroup) => beginGroupDrag('resize')(e, g),
    [beginGroupDrag]
  );

  const onGroupClick = useCallback(
    (g: CanvasGroup) => {
      if (groupDragMoved.current) return; // это был драг, не клик
      setSelectedGroupId(g.id);
      if (g.collapsed) {
        // Клик по плитке разворачивает группу.
        applyGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, collapsed: false } : x)));
        return;
      }
      // Выделение группы гасит выделение блоков: Delete должен удалить рамку.
      setSelected(null);
      setNodes((nds) => (nds.some((n) => n.selected) ? nds.map((n) => (n.selected ? { ...n, selected: false } : n)) : nds));
    },
    [applyGroups, setNodes]
  );

  const groupLabels = useMemo<CanvasGroupLabels>(
    () => ({
      defaultTitle: t('group.defaultTitle'),
      panelAria: t('group.panel.aria'),
      colorTitle: t('group.color.title'),
      collapseTitle: t('group.collapse.title'),
      expandTitle: t('group.expand.title'),
      deleteTitle: t('group.delete.title'),
      moveTitle: t('group.move.title'),
      resizeTitle: t('group.resize.title'),
      renameTitle: t('group.rename.title'),
      renamePlaceholder: t('group.rename.placeholder'),
    }),
    [t]
  );

  // Участники свёрнутых групп не рисуются (runtime-флаг hidden, в JSON не уходит).
  const displayNodes = useMemo(() => nodesWithCollapsedHidden(nodes, groups), [nodes, groups]);

  const copySelection = useCallback(() => {
    const ids = selectedIds.length ? selectedIds : selected ? [selected] : [];
    if (!ids.length) return;
    const copy = copySubgraph(nodes, edges, ids, 0);
    // Группировка переносится, только если скопированы ВСЕ участники группы.
    clipboard.current = { ...copy, groups: copiedGroups(groups, copyIdMap(nodes, ids, copy.nodes)) };
    setHasClipboard(true);
    setStatus(t('status.copied', { n: ids.length }));
  }, [selectedIds, selected, nodes, edges, groups, t]);

  const pasteClipboard = useCallback(() => {
    const clip = clipboard.current;
    if (!clip) return;
    const suffix = Math.random().toString(36).slice(2, 8);
    const nodesToAdd = clip.nodes.map((n) => ({
      ...n,
      position: { x: n.position.x + 40, y: n.position.y + 40 },
    }));
    const edgesToAdd = clip.edges.map((e) => ({ ...e, id: `${e.id}-${suffix}` }));
    const groupsToAdd = (clip.groups ?? []).map((g) => ({
      ...g,
      id: newGroupId(),
      x: g.x + 40,
      y: g.y + 40,
    }));
    setNodes((nds) => [...nds.map((n) => (n.selected ? { ...n, selected: false } : n)), ...nodesToAdd]);
    setEdges((eds) => [...eds, ...edgesToAdd]);
    if (groupsToAdd.length) setGroups((gs) => [...gs, ...groupsToAdd]);
    setStatus(t('status.pasted', { n: nodesToAdd.length }));
  }, [setNodes, setEdges, t]);

  // ---------------------------------------------------------------- история правок

  const structureKey = useMemo(() => structuralHash(nodes, edges), [nodes, edges]);

  useEffect(() => {
    if (!hydrated) return;
    const key = structureKey;
    if (key === lastKey.current) {
      // Структура не менялась (драг, выделение, откат позиции, правка групп) —
      // держим снимок в ногу с текущим состоянием, иначе следующий структурный
      // шаг вернёт раскладку, которой на экране уже нет.
      prevSnap.current = { nodes, edges, groups };
      return;
    }
    if (suppress.current) {
      // Откат/повтор: не пишем его как новое изменение.
      suppress.current = false;
      lastKey.current = key;
      prevSnap.current = { nodes, edges, groups };
      return;
    }
    if (prevSnap.current && lastKey.current !== '') {
      past.current.push(prevSnap.current);
      if (past.current.length > 60) past.current.shift();
      future.current = [];
      setUndoDepth(past.current.length);
      setRedoDepth(0);
    }
    lastKey.current = key;
    prevSnap.current = { nodes, edges, groups };
  }, [structureKey, nodes, edges, groups, hydrated]);

  // Перетаскивание блока — тоже действие, но structuralHash позиции намеренно
  // не учитывает (иначе история пухла бы от каждого кадра мыши). Снимок до
  // начала драга кладём в историю один раз — на его завершении.
  const dragSnap = useRef<HistorySnap | null>(null);

  const onNodeDragStart = useCallback(() => {
    dragSnap.current = { nodes, edges, groups };
  }, [nodes, edges, groups]);

  const onNodeDragStop = useCallback(
    (_e: unknown, _node: Node, dragged: Node[]) => {
      const prev = dragSnap.current;
      dragSnap.current = null;
      if (!prev || suppress.current) return;
      const moved = dragged.some((d) => {
        const old = prev.nodes.find((n) => n.id === d.id);
        return !old || old.position.x !== d.position.x || old.position.y !== d.position.y;
      });
      // Блок утащили наружу рамки — членство снимается (pointInGroup /
      // membersAfterDrag). Позиции берём свежие: dragged несёт обновлённые.
      if (groups.length && moved) {
        const posById = new Map(nodes.map((n) => [n.id, n.position]));
        for (const d of dragged) posById.set(d.id, d.position);
        setGroups((gs) => {
          let changed = false;
          const next = gs.map((g) => {
            const positions: Record<string, { x: number; y: number }> = {};
            for (const m of g.members) {
              const p = posById.get(m);
              if (p) positions[m] = p;
            }
            const kept = membersAfterDrag(g, positions);
            if (kept.length === g.members.length) return g;
            changed = true;
            return { ...g, members: kept };
          });
          return changed ? next.filter((g) => g.members.length) : gs;
        });
      }
      if (!moved) return;
      past.current.push(prev);
      if (past.current.length > 60) past.current.shift();
      future.current = [];
      // Следующим структурным снимком должна стать раскладка ПОСЛЕ драга:
      // dragged несёт свежие позиции, замыкание nodes может отставать на кадр.
      const posById = new Map(dragged.map((d) => [d.id, d.position]));
      prevSnap.current = {
        nodes: nodes.map((n) => {
          const p = posById.get(n.id);
          return p ? { ...n, position: p } : n;
        }),
        edges,
        groups,
      };
      setUndoDepth(past.current.length);
      setRedoDepth(0);
    },
    [nodes, edges, groups, setGroups]
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push({ nodes, edges, groups });
    // Откат чистой позиции структуру не меняет: флаг «не записывать» ставим
    // только когда хэш действительно разойдётся, иначе он залипнет и съест
    // следующую настоящую правку. Группы в хэше не участвуют — их откат
    // структуру тоже не меняет.
    suppress.current = structuralHash(prev.nodes, prev.edges) !== lastKey.current;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setGroups(prev.groups);
    setUndoDepth(past.current.length);
    setRedoDepth(future.current.length);
  }, [nodes, edges, groups, setNodes, setEdges]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push({ nodes, edges, groups });
    suppress.current = structuralHash(next.nodes, next.edges) !== lastKey.current;
    setNodes(next.nodes);
    setEdges(next.edges);
    setGroups(next.groups);
    setUndoDepth(past.current.length);
    setRedoDepth(future.current.length);
  }, [nodes, edges, groups, setNodes, setEdges]);

  // ---------------------------------------------------------------- сохранение

  const buildScenario = useCallback(
    () => graphToScenario(nodes, edges, customStart, groups),
    [nodes, edges, customStart, groups]
  );
  const scenario = useMemo(() => buildScenario(), [buildScenario]);

  // Изменения только помечаем как несохранённые. Серверная версия создаётся
  // исключительно по кнопке «Сохранить» или Ctrl/Cmd+S.
  useEffect(() => {
    if (!hydrated) return;
    if (sfEditing) return; // правки фрагмента — не черновик бота
    setDirty(true);
  }, [nodes, edges, groups, customStart, hydrated, sfEditing]);

  // Раскрытие групп палитры — состояние окна, поэтому localStorage, а не
  // настройки на бэке. Ошибку записи (приватный режим) молча игнорируем.
  useEffect(() => {
    try {
      localStorage.setItem(PALETTE_OPEN_KEY, JSON.stringify(openGroups));
    } catch {
      /* не критично */
    }
  }, [openGroups]);

  // Автосохранение черновика на сервер: пауза 1.5 с после последней правки.
  // Черновик принадлежит аккаунту, поэтому незавершённая работа подхватится на
  // другом устройстве (F9). Ошибку сети молчим — «Сохранить» остаётся главным
  // способом зафиксировать версию, и оно покажет ошибку явно.
  useEffect(() => {
    if (!hydrated || !dirty || sfEditing) return;
    const timer = setTimeout(() => {
      const sc = graphToScenario(nodes, edges, customStart, groups);
      const json = JSON.stringify(sc);
      if (!shouldFlushDraft(json, savedJson.current, lastDraftJson.current)) return;
      lastDraftJson.current = json;
      void api.saveDraft(botId, json).catch(() => {
        // Не записалось — разрешаем следующей попытке отправить тот же JSON.
        lastDraftJson.current = '';
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [nodes, edges, groups, customStart, hydrated, dirty, botId, sfEditing]);

  // Последний шанс перед уходом: вкладку закрывают или сворачивают до таймера.
  // keepalive в запросе обязателен — иначе браузер оборвёт его вместе со вкладкой.
  useEffect(() => {
    const flushDraft = () => {
      if (!hydrated || !dirty || sfEditing) return;
      const sc = graphToScenario(nodes, edges, customStart, groups);
      const json = JSON.stringify(sc);
      if (!shouldFlushDraft(json, savedJson.current, lastDraftJson.current)) return;
      lastDraftJson.current = json;
      void api.saveDraft(botId, json, true).catch(() => {
        lastDraftJson.current = '';
      });
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushDraft();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('beforeunload', flushDraft);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('beforeunload', flushDraft);
    };
  }, [nodes, edges, groups, customStart, hydrated, dirty, botId, sfEditing]);

  const restoreDraft = useCallback(() => {
    if (!draft) return;
    const g = scenarioToGraph(draft.scenario);
    setNodes(g.nodes);
    setEdges(g.edges);
    setGroups(sanitizeGroups(draft.scenario.groups));
    setCustomStart(draft.scenario.start ?? null);
    // Черновик восстановлен — он снова «текущие правки», и его нужно вернуть
    // на сервер при следующем автосохранении (иначе повторное закрытие вкладки
    // потеряет восстановленное, потому что это уже не черновик на сервере).
    lastDraftJson.current = '';
    setDraft(null);
    setStatus(t('status.draftRestored'));
  }, [draft, setNodes, setEdges, t]);

  const dropDraft = useCallback(() => {
    // «Не нужно» — черновик действительно не нужен: убираем и с сервера,
    // иначе предложение вернулось бы при следующем открытии бота.
    void api.deleteDraft(botId).catch(() => {});
    lastDraftJson.current = savedJson.current;
    setDraft(null);
  }, [botId]);

  // ---------------------------------------------------------------- подсценарии

  // Библиотека фрагментов: грузим при входе в конструктор (нужна инспектору
  // блока subflow и для subflow-check). Ошибка сети не блокирует редактор.
  const loadSfLibrary = useCallback(async () => {
    try {
      const r = await api.subflows.list();
      setSfLibrary(r.subflows ?? []);
      return r.subflows ?? [];
    } catch {
      setSfLibrary([]);
      return [] as typeof sfLibrary;
    }
  }, []);

  useEffect(() => {
    void loadSfLibrary();
  }, [loadSfLibrary]);

  // Статусы вызовов для бейджей холста: сухой прогон на сервере (subflow-check).
  // Пересчитываем на изменение структуры сценария (debounce) — только в боте,
  // во фрагменте блоков вызова нет.
  const structureKeyForSf = useMemo(() => structuralHash(nodes, edges), [nodes, edges]);
  useEffect(() => {
    if (sfEditing) return;
    if (!structureKeyForSf.includes('subflow') && !sfChecks.size) return;
    const timer = setTimeout(() => {
      const sc = graphToScenario(nodes, edges, customStart, groups);
      api.subflows
        .checkBot(botId, JSON.stringify(sc))
        .then((r) => {
          const m = new Map<string, { status: string; latestRevision?: number }>();
          for (const c of r.calls ?? []) m.set(c.blockId, { status: c.status, latestRevision: c.latestRevision });
          setSfChecks(m);
        })
        .catch(() => setSfChecks(new Map()));
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKeyForSf, botId, sfEditing]);

  // Вход во фрагмент (drill-in): тот же холст/палитра/инспектор — второго
  // редактора нет. Снимок холста бота сохраняется: «назад» вернёт его как был.
  const enterSubflow = useCallback(
    async (subflowId: string) => {
      const lib = sfLibrary.length ? sfLibrary : await loadSfLibrary();
      const found = lib.find((s) => s.id === subflowId);
      if (!found) {
        setStatus(t('sf.notFound'));
        return;
      }
      try {
        const r = await api.subflows.get(subflowId);
        const sf = r.subflow;
        sfSavedCanvas.current = { nodes, edges, groups, start: customStart };
        const frag: Scenario = JSON.parse(sf.flow_json);
        const g = scenarioToGraph(frag);
        past.current = [];
        future.current = [];
        prevSnap.current = null;
        lastKey.current = '';
        setUndoDepth(0);
        setRedoDepth(0);
        setNodes(g.nodes);
        setEdges(g.edges);
        setGroups([]);
        setCustomStart(frag.start ?? null);
        setSelected(null);
        setSfEditing({ id: sf.id, name: sf.name, revision: sf.revision });
        setStatus('');
      } catch {
        setStatus(t('sf.loadError'));
      }
    },
    [sfLibrary, loadSfLibrary, nodes, edges, groups, customStart, setNodes, setEdges, t]
  );

  // Выход из фрагмента: холст бота восстанавливается из снимка.
  const exitSubflow = useCallback(() => {
    const snap = sfSavedCanvas.current;
    setSfEditing(null);
    setSfPreview(null);
    if (!snap) return;
    sfSavedCanvas.current = null;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setGroups(snap.groups);
    setCustomStart(snap.start);
    setSelected(null);
    past.current = [];
    future.current = [];
    prevSnap.current = null;
    lastKey.current = '';
    setUndoDepth(0);
    setRedoDepth(0);
    void loadSfLibrary();
  }, [setNodes, setEdges, loadSfLibrary]);

  // Сохранение фрагмента: PUT -> новая ревизия + строка истории (сервер).
  // Возвращает успех: «Проверить фрагмент» по нему решает, гонять ли сервер.
  // Guard от двойного запуска (WU-04): ref, а не state — два Ctrl+S подряд
  // попадают в одну пачку рендеров, и setSaving(true) их не разводит.
  const savingRef = useRef(false);
  const saveSubflow = useCallback(async (): Promise<boolean> => {
    if (!sfEditing) return false;
    if (savingRef.current) return false;
    savingRef.current = true;
    const sc = graphToScenario(nodes, edges, customStart, null);
    setSaving(true);
    try {
      const r = await api.subflows.save(sfEditing.id, { flow_json: JSON.stringify(sc) });
      setSfEditing({ ...sfEditing, revision: r.revision });
      setDirty(false);
      setSaveErrorStatus('');
      setStatus(t('sf.saved', { rev: r.revision }));
      return true;
    } catch (e: any) {
      const msg = t('status.saveError', { msg: friendlyApiError(e, settings.language) });
      setSaveErrorStatus(msg);
      setStatus(msg);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [sfEditing, nodes, edges, customStart, t, settings.language]);

  // Единая точка сохранения: Ctrl+S и кнопка «Сохранить». В режиме фрагмента
  // пишет в библиотеку (новая ревизия), иначе — в сценарий бота.
  const doSave = useCallback(async () => {
    if (sfEditing) {
      await saveSubflow();
      return;
    }
    // In-flight guard (WU-04): повторный вызов (второй Ctrl+S, клик по
    // «Повторить») не стартует параллельный PUT — ждём завершения первого.
    if (savingRef.current) return;
    const sc = graphToScenario(nodes, edges, customStart, groups);
    const json = JSON.stringify(sc);
    if (json === savedJson.current) {
      setDirty(false);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const r = await api.saveScenario(botId, name, json, scenarioVersion.current);
      savedJson.current = json;
      if (typeof r?.version === 'number') scenarioVersion.current = r.version;
      setDirty(false);
      // Сценарий сохранён — черновик больше не нужен. Сервер чистит его сам
      // при сохранении; здесь сбрасываем только локальную память о нём.
      lastDraftJson.current = json;
      setDraft(null);
      setVersionConflict(null);
      setSaveErrorStatus('');
      setStatus(t('status.saved'));
    } catch (e: any) {
      // F-015: 409 version-conflict — сценарий свежее в другой вкладке. Не
      // перезаписываем молча: показываем полосу с явным выбором действия.
      if (isVersionConflict(e)) {
        setVersionConflict({ current: versionConflictCurrent(e) });
        setSaveErrorStatus('');
        setStatus(t('status.versionConflict'));
      } else {
        const msg = t('status.saveError', { msg: friendlyApiError(e, settings.language) });
        setSaveErrorStatus(msg);
        setStatus(msg);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [sfEditing, saveSubflow, nodes, edges, groups, customStart, botId, name, settings.language, t]);

  // «Сохранить поверх» при конфликте версий: принимаем версию сервера как
  // базу и повторяем сохранение тех же правок — осознанная перезапись чужой
  // вкладки (единственный способ не потерять свою работу).
  const overwriteConflict = useCallback(() => {
    if (versionConflict?.current != null) scenarioVersion.current = versionConflict.current;
    setVersionConflict(null);
    void doSave();
  }, [versionConflict, doSave]);

  // «Загрузить актуальную»: перечитать сценарий с сервера. Правки этой
  // вкладки не теряются — они уже в серверном черновике, и после перезагрузки
  // полоса черновика предложит восстановить их поверх свежей версии.
  const reloadConflict = useCallback(() => {
    setVersionConflict(null);
    setReloadKey((k) => k + 1);
  }, []);

  // «Проверить фрагмент»: прогон настоящим движком на сервере (preview).
  const [sfPreview, setSfPreview] = useState<{ log: { who: string; text: string }[]; issues?: any[] } | null>(null);
  const checkSubflow = useCallback(async () => {
    if (!sfEditing) return;
    // Сначала сохраняем: сервер гоняет сохранённую ревизию, а не холст.
    // Если сохранение упало — прогон НЕ запускаем: он молча показал бы
    // старую ревизию вместо текущего холста (WU-06). Ошибку видно в статусе.
    const saved = await saveSubflow();
    if (!saved) {
      setSfPreview({ log: [], issues: [{ level: 'error', code: 'save-failed', message: t('sf.checkSaveFailed') }] });
      return;
    }
    try {
      const r = await api.subflows.preview(sfEditing.id, { steps: ['/start'] });
      setSfPreview({ log: r.log ?? [], issues: r.issues ?? [] });
    } catch (e: any) {
      const issues = (e && typeof e === 'object' ? (e as any).body?.issues ?? (e as any).issues : null) ?? [
        { level: 'error', code: 'err', message: String((e as any)?.message ?? e) },
      ];
      setSfPreview({ log: [], issues });
    }
  }, [sfEditing, saveSubflow, t]);

  // «Создать подсценарий из выделения»: диалог с дефолтным отображением
  // входов/выходов ПОКАЗЫВАЕТСЯ ДО действия (выглядит разрушительно — автор
  // должен видеть, что получится, и иметь возможность отменить).
  const beginExtractSubflow = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const sc = graphToScenario(nodes, edges, customStart, groups);
      const io = selectionIo(sc, ids);
      setSfExtract({ ids, inputs: io.inputs, outputs: io.outputs, name: '' });
    },
    [nodes, edges, customStart, groups]
  );

  // Подтверждение извлечения: выделение переносится во фрагмент, на холсте
  // остаётся один блок вызова. ОДНО действие = ОДИН шаг undo (снапшот в past
  // руками, как applyGroups).
  const confirmExtractSubflow = useCallback(async () => {
    if (!sfExtract) return;
    const { ids, inputs, outputs, name } = sfExtract;
    setSfExtract(null);
    const sc = graphToScenario(nodes, edges, customStart, groups);
    const sel = new Set(ids);
    // Блоки фрагмента: id сохраняются (внутри фрагмента они уникальны),
    // ссылки НАРУЖУ выделения обрываются — связь с ботом только через
    // входы/выходы и ветки done/failed блока вызова.
    const fragBlocks: Record<string, Block> = {};
    for (const id of ids) {
      const b = sc.blocks[id];
      if (!b || b.type === 'start') continue;
      const nb: Block = JSON.parse(JSON.stringify(b));
      if (nb.next && !sel.has(nb.next)) nb.next = '';
      if (nb.branches) {
        for (const k of Object.keys(nb.branches)) if (nb.branches[k] && !sel.has(nb.branches[k])) nb.branches[k] = '';
      }
      if (nb.type === 'goto' && nb.params.target && !sel.has(nb.params.target)) nb.params.target = '';
      delete nb.position;
      fragBlocks[id] = nb;
    }
    const fragStart = ids.find((id) => fragBlocks[id]) ?? '';
    // Листья выделения получают терминал subflow_return.
    const retId = 'sf_return';
    const leafIds = Object.keys(fragBlocks).filter((id) => {
      const b = fragBlocks[id];
      if (b.type === 'end' || b.type === 'goto' || usesBranches(b.type)) return false;
      return !b.next;
    });
    fragBlocks[retId] = { id: retId, type: 'subflow_return', params: {} };
    for (const id of leafIds) fragBlocks[id].next = retId;
    if (!fragStart) {
      setStatus(t('sf.extractEmpty'));
      return;
    }

    // Куда вёл конец выделения (первый внешний таргет) — в ветку done вызова.
    let outgoing = '';
    for (const id of ids) {
      const b = sc.blocks[id];
      if (b?.next && !sel.has(b.next)) { outgoing = b.next; break; }
      for (const target of Object.values(b?.branches ?? {})) {
        if (target && !sel.has(target)) { outgoing = target; break; }
      }
      if (outgoing) break;
    }

    let created: any = null;
    try {
      created = await api.subflows.create({
        name: name.trim() || t('sf.defaultName'),
        description: '',
        flow_json: JSON.stringify({ version: 1, start: fragStart, blocks: fragBlocks }),
        inputs: inputs.map((n) => ({ name: n, description: '', required: false })),
        outputs: outputs.map((n) => ({ name: n, description: '', required: false })),
      });
    } catch (e: any) {
      setStatus(t('status.saveError', { msg: friendlyApiError(e, settings.language) }));
      return;
    }
    const sfId = created?.subflow?.id;
    if (!sfId) return;

    // Замена на холсте — ОДИН шаг истории.
    past.current.push({ nodes, edges, groups });
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    const callId = newId();
    const pos = nodes.find((n) => sel.has(n.id))?.position ?? { x: 200, y: 200 };
    const alias = String(created?.subflow?.name ?? 'sf')
      .toLowerCase()
      .replace(/[^\w-]+/g, '_')
      .slice(0, 16) || `sf_${callIdsCounter.current++}`;
    const nextNodes = nodes.filter((n) => !sel.has(n.id)).map((n) => (n.selected ? { ...n, selected: false } : n));
    nextNodes.push({
      id: callId,
      type: 'bot',
      position: pos,
      data: {
        block: {
          id: callId,
          type: 'subflow',
          params: { subflowId: sfId, alias, scope: 'isolated' },
          branches: { done: outgoing, failed: '' },
          position: pos,
        } as Block,
      },
    });
    // Входящие связи выделения перенаправляем на вызов (в data блоков и в рёбрах).
    const fixed = nextNodes.map((n) => {
      const b = (n.data as NodeData).block;
      let changed = false;
      const nb: Block = { ...b };
      if (nb.next && sel.has(nb.next)) { nb.next = callId; changed = true; }
      if (nb.branches) {
        const br = { ...nb.branches };
        for (const k of Object.keys(br)) if (br[k] && sel.has(br[k])) { br[k] = callId; changed = true; }
        if (changed) nb.branches = br;
      }
      if (nb.type === 'goto' && nb.params.target && sel.has(nb.params.target)) {
        nb.params = { ...nb.params, target: callId };
        changed = true;
      }
      return changed ? { ...n, data: { ...n.data, block: nb } } : n;
    });
    const nextEdges = edges
      .filter((e) => !sel.has(e.source) && !sel.has(e.target))
      .map((e) => {
        // Цель/источник вне выделения уже отфильтрованы; чиним оставшиеся пары.
        return e;
      });
    for (const n of fixed) {
      const b = (n.data as NodeData).block;
      if (b.next === callId) {
        nextEdges.push({ id: `e-${b.id}-next`, source: b.id, target: callId, sourceHandle: 'next', markerEnd: { type: MarkerType.ArrowClosed } });
      }
      for (const [k, target] of Object.entries(b.branches ?? {})) {
        if (target === callId) {
          nextEdges.push({ id: `e-${b.id}-${k}`, source: b.id, target: callId, sourceHandle: handleIdFor('branch', k), label: k, animated: true, style: { stroke: '#f59e0b' }, markerEnd: { type: MarkerType.ArrowClosed } });
        }
      }
    }
    if (customStart && sel.has(customStart)) setCustomStart(callId);
    setNodes(fixed);
    setEdges(nextEdges);
    // Группы: удалённые блоки вычищаются; пустые рамки убираются.
    const nextGroups = groups
      .map((g) => ({ ...g, members: g.members.filter((m) => !sel.has(m)) }))
      .filter((g) => g.members.length);
    setGroups(nextGroups);
    prevSnap.current = { nodes: fixed, edges: nextEdges, groups: nextGroups };
    setSelected(callId);
    setUndoDepth(past.current.length);
    setRedoDepth(0);
    void loadSfLibrary();
    setStatus(t('sf.extracted', { name: String(created?.subflow?.name ?? '') }));
  }, [sfExtract, nodes, edges, groups, customStart, t, settings.language, setNodes, setEdges, loadSfLibrary]);

  // «Распаковать подсценарий» (обратная операция): блок вызова заменяется
  // КОПИЕЙ блоков текущей ревизии фрагмента. Связь с библиотекой теряется —
  // это осознанная «отмена» извлечения; полноценное раскрытие делает публикация.
  const explodeSubflow = useCallback(
    async (callId: string) => {
      const node = nodes.find((n) => n.id === callId);
      const block = node ? (node.data as NodeData).block : null;
      if (!block || block.type !== 'subflow') return;
      const sfId = String(block.params.subflowId ?? '');
      if (!sfId) return;
      try {
        const r = await api.subflows.get(sfId);
        const frag: Scenario = JSON.parse(r.subflow.flow_json);
        past.current.push({ nodes, edges, groups });
        if (past.current.length > 60) past.current.shift();
        future.current = [];
        const idMap = new Map<string, string>();
        for (const id of Object.keys(frag.blocks)) idMap.set(id, newId());
        const base = node?.position ?? { x: 200, y: 200 };
        const added: Node[] = [];
        let i = 0;
        for (const b of Object.values(frag.blocks)) {
          if (b.type === 'subflow_return') continue;
          const nid = idMap.get(b.id)!;
          const nb: Block = JSON.parse(JSON.stringify(b));
          nb.id = nid;
          if (nb.next) nb.next = idMap.get(nb.next) ?? '';
          if (nb.branches) for (const k of Object.keys(nb.branches)) nb.branches[k] = nb.branches[k] ? idMap.get(nb.branches[k]) ?? '' : '';
          if (nb.type === 'goto' && nb.params.target) nb.params.target = idMap.get(nb.params.target) ?? '';
          nb.position = { x: base.x + (i % 3) * 240, y: base.y + Math.floor(i / 3) * 150 };
          added.push({ id: nid, type: 'bot', position: nb.position, data: { block: nb } });
          i++;
        }
        const addedEdges: Edge[] = [];
        for (const n of added) {
          const b = (n.data as NodeData).block;
          if (b.next) addedEdges.push({ id: `e-${b.id}-next`, source: b.id, target: b.next, sourceHandle: 'next', markerEnd: { type: MarkerType.ArrowClosed } });
          for (const [k, target] of Object.entries(b.branches ?? {})) {
            if (target) addedEdges.push({ id: `e-${b.id}-${k}`, source: b.id, target, sourceHandle: handleIdFor('branch', k), label: k, animated: true, style: { stroke: '#f59e0b' }, markerEnd: { type: MarkerType.ArrowClosed } });
          }
        }
        const entryId = idMap.get(frag.start) ?? added[0]?.id ?? '';
        const doneTarget = block.branches?.done ?? '';
        const fixed = nodes
          .filter((n) => n.id !== callId)
          .map((n) => {
            const b = (n.data as NodeData).block;
            let changed = false;
            const nb: Block = { ...b };
            if (nb.next === callId) { nb.next = entryId; changed = true; }
            if (nb.branches) {
              const br = { ...nb.branches };
              for (const k of Object.keys(br)) if (br[k] === callId) { br[k] = entryId; changed = true; }
              if (changed) nb.branches = br;
            }
            if (nb.type === 'goto' && nb.params.target === callId) { nb.params = { ...nb.params, target: entryId }; changed = true; }
            return changed ? { ...n, data: { ...n.data, block: nb } } : n;
          });
        // Листы копии продолжают сценарий туда, куда вела ветка done вызова.
        if (doneTarget) {
          for (const n of added) {
            const b = (n.data as NodeData).block;
            if (!b.next && b.type !== 'end' && b.type !== 'goto' && !usesBranches(b.type)) {
              b.next = doneTarget;
              addedEdges.push({ id: `e-${b.id}-next`, source: b.id, target: doneTarget, sourceHandle: 'next', markerEnd: { type: MarkerType.ArrowClosed } });
            }
          }
        }
        const nextNodesAll = [...fixed, ...added];
        const nextEdges = [...edges.filter((e) => e.source !== callId && e.target !== callId), ...addedEdges];
        setNodes(nextNodesAll);
        setEdges(nextEdges);
        const nextGroups = groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== callId) })).filter((g) => g.members.length);
        setGroups(nextGroups);
        prevSnap.current = { nodes: nextNodesAll, edges: nextEdges, groups: nextGroups };
        setSelected(entryId || null);
        setUndoDepth(past.current.length);
        setRedoDepth(0);
        setStatus(t('sf.exploded'));
      } catch {
        setStatus(t('sf.loadError'));
      }
    },
    [nodes, edges, groups, setNodes, setEdges, t]
  );

  // «Обновить до ревизии N»: закрепляет вызов на свежей ревизии. Автообновления
  // нет и не будет — только явное действие автора (решение промпта).
  const updateSubflowCall = useCallback(
    (callId: string, revision: number) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== callId) return n;
          const b = (n.data as NodeData).block;
          return { ...n, data: { ...n.data, block: { ...b, params: { ...b.params, subflowRevision: revision } } } };
        })
      );
      setSfChecks((m) => {
        const next = new Map(m);
        next.delete(callId);
        return next;
      });
      setStatus(t('sf.callUpdated', { rev: revision }));
    },
    [setNodes, t]
  );

  // ---------------------------------------------------------------- горячие клавиши

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;

      // F3-302: модификаторные хоткеи — по ev.code: на русской раскладке
      // e.key даёт кириллицу (Ctrl+Z → 'я') и хоткей молча мёртв. Enter/
      // Delete/Escape — символьные, для них e.key корректен.
      if (mod && e.code === 'KeyS') {
        e.preventDefault();
        e.stopPropagation();
    void doSave();
        return;
      }
      if (mod && e.code === 'KeyF') {
        e.preventDefault();
        e.stopPropagation();
        setShowSearch((v) => !v);
        return;
      }
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.code === 'KeyY') {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }
      if (mod && e.code === 'KeyC') {
        e.preventDefault();
        e.stopPropagation();
        copySelection();
        return;
      }
      if (mod && e.code === 'KeyV') {
        e.preventDefault();
        e.stopPropagation();
        pasteClipboard();
        return;
      }
      if (e.key === 'Delete') {
        const ids = nodes.filter((n) => n.selected).map((n) => n.id);
        if (ids.length > 1) {
          e.preventDefault();
          deleteBlocks(ids);
        } else if (selected) {
          e.preventDefault();
          deleteBlocks([selected]);
        } else if (selectedGroupId) {
          // Выделена группа (не блоки) — Delete удаляет рамку, блоки остаются.
          e.preventDefault();
          removeGroup(selectedGroupId);
        }
        return;
      }
      if (e.key === 'Escape' && selectedGroupId) {
        setSelectedGroupId(null);
        return;
      }
      if (mod && e.code === 'KeyD') {
        const ids = nodes.filter((n) => n.selected).map((n) => n.id);
        if (ids.length > 1) {
          e.preventDefault();
          e.stopPropagation();
          duplicateBlocks(ids);
        } else if (selected) {
          e.preventDefault();
          e.stopPropagation();
          duplicateBlocks([selected]);
        }
      }
    };
    // Фаза перехвата (capture), а не всплытия: react-flow слушает клавиши на
    // своём wrapper и успевает съесть Ctrl+Z до того, как событие дойдёт до
    // window. В capture мы срабатываем первыми — откат работает при фокусе
    // где угодно на холсте. Защита от полей ввода сохранена.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    selected,
    selectedGroupId,
    nodes,
    deleteBlocks,
    duplicateBlocks,
    copySelection,
    pasteClipboard,
    undo,
    redo,
    doSave,
    removeGroup,
  ]);

  // ---------------------------------------------------------------- контекстное меню

  const openCtx = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setSelected(node.id);
    setCtx({ nodeId: node.id, x: e.clientX, y: e.clientY });
  }, []);

  // S3-05: меню — position:fixed по clientX/clientY; у правого/нижнего края
  // окна пункты уходили за viewport. Клампим к окну по РЕАЛЬНОМУ размеру уже
  // отрендеренного меню (число пунктов меняется: мультивыбор, профи-пункты),
  // а не по оценке. Второй проход эффекта видит x/y уже равными и состояние
  // не трогает — цикла нет.
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ctx) return;
    const el = ctxMenuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(ctx.x, window.innerWidth - r.width - 8));
    const y = Math.max(8, Math.min(ctx.y, window.innerHeight - r.height - 8));
    if (x !== ctx.x || y !== ctx.y) setCtx({ ...ctx, x, y });
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtx(null);
    };
    // НЕ вешаем закрытие на `contextmenu`: событие всплывает до window и тем же
    // кликом мгновенно гасит только что открытое меню (на 2-м ПКМ меню «моргает»).
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctx]);

  const issues = useMemo(() => validateScenario(scenario, { platform }), [scenario, platform]);
  const counts = useMemo(() => countIssues(issues), [issues]);
  const startId =
    customStart ?? nodes.find((n) => (n.data as NodeData).block.type === 'start')?.id ?? nodes[0]?.id ?? 'start';

  const conflicts = useMemo(
    () => (settings.feature_conflicts ? analyzeConflicts(scenario) : []),
    [scenario, settings.feature_conflicts]
  );
  const conflictMap = useMemo(() => groupConflicts(conflicts), [conflicts]);
  const conflictText = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, list] of conflictMap) m.set(id, list.map((c) => t(c.key, c.vars)).join(' · '));
    return m;
  }, [conflictMap, t]);

  const sleepActive = useMemo(
    () => (settings.feature_sleep && selected ? branchFrom(scenario, selected) : null),
    [settings.feature_sleep, selected, scenario]
  );

  const hints = useMemo<CanvasHints>(
    () => ({
      conflicts: conflictMap,
      conflictText,
      sleepActive,
      tFrozen: t('node.frozen'),
      connectFrom,
      onPortClick,
      connectTargetHint,
      lang: settings.language,
      sfStatus: sfChecks,
      sfLabels: { outdated: t('sf.badge.outdated'), missing: t('sf.badge.missing'), cycle: t('sf.badge.cycle') },
      // Двойной клик по узлу: вход в фрагмент подсценария (drill-in).
      onNodeDoubleClick: (nodeId: string) => {
        const b = nodes.find((n) => n.id === nodeId)?.data as NodeData | undefined;
        if (b?.block.type === 'subflow' && b.block.params.subflowId && !sfEditing) {
          void enterSubflow(String(b.block.params.subflowId));
        }
      },
      onConflictClick: (id: string) => {
        setSelected(id);
        setStatus(conflictText.get(id) ?? '');
      },
    }),
    [conflictMap, conflictText, sleepActive, t, connectFrom, onPortClick, connectTargetHint, settings.language, sfChecks, nodes, sfEditing, enterSubflow]
  );

  useEffect(() => {
    if (!explain) return;
    const close = () => setExplain(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExplain(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [explain]);

  const explainBlock = explain
    ? (nodes.find((n) => n.id === explain.blockId)?.data as NodeData | undefined)?.block
    : undefined;

  // Закрываем поповер конфликтов по клику вне и по Escape.
  useEffect(() => {
    if (!showConflicts) return;
    const close = () => setShowConflicts(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [showConflicts]);

  // Режим соединения кликом отменяется по Escape: это единственный способ
  // выйти из него, если цель не найдена.
  useEffect(() => {
    if (!connectFrom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConnectFrom(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectFrom]);

  useEffect(() => {
    if (!showConflicts) return;
    const trigger = document.querySelector<HTMLElement>('.conflict-btn');
    if (!trigger) return;
    const width = 320;
    const height = Math.min(340, window.innerHeight - 24);
    const update = () => {
      const rect = trigger.getBoundingClientRect();
      setPopoverPosition({
        top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - height - 12)),
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [showConflicts]);

  // Уровень задаёт только ДЕФОЛТ режима: новичок получает раскрытую панель,
  // пока сам не выбрал другое. Раньше `pinned` перебивал настройку на каждом
  // рендере, поэтому выбранный режим «slide» у новичка не работал вовсе.
  useEffect(() => {
    if (!settingsLoaded) return;
    ensureTopbarMode(settings.skill_level);
  }, [settingsLoaded, settings.skill_level]);

  // Зона выезда панели: невидимая полоса у верхней кромки ОКНА (а не только
  // сама полоса 30px). Слушаем движение курсора в capture-фазе, чтобы попадание
  // в зону не зависело от того, какой элемент оказался под курсором.
  useEffect(() => {
    if (barMode !== 'slide') {
      setNearTop(false);
      return;
    }
    const onMove = (e: MouseEvent) => setNearTop(e.clientY <= TOPBAR_TRIGGER_HEIGHT);
    // Курсор уходит за пределы окна, вкладка теряет фокус — снимаем залипание.
    // Раньше `nearTop` обновлялся только через mousemove: если указатель покидал
    // окно, находясь сверху, флаг оставался true навсегда и панель не закрывалась.
    const release = () => setNearTop(false);
    window.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseleave', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseleave', release);
      window.removeEventListener('blur', release);
    };
  }, [barMode]);

  // Сворачивание с задержкой: без неё переход с полосы на раскрытую строку
  // мигал — курсор на мгновение оказывался вне панели.
  const [barHoverHeld, setBarHoverHeld] = useState(false);
  const hoverTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const enterBar = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    setBarHoverHeld(true);
  }, []);
  const leaveBar = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      setBarHoverHeld(false);
      setBarOpen(false);
    }, 240);
  }, []);

  // Закрываем меню «ещё» и поповер режима по клику вне и по Escape — как
  // остальные поповеры в приложении.
  useEffect(() => {
    if (!showBarMore) return;
    const close = () => setShowBarMore(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [showBarMore]);

  useEffect(() => {
    if (!showHelp) return;
    const close = () => setShowHelp(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [showHelp]);

  // ---------------------------------------------------------------- прочее

  // Прогон на сервере: передаём сценарий без позиций, чтобы протяжка блока
  // не перезапускала прогон (structureKey меняется только по содержимому).
  const previewJson = useMemo(() => {
    const sc = graphToScenario(nodes, edges, customStart);
    for (const k of Object.keys(sc.blocks)) delete (sc.blocks[k] as any).position;
    return JSON.stringify(sc);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [structureKey]);

  const loadTemplate = useCallback(
    (tpl: { id: string; name: string; scenario: Scenario }, mode: 'replace' | 'append') => {
      const g = scenarioToGraph(tpl.scenario);
      const tplGroups = sanitizeGroups((tpl.scenario as CanvasScenario).groups);
      if (mode === 'replace' || !nodes.length) {
        setNodes(g.nodes);
        setEdges(g.edges);
        setGroups(tplGroups);
        setCustomStart(tpl.scenario.start);
      } else {
        // Добавляем справа от существующего: новые id, чтобы не конфликтовать.
        const maxX = Math.max(...nodes.map((n) => n.position.x));
        const ids = g.nodes.map((n) => n.id);
        const copy = copySubgraph(g.nodes, g.edges, ids, 0);
        const dx = maxX + 340;
        setNodes((nds) => [...nds, ...copy.nodes.map((n) => ({ ...n, position: { x: n.position.x + dx, y: n.position.y } }))]);
        setEdges((eds) => [...eds, ...copy.edges]);
        // Группы шаблона переезжают вместе с блоками (id свежие, сдвиг тот же).
        const gs = copiedGroups(tplGroups, copyIdMap(g.nodes, ids, copy.nodes), dx, 0);
        if (gs.length) setGroups((cur) => [...cur, ...gs]);
      }
      setStatus(t('status.template', { name: tpl.name }));
    },
    [nodes, setNodes, setEdges, t]
  );

  const tidyUp = useCallback(() => {
    setNodes((nds) => autoLayout(nds, edges, startId));
    setStatus(t('status.tidy'));
  }, [setNodes, edges, startId, t]);

  const focusBlock = useCallback(
    (id: string) => {
      setSelected(id);
      setSelectedGroupId(null);
      // Блок может лежать в свёрнутой группе — раскрываем её, иначе фокус
      // уедет в пустое место (видимое состояние, не шаг истории).
      setGroups((gs) =>
        gs.some((g) => g.collapsed && g.members.includes(id))
          ? gs.map((g) => (g.collapsed && g.members.includes(id) ? { ...g, collapsed: false } : g))
          : gs
      );
      const n = getNode(id);
      if (n) setCenter(n.position.x + 110, n.position.y + 50, { zoom: 1.1, duration: 400 });
      setShowSearch(false);
    },
    [getNode, setCenter, setGroups]
  );

  const showStats = useCallback(async () => {
    setStatsLoading(true);
    setStats({ loading: true });
    try {
      setStats(await api.getStats(botId));
    } catch {
      setStats({ error: true });
    } finally {
      setStatsLoading(false);
    }
  }, [botId]);

  const statsBody = (
    <ExitHost open={!!stats}>
    <div className="modal-backdrop" onClick={() => setStats(null)}>
      <div ref={statsModalRef} className="modal stats-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="modal-head-text">
            <h2 className="modal-title">{t('stats.title')}</h2>
          </div>
          <button
            className="ghost icon-btn"
            onClick={() => setStats(null)}
            title={t('common.close.title')}
            aria-label={t('common.close.title')}
          >
            <X />
          </button>
        </header>
        <div className="modal-body">
          {/* stats до первой загрузки — null; JSX модалки вычисляется на КАЖДОМ
              рендере (ExitHost рендерит детей даже при open=false), поэтому все
              обращения обязаны быть null-safe. Раньше здесь падал
              «Cannot read properties of null (reading 'loading')» и без error
              boundary размонтировал всё дерево — холст выглядел серой страницей. */}
          {statsLoading || stats?.loading ? <p className="muted">{t('stats.loading')}</p> : stats?.error ? <div className="err">{t('stats.error')}</div> : (
            (stats?.users ?? 0) + (stats?.steps ?? 0) + (stats?.lastScenarios ?? 0) + (stats?.subscribers ?? 0) === 0
              ? <p className="muted">{t('stats.empty')}</p>
              : <div className="stats-grid">
                  <div><b>{stats?.users ?? 0}</b><span>{t('stats.users')}</span></div>
                  <div><b>{stats?.steps ?? 0}</b><span>{t('stats.steps')}</span></div>
                  <div><b>{stats?.lastScenarios ?? 0}</b><span>{t('stats.versions')}</span></div>
                  <div><b>{stats?.subscribers ?? 0}</b><span>{t('stats.subscribers')}</span></div>
                </div>
          )}
        </div>
        {/* Просмотр статистики ничего не подтверждает: единственная кнопка
            подвала — закрытие, поэтому она не primary. */}
        <footer className="modal-foot">
          <button className="ghost" onClick={() => setStats(null)}>{t('common.close')}</button>
        </footer>
      </div>
    </div>
    </ExitHost>
  );

  // Список таблиц бота для блока «Данные». Не критично, если не загрузился:
  // инспектор покажет подсказку «создайте таблицу».
  useEffect(() => {
    api
      .collections(botId)
      .then((r) => setCollections(r.collections ?? []))
      .catch(() => setCollections([]));
  }, [botId]);

  const ctxBlock = ctx ? (nodes.find((n) => n.id === ctx.nodeId)?.data as NodeData | undefined)?.block : undefined;
  // Если выделено несколько блоков и ПКМ был по одному из них — применяем ко всему выделению.
  const ctxTargets = useMemo(() => {
    if (!ctx) return [];
    if (selectedIds.length > 1 && selectedIds.includes(ctx.nodeId)) return selectedIds;
    return [ctx.nodeId];
  }, [ctx, selectedIds]);
  const multi = ctxTargets.length > 1;

  const selectedBlock = nodes.find((n) => n.id === selected)?.data as NodeData | undefined;

  const labelOfBlock = useCallback(
    (id: string) => {
      const b = nodes.find((n) => n.id === id)?.data as NodeData | undefined;
      return b ? nodeLabel(b.block, settings.language) : id;
    },
    [nodes, settings.language]
  );

  // Одно действие панели по его id. Кнопки не дублируют разметку в трёх
  // кластерах: раскладка описана данными (topbarActions.ts), а здесь — только
  // поведение. Меню «ещё» и панель зовут один и тот же обработчик.
  const runBarAction = useCallback(
    (id: TopbarActionId) => {
      switch (id) {
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'search':
          setShowSearch((v) => !v);
          break;
        case 'tidy':
          tidyUp();
          break;
        case 'vars':
          setShowVars(true);
          break;
        case 'stats':
          void showStats();
          break;
        case 'logs':
          setShowLogs(true);
          break;
        case 'shortcuts':
          setShowShortcuts(true);
          break;
        case 'versions':
          setShowVersions(true);
          break;
        case 'guide':
          setShowGuide(true);
          break;
        case 'settings':
          setShowSettings(true);
          break;
        case 'catalog':
          onOpenCatalog?.(JSON.stringify(scenario));
          break;
        case 'data':
          onOpenData?.();
          break;
        case 'tour':
          setShowTour(true);
          break;
        case 'templates':
          setShowTemplates(true);
          break;
        case 'preview':
          setShowPreview((v) => !v);
          break;
        case 'save':
          void doSave();
          break;
        case 'publish':
          setShowPublish(true);
          break;
      }
    },
    [undo, redo, tidyUp, showStats, onOpenCatalog, onOpenData, scenario, doSave]
  );

  // Кнопка действия: в панели — короткая подпись (у части пунктов иконка),
  // в меню «ещё» — всегда текстовая подпись, иначе меню нечитаемо.
  //
  // Иконка в меню — не украшение: список из десяти строк без ориентиров
  // читается как простыня, а иконка даёт глазу точку опоры.
  const actionIcon = (id: TopbarActionId): React.ReactNode => {
    switch (id) {
      case 'undo':
        return <Undo />;
      case 'redo':
        return <Redo />;
      case 'search':
        return <Search />;
      case 'vars':
        return <Braces />;
      case 'stats':
        return <BarChart />;
      case 'versions':
        return <History />;
      case 'guide':
        return <BookOpen />;
      case 'tour':
        return <Compass />;
      case 'shortcuts':
        return <Keyboard />;
      case 'templates':
        return <LayoutTemplate />;
      case 'catalog':
        return <FolderTree />;
      case 'data':
        return <Database />;
      case 'settings':
        return <Settings />;
      case 'preview':
        return <Play />;
      case 'publish':
        return <Rocket />;
      case 'save':
        return <Save />;
      default:
        return null;
    }
  };

  const barButton = (
    id: TopbarActionId,
    opts?: { icon?: React.ReactNode; className?: string; disabled?: boolean; title?: string; label?: string }
  ) => {
    const action = TOPBAR_ACTIONS.find((a) => a.id === id);
    const label = opts?.label ?? (action ? t(action.label) : id);
    return (
      <button
        key={id}
        className={opts?.className}
        disabled={opts?.disabled}
        title={opts?.title ?? label}
        aria-label={label}
        onClick={() => runBarAction(id)}
      >
        {opts?.icon}
        {label}
      </button>
    );
  };

  // F10/F11: полоса всегда видна, остальное раскрывается по режиму панели.
  const barExpanded = topbarExpanded(barMode, {
    hover: barHoverHeld || nearTop,
    open: barOpen,
  });
  const barToggleShown = topbarToggleVisible(barMode);

  const stripState = saving ? t('save.saving') : dirty ? t('save.dirty') : t('save.saved');

  return (
    <div className="constructor" ref={wrapRef}>
      <header
        className={`constructor-top bar${barExpanded ? ' open' : ''}${barMode === 'always' ? ' always' : ''}${isPro ? ' compact' : ''}`}
        onMouseEnter={enterBar}
        onMouseLeave={leaveBar}
      >
        {/* Всегда видно: выход, имя бота, состояние сохранения, конфликты.
            Если автор не видит, сохранён ли сценарий, свёрнутая панель — ловушка. */}
        <div className="bar-strip">
          <button className="back-control" onClick={sfEditing ? exitSubflow : onBack} aria-label={sfEditing ? t('sf.backToBot') : t('nav.toBots')}>
            <ArrowLeft />
            {sfEditing ? t('sf.backToBot') : t('nav.toBots')}
          </button>
          {/* Хлебные крошки drill-in: «Мой бот / Отправка меню (rev N)». */}
          {sfEditing ? (
            <span className="bot-name">
              <span className="muted">{name}</span>
              <span className="sf-crumb-sep" aria-hidden="true"> / </span>
              {sfEditing.name}
              <span className="badge neutral sf-crumb-rev">rev {sfEditing.revision}</span>
            </span>
          ) : (
            <span className="bot-name">{name}</span>
          )}
          <span className={`save-state${dirty ? ' dirty' : ''}`} title={t('save.title')}>
            {stripState}
          </span>
          {status && (
            <span className="status" role="status" aria-live="polite">
              {status}
              {/* S3-09: кнопка «Повторить» показывается по точному совпадению
                  с текстом последней ошибки сохранения (saveErrorStatus), а не
                  по подстрокам «не удалось/failed» — эвристика зависела от
                  языка и формулировок (WU-02 чинил регистр, это убирает сам
                  класс проблемы). */}
              {status === saveErrorStatus && (
                <button className="ghost status-retry" onClick={() => void doSave()} disabled={saving}>
                  {t('common.retry')}
                </button>
              )}
            </span>
          )}
          {settings.feature_conflicts && conflicts.length > 0 && (
            <div className="pill-wrap" onClick={(e) => e.stopPropagation()}>
              <button
                className="pill warn conflict-btn"
                onClick={() => {
                  const next = nextPopoverState('conflicts', showConflicts);
                  setShowConflicts(next.conflicts);
                }}
                title={t('conflict.pill', { n: conflicts.length })}
                aria-haspopup="listbox"
                aria-expanded={showConflicts}
              >
                <AlertTriangle size={12} />
                {conflicts.length}
              </button>
              {showConflicts && popoverPosition && createPortal(
                <div className="conflict-pop" style={popoverPosition} role="listbox" aria-label={t('conflict.list.title')} onClick={(e) => e.stopPropagation()}>
                  <div className="conflict-pop-head">{t('conflict.list.title')}</div>
                  {/* Ошибки — первыми; warn-секция (набор 2026-09) — мягче и ниже. */}
                  {conflicts.filter((c) => conflictLevel(c) === 'error').map((c, idx) => {
                    const b = nodes.find((n) => n.id === c.blockId)?.data as NodeData | undefined;
                    return (
                      <button
                        key={`${c.blockId}-${c.code}-${idx}`}
                        className="conflict-item"
                        onClick={() => {
                          focusBlock(c.blockId);
                          setShowConflicts(false);
                        }}
                      >
                        <span className="dot" style={{ background: (b && BLOCK_META[b.block.type]?.color) || '#64748b' }} />
                        <span className="conflict-item-label">{labelOfBlock(c.blockId)}</span>
                        <span className="muted">{t(c.key, c.vars)}</span>
                      </button>
                    );
                  })}
                  {conflicts.some((c) => conflictLevel(c) === 'warn') && (
                    <div className="conflict-pop-subhead">{t('conflict.list.warnings')}</div>
                  )}
                  {conflicts.filter((c) => conflictLevel(c) === 'warn').map((c, idx) => {
                    const b = nodes.find((n) => n.id === c.blockId)?.data as NodeData | undefined;
                    return (
                      <button
                        key={`w-${c.blockId}-${c.code}-${idx}`}
                        className="conflict-item warn"
                        onClick={() => {
                          focusBlock(c.blockId);
                          setShowConflicts(false);
                        }}
                      >
                        <span className="dot" style={{ background: (b && BLOCK_META[b.block.type]?.color) || '#64748b' }} />
                        <span className="conflict-item-label">{labelOfBlock(c.blockId)}</span>
                        <span className="muted">{t(c.key, c.vars)}</span>
                      </button>
                    );
                  })}
                </div>, document.body
              )}
            </div>
          )}
          <div className="spacer" />
          {/* На тач-устройстве тап по полосе раскрывает панель: жест, который
              видно, в отличие от свайпа. На десктопе уже работает наведение.
              В режиме «всегда видна» и у новичка раскрывать нечего — кнопки нет. */}
          {barToggleShown && (
            <button
              className="ghost bar-toggle"
              aria-expanded={barExpanded}
              aria-label={t('bar.toggle')}
              title={t('bar.toggle')}
              onClick={() => setBarOpen((v) => !v)}
            >
              <span className="bar-caret" aria-hidden="true">
                <ChevronDown aria-label={undefined} role={undefined} />
              </span>
            </button>
          )}
        </div>

        {/* Раскрытая часть панели. Смонтирована ВСЕГДА: видимость задаёт класс
            `open` у заголовка. Пока узел монтировался/размонтировался по условию,
            нечего было анимировать на выходе, фокус терялся, и slide-down
            проигрывался заново на каждом изменении состояния. */}
        <div className="bar-row">
          {/* Зона 1 — действия сценария. Кластер частых действий; ко меди здесь
              ровно одна кнопка (Publish), остальное — вторичная обводка. */}
          <div className="topbar-group" role="group" aria-label={t('editor.group.run')}>
            {/* Режим фрагмента: вместо превью/публикации бота — сохранение
                ревизии и «Проверить фрагмент» (прогон настоящим движком). */}
            {sfEditing ? (
              <>
                <button className="secondary" onClick={() => void doSave()} disabled={saving}>
                  <Save />
                  {t('sf.save')}
                </button>
                <button className="secondary" onClick={() => void checkSubflow()} disabled={saving}>
                  <Play />
                  {t('sf.check')}
                </button>
              </>
            ) : (
            primaryActions().map((a) => {
              const opts: Record<string, Parameters<typeof barButton>[1]> = {
                preview: {
                  className: 'secondary',
                  icon: showPreview ? undefined : <Play />,
                  disabled: counts.errors > 0,
                  title: counts.errors > 0 ? t('editor.errors.title') : undefined,
                  label: showPreview ? t('editor.edit') : t('editor.preview'),
                },
                save: { className: 'secondary', icon: <Save size={15} />, disabled: saving },
                publish: { className: 'primary', icon: <Rocket size={15} />, disabled: counts.errors > 0 },
              };
              return (
                <Fragment key={a.id}>
                  {barButton(a.id, opts[a.id])}
                  {/* Счётчик ошибок держится рядом с «Превью»: он объясняет,
                      почему кнопка неактивна. */}
                  {a.id === 'preview' && counts.errors > 0 && (
                    <button
                      className="pill bad"
                      onClick={() => setShowPublish(true)}
                      title={t('editor.errors.title')}
                      aria-label={t('editor.errors.title')}
                    >
                      <X size={12} />
                      {counts.errors}
                    </button>
                  )}
                </Fragment>
              );
            })
            )}
          </div>

          <span className="spacer" />

          {/* Зона 2 — обвязка. Ровно одна кнопка меню и один вход в помощь:
              шестерёнка режима панели жила здесь же и дублировала «Настройки». */}
          <div className="topbar-group topbar-chrome">
            <div className="pill-wrap" onClick={(e) => e.stopPropagation()}>
              <button
                className="ghost more-btn"
                title={t('bar.help')}
                aria-label={t('bar.help')}
                aria-haspopup="menu"
                aria-expanded={showHelp}
                onClick={() => {
                  setShowBarMore(false);
                  setShowHelp((v) => !v);
                }}
              >
                <HelpCircle />
              </button>
              {showHelp && (
                <div
                  className="conflict-pop more-pop"
                  role="menu"
                  aria-label={t('bar.help.title')}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="conflict-pop-head">{t('bar.help.title')}</div>
                  <div className="more-row" role="none">
                    {/* Словарь живёт внутри гайдов (вкладка), отдельного пункта
                        для него нет — поэтому здесь только три входа. */}
                    {(['guide', 'tour', 'shortcuts'] as const)
                      .filter((id) => id !== 'shortcuts' || isPro)
                      .map((id) => {
                        const a = TOPBAR_ACTIONS.find((x) => x.id === id)!;
                        return (
                          <button
                            key={id}
                            className="conflict-item"
                            role="menuitem"
                            onClick={() => {
                              setShowHelp(false);
                              runBarAction(id);
                            }}
                          >
                            {actionIcon(id)}
                            {t(a.label)}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            <div className="pill-wrap" onClick={(e) => e.stopPropagation()}>
              <button
                className="ghost more-btn"
                title={t('bar.more')}
                aria-label={t('bar.more')}
                aria-haspopup="menu"
                aria-expanded={showBarMore}
                onClick={() => {
                  setShowHelp(false);
                  setShowBarMore((v) => !v);
                }}
              >
                <MoreHorizontal />
              </button>
              {showBarMore && (
                <div className="conflict-pop more-pop" role="menu" aria-label={t('bar.more.title')} onClick={(e) => e.stopPropagation()}>
                  <div className="more-row" role="none">
                    {/* Справка и разделы аккаунта вычтены: у справки свой вход,
                        каталог и «данные» живут на дашборде. */}
                    {editorOverflowActions()
                      .filter((a) => a.id !== 'shortcuts' || isPro)
                      .map((a) => (
                        <button
                          key={a.id}
                          className="conflict-item"
                          role="menuitem"
                          disabled={a.id === 'undo' ? !undoDepth : a.id === 'redo' ? !redoDepth : false}
                          onClick={() => {
                            setShowBarMore(false);
                            runBarAction(a.id);
                          }}
                        >
                          {actionIcon(a.id)}
                          {t(a.label)}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <ExitHost open={showSettings}>
        <SettingsModal onClose={() => setShowSettings(false)} />
      </ExitHost>
      {statsBody}
      {showTour && <OnboardingTour onDone={closeTour} />}

      {draft && (
        <div className="draft-bar">
          <span>
            {t('draft.found', {
              when: new Date(draft.ts).toLocaleString(settings.language === 'en' ? 'en-GB' : 'ru-RU'),
              n: Object.keys(draft.scenario.blocks).length,
            })}
          </span>
          <button className="primary" onClick={restoreDraft}>
            {t('draft.restore')}
          </button>
          <button className="ghost" onClick={dropDraft}>
            {t('draft.drop')}
          </button>
        </div>
      )}

      {/* F-015: конфликт версий сценария. Сохранение отклонено сервером —
          сценарий изменили в другой вкладке. Выбор действия явный: молчаливая
          перезапись вернула бы last-write-wins, который и чиним. */}
      {versionConflict && (
        <div className="draft-bar conflict-bar" role="alert">
          <span>{t('status.versionConflict')}</span>
          <button className="primary" onClick={reloadConflict}>
            {t('conflict.reload')}
          </button>
          <button className="ghost" onClick={overwriteConflict} disabled={saving}>
            {t('conflict.overwrite')}
          </button>
        </div>
      )}

      <div className="workspace">
        <div className="palette">
          {/* Поиск по палитре. Компенсирует лишний клик, который появился
              из-за сворачивания групп: ищем по именам блоков и групп. */}
          <div className="palette-search">
            <input
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              placeholder={t('palette.search.placeholder')}
              aria-label={t('palette.search.placeholder')}
            />
            {paletteQuery && (
              <button
                className="ghost icon-btn palette-search-clear"
                onClick={() => setPaletteQuery('')}
                title={t('palette.search.clear')}
                aria-label={t('palette.search.clear')}
              >
                <X />
              </button>
            )}
          </div>

          {(() => {
            const searching = !!normalizeSearch(paletteQuery);
            // Группа «Продвинутые» у новичка скрыта, пока он сам не включит её
            // тумблером внизу палитры (advanced_blocks живёт на сервере).
            // Средний и высокий уровни видят её всегда.
            const groups = visiblePaletteGroups(PALETTE_GROUPS, {
              skillLevel: level,
              advancedEnabled: settings.advanced_blocks,
            }).map((g) => ({
              ...g,
              // «Возврат» вставляется только при редактировании фрагмента;
              // «Подсценарий» (вызов) — только в сценарии бота. Иначе блок
              // вызова внутри фрагмента и терминал в боте — гарантированные
              // ошибки валидации, которые лучше не дать создать.
              // VK-боту недоступны Telegram-only блоки (матрица shared/platform.ts):
              // палитра их не показывает, чтобы автор не собирал сценарий,
              // который публикация отклонит.
              items: g.items.filter((type) =>
                (type === 'subflow_return' ? !!sfEditing : type === 'subflow' ? !sfEditing : true) &&
                blockSupportedOn(type, platform)
              ),
            }));
            const matches = searching
              ? matchPalette(paletteQuery, groups, (type) => BLOCK_META[type].label, (key) => t(key))
              : null;
            // При пустом поиске рисуем все группы со своим состоянием раскрытия;
            // при активном — только совпадения, принудительно раскрытые.
            // openGroups при этом не трогаем: когда запрос очистят, прежнее
            // состояние раскрытия пользователя восстанавливается само.
            const visible = searching
              ? (matches ?? []).map((m) => ({
                  group: groups.find((g) => g.id === m.groupId)!,
                  items: m.blocks,
                  expanded: true,
                }))
              : groups.map((g) => ({
                  group: g,
                  items: g.items,
                  expanded: openGroups.includes(g.id),
                }));

            if (searching && !visible.length) {
              return <div className="palette-empty muted">{t('palette.search.empty')}</div>;
            }

            return visible.map(({ group, items, expanded }) => {
              // Группа без видимых блоков не должна оставлять пустую оболочку.
              if (!items.length) return null;
              return (
              <div key={group.id} className="palette-group">
                <button
                  type="button"
                  className={`palette-group-title${expanded ? ' open' : ''}`}
                  aria-expanded={expanded}
                  aria-controls={`palette-group-${group.id}`}
                  onClick={() => {
                    if (searching) return; // поиск сам управляет раскрытием
                    setOpenGroups((prev) => nextOpenGroups(settings.palette_mode, prev, group.id));
                  }}
                >
                  {/* В свёрнутом виде — заголовок и число блоков: так видно,
                      стоит ли группу раскрывать. */}
                  <span className="palette-caret" aria-hidden="true">
                    {expanded ? <ChevronDown /> : <ChevronRight />}
                  </span>
                  {t(group.title)}
                  {!searching && <span className="palette-group-count muted">{groupCount(items.length)}</span>}
                </button>
                {expanded && (
                  <div id={`palette-group-${group.id}`} className="palette-group-items">
                    {items.map((item) => (
                      <div
                        key={item}
                        className={`palette-item${level === 'low' && settings.hints_enabled ? ' beginner-item' : ''}`}
                        draggable
                        style={{
                          borderColor: BLOCK_META[item].color,
                          // Цвет блока — CSS-переменной: по ней строится
                          // акцентная полоска, различимая на узких экранах.
                          '--block-color': BLOCK_META[item].color,
                        } as React.CSSProperties}
                        onDragStart={(e) => e.dataTransfer.setData('application/botblock', item)}
                        onClick={() => addBlock(item)}
                        title={`${BLOCK_META[item].hint}\n\n${t('palette.dragHint')}`}
                      >
                        <span className="dot" style={{ background: BLOCK_META[item].color }} />
                        <span className="palette-item-text">
                          {BLOCK_META[item].label}
                          {/* Новичку имя блока ничего не говорит — показываем,
                              что он делает, прямо в списке. Остальным — в title. */}
                          {level === 'low' && settings.hints_enabled && (
                            <span className="palette-item-hint">{BLOCK_META[item].hint}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            });
          })()}
          {/* Тумблер «Продвинутые блоки» — только новичку, у которого группа
              скрыта. Включение пишется в серверную настройку advanced_blocks,
              второго локального флага нет. */}
          {level === 'low' && !settings.advanced_blocks && (
            <button
              type="button"
              className="palette-advanced-toggle ghost"
              title={t('palette.advanced.hint')}
              onClick={() => {
                void updateSettings({ advanced_blocks: true });
                // Тумблер «открывает» группу: в аккордеоне она становится
                // единственной открытой, в свободном режиме — добавляется.
                setOpenGroups((prev) =>
                  settings.palette_mode === 'accordion'
                    ? ['advanced']
                    : prev.includes('advanced')
                      ? prev
                      : [...prev, 'advanced']
                );
              }}
            >
              {t('palette.advanced.toggle', { n: PALETTE_GROUPS.find((g) => g.id === 'advanced')?.items.length ?? 0 })}
            </button>
          )}
          <div className="palette-hint muted">{t('palette.hint')}</div>
        </div>

        <div
          className="canvas"
          ref={canvasRef}
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onMouseMove={(e) => {
            const chip = whatIfRef.current;
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!chip || !rect) return;
            chip.style.left = `${e.clientX - rect.left + 16}px`;
            chip.style.top = `${e.clientY - rect.top + 16}px`;
          }}
        >
          {/* Локальный boundary холста (A4): исключение в рендере схемы не
              должно размонтировать весь интерфейс — показываем карточку с
              текстом ошибки и перезагрузкой. */}
          <ErrorBoundary
            onError={(e) => console.error('[constructor] canvas render error, bot', botId, e)}
            renderFallback={(e) => (
              <div className="empty-canvas" style={{ position: 'absolute', inset: 0 }}>
                <div className="empty-canvas-inner">
                  <p className="err">{t('canvas.renderError', { message: errorToMessage(e) })}</p>
                  <button className="primary" onClick={() => window.location.reload()}>
                    {t('error.reload')}
                  </button>
                </div>
              </div>
            )}
          >
          <CanvasHintsContext.Provider value={hints}>
            <ReactFlow
              nodes={displayNodes}
              edges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onConnectStart={(_, params) => {
                if (!settings.feature_whatif) return;
                const b = params.nodeId
                  ? (nodes.find((n) => n.id === params.nodeId)?.data as NodeData | undefined)?.block
                  : undefined;
                if (b && WHAT_IF[b.type]) setWhatIf(t(WHAT_IF[b.type]));
              }}
              onConnectEnd={() => setWhatIf(null)}
              nodeTypes={nodeTypes}
              onNodeClick={(e, n) => {
                // В режиме соединения клик по блоку завершает его, иначе — обычно
                // выделение. Цель Ctrl — не даём канвасу увести выделение в пустоту.
                if (connectFrom && connectFrom.nodeId !== n.id) {
                  e.stopPropagation();
                  finishConnect(n.id);
                  return;
                }
                setSelected(n.id);
                setSelectedGroupId(null);
              }}
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              onNodeContextMenu={openCtx}
              onPaneContextMenu={(e) => {
                e.preventDefault();
                setCtx(null);
              }}
              onPaneClick={() => {
                if (connectFrom) cancelConnect();
                setSelected(null);
                setSelectedGroupId(null);
              }}
              fitView
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2a2f3d" />
              <Controls />
              {/* Визуальные группы: координаты flow, под блоками (z-index в CSS). */}
              <ViewportPortal>
                {groups.map((g) => (
                  <CanvasGroupView
                    key={g.id}
                    group={g}
                    selected={selectedGroupId === g.id}
                    labels={groupLabels}
                    countLabel={groupCount}
                    onClick={onGroupClick}
                    onRename={renameGroup}
                    onColor={recolorGroup}
                    onToggleCollapse={toggleCollapseGroup}
                    onDelete={removeGroup}
                    onHeaderPointerDown={beginGroupMove}
                    onResizePointerDown={beginGroupResize}
                  />
                ))}
              </ViewportPortal>
            </ReactFlow>
          </CanvasHintsContext.Provider>
          </ErrorBoundary>
          {/* Явные состояния холста (A4): загрузка, сбой загрузки. Карточки
              абсолютные — лежат поверх области холста, кнопки кликабельны
              (pointer-events у .empty-canvas-inner button восстановлены). */}
          {!hydrated && !showPreview && (
            <div className="empty-canvas" style={{ position: 'absolute', inset: 0 }}>
              <div className="empty-canvas-inner">
                <p className="muted">{t('canvas.loading')}</p>
              </div>
            </div>
          )}
          {hydrated && loadFailed && !showPreview && (
            <div className="empty-canvas" style={{ position: 'absolute', inset: 0 }}>
              <div className="empty-canvas-inner">
                <p className="err">{t('status.noScenario')}</p>
                <button className="primary" onClick={retryLoad}>
                  {t('common.retry')}
                </button>
              </div>
            </div>
          )}
          {whatIf && (
            <div className="whatif" ref={whatIfRef}>
              <b>{t('whatif.title')}</b>
              <span>{whatIf}</span>
            </div>
          )}
          {showSearch && <SearchPanel nodes={nodes} onPick={focusBlock} onClose={() => setShowSearch(false)} />}
          {/* Режим соединения кликом должен быть очевиден: без подписи человек
              не поймёт, почему холст «залип» и что делать дальше. */}
          {connectFrom && (
            <div className="connect-banner" role="status">
              {t('connect.hint')}
              <button className="ghost" onClick={cancelConnect}>
                {t('common.cancel')}
              </button>
            </div>
          )}
          {/* Устаревшие вызовы подсценариев: бейджи на узлах + баннер с явным
              действием. Автообновления нет никогда — решает автор. */}
          {!sfEditing && [...sfChecks.entries()].some(([, s]) => s.status === 'outdated') && (
            <div className="connect-banner sf-stale-banner" role="status">
              {t('sf.staleBanner', {
                n: [...sfChecks.values()].filter((s) => s.status === 'outdated').length,
              })}
              <button
                className="ghost"
                onClick={() => {
                  for (const [blockId, s] of sfChecks.entries()) {
                    if (s.status === 'outdated' && s.latestRevision != null) updateSubflowCall(blockId, s.latestRevision);
                  }
                }}
              >
                {t('sf.updateAll')}
              </button>
            </div>
          )}
          {/* Подсказка пустого холста — только когда сценарий реально загружен:
              во время загрузки и после её сбоя показаны карточки состояний. */}
          {hydrated && !loadFailed && nodes.length === 0 && (
            <div className="empty-canvas">
              <div className="empty-canvas-inner">
                <div className="empty-icon">
                  <CornerDownRight size={24} />
                </div>
                <h3>{t('empty.title')}</h3>
                <p className="muted">
                  {/* Новичку пустой холст предлагает собрать бота, а не читать
                      справку: шаблоны уже есть и делают всю работу. */}
                  {level === 'low' && settings.hints_enabled ? t('empty.beginner.text') : t('empty.text1')}
                  <br />
                  {t('empty.text2')}
                </p>
                {level === 'low' && settings.hints_enabled ? (
                  <div className="row-actions">
                    <button className="primary" onClick={() => setShowTemplates(true)}>
                      {t('empty.beginner.template')}
                    </button>
                    <button onClick={() => setShowGuide(true)}>{t('empty.cta')}</button>
                  </div>
                ) : (
                  <button className="primary" onClick={() => setShowGuide(true)}>
                    {t('empty.cta')}
                  </button>
                )}
              </div>
            </div>
          )}
          {showPreview && <PreviewServer botId={botId} flowJson={previewJson} structureKey={structureKey} />}
        </div>

        {selectedBlock && !showPreview && (
          <Inspector
            block={selectedBlock.block}
            allBlocks={nodes.map((n) => (n.data as NodeData).block)}
            nodes={nodes}
            isStart={customStart === selectedBlock.block.id || (!customStart && selectedBlock.block.type === 'start')}
            onChange={(p, br, nx) => updateBlock(selectedBlock.block.id, p, br, nx)}
            onDelete={() => deleteBlocks([selectedBlock.block.id])}
            collections={collections}
            botId={botId}
            issues={issues}
            platform={platform}
            onOpenPayments={onOpenPayments}
            onCreateGoto={(targetBlockId) => {
              const gotoId = addBlock('goto');
              updateBlock(gotoId, { target: targetBlockId } as BlockParams);
              setSelected(gotoId);
            }}
            onMakeStart={() => {
              setCustomStart(selectedBlock.block.id);
              setStatus(t('status.makeStart'));
            }}
          />
        )}
      </div>

      {ctx && ctxBlock && (
        <div
          className="ctx-menu"
          ref={ctxMenuRef}
          style={{ left: ctx.x, top: ctx.y }}
          onClick={(e) => e.stopPropagation()}
          role="menu"
        >
          <div className="ctx-title">
            <span className="dot" style={{ background: BLOCK_META[ctxBlock.type]?.color ?? '#64748b' }} />
            {BLOCK_META[ctxBlock.type]?.label ?? ctxBlock.type}
            <span className="muted">{nodeLabel(ctxBlock, settings.language)}</span>
            {multi && <span className="tag">{t('ctx.count', { n: ctxTargets.length })}</span>}
          </div>
          <button onClick={() => { duplicateBlocks(ctxTargets); setCtx(null); }}>
            {multi ? t('ctx.duplicateN', { n: ctxTargets.length }) : t('ctx.duplicate')}
          </button>
          <button
            onClick={() => {
              copySelection();
              setCtx(null);
            }}
          >
            {t('ctx.copy')}
          </button>
          {/* Визуальная группа вокруг выделения: минимум два блока. */}
          {multi && (
            <button
              onClick={() => {
                groupSelection(ctxTargets);
                setCtx(null);
              }}
            >
              {t('ctx.group')}
            </button>
          )}
          {/* Подсценарий из выделения: только в сценарии бота (не во фрагменте —
              вложенные фрагменты глубже 3 уровней запрещены, а UI не должен
              провоцировать). Диалог покажет входы/выходы ДО действия. */}
          {multi && !sfEditing && ctxBlock.type !== 'start' && (
            <button
              onClick={() => {
                beginExtractSubflow(ctxTargets.filter((id) => {
                  const b = nodes.find((n) => n.id === id)?.data as NodeData | undefined;
                  return b?.block.type !== 'start';
                }));
                setCtx(null);
              }}
            >
              {t('ctx.toSubflow')}
            </button>
          )}
          {/* Распаковка вызова: обратная операция — копия блоков фрагмента на холст. */}
          {!multi && ctxBlock.type === 'subflow' && ctxBlock.params.subflowId && (
            <button
              onClick={() => {
                void explodeSubflow(ctx.nodeId);
                setCtx(null);
              }}
            >
              {t('ctx.explodeSubflow')}
            </button>
          )}
          {/* Вход в фрагмент двойным кликом дублируется в меню: на тач-устройствах
              двойного клика нет. */}
          {!multi && ctxBlock.type === 'subflow' && ctxBlock.params.subflowId && !sfEditing && (
            <button
              onClick={() => {
                void enterSubflow(String(ctxBlock.params.subflowId));
                setCtx(null);
              }}
            >
              {t('ctx.openSubflow')}
            </button>
          )}
          <button disabled={!hasClipboard} onClick={() => { pasteClipboard(); setCtx(null); }}>
            {t('ctx.paste')}
          </button>
          <button
            disabled={ctxBlock.type === 'end'}
            onClick={() => {
              setCustomStart(ctx.nodeId);
              setStatus(t('status.makeStart'));
              setCtx(null);
            }}
          >
            {t('ctx.makeStart')}
          </button>
          <button onClick={() => { toggleDisabled(ctxTargets); setCtx(null); }}>
            {(ctxBlock.params.disabled ? t('ctx.unfreeze') : t('ctx.freeze')) +
              (multi ? ` (${ctxTargets.length})` : '')}
          </button>
          <button
            onClick={() => {
              setExplain({ blockId: ctx.nodeId, x: ctx.x, y: ctx.y });
              setCtx(null);
            }}
          >
            {t('ctx.explain')}
          </button>
          <button onClick={() => { clearLinks(ctx.nodeId); setCtx(null); }}>{t('ctx.clearLinks')}</button>
          {/* Быстрые действия профи: в работе чаще всего нужны переход к цели,
              копирование id и дублирование вместе со связями. */}
          {isPro && (
            <>
              <button
                disabled={!(ctxBlock.next || ctxBlock.params.target)}
                onClick={() => {
                  const target = ctxBlock.params.target || ctxBlock.next;
                  if (target) focusBlock(target);
                  setCtx(null);
                }}
              >
                {t('ctx.jumpToTarget')}
              </button>
              <button
                onClick={() => {
                  const id = ctxBlock.id;
                  void navigator.clipboard?.writeText(id).then(
                    () => setStatus(t('status.idCopied', { id })),
                    () => setStatus(id)
                  );
                  setCtx(null);
                }}
              >
                {t('ctx.copyId')}
              </button>
              <button
                onClick={() => {
                  duplicateKeepingLinks(ctxTargets);
                  setCtx(null);
                }}
              >
                {t('ctx.duplicateWithLinks')}
              </button>
            </>
          )}
          <button className="ctx-danger" onClick={() => { deleteBlocks(ctxTargets); setCtx(null); }}>
            {multi ? t('ctx.deleteN', { n: ctxTargets.length }) : t('ctx.deleteOne')}
          </button>
        </div>
      )}

      {explain && explainBlock && (
        <div
          className={`explain-pop${explain.x + 380 > window.innerWidth ? ' clamped' : ''}${explain.y + 300 > window.innerHeight ? ' clamped-b' : ''}`}
          style={{ left: explain.x, top: explain.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="explain-head">
            <span className="dot" style={{ background: BLOCK_META[explainBlock.type]?.color ?? '#64748b' }} />
            {BLOCK_META[explainBlock.type]?.label ?? explainBlock.type}
          </div>
          <div className="explain-title">{t('explain.title')}</div>
          {explainBranch(scenario, explain.blockId, settings.language).map((line, i) => (
            <div className="explain-line" key={i}>
              <span className="explain-num">{i + 1}</span>
              <span>{line}</span>
            </div>
          ))}
          <button className="primary" onClick={() => setExplain(null)}>
            {t('explain.close')}
          </button>
        </div>
      )}

      {showVars && <VarsPanel nodes={nodes} onPick={focusBlock} onClose={() => setShowVars(false)} />}
      {showLogs && <LogsModal botId={botId} onClose={() => setShowLogs(false)} />}

      {/* Диалог «создать подсценарий из выделения»: дефолтные входы/выходы
          показываются ДО действия — операция выглядит разрушительной, автор
          должен видеть, что получится. Отмена ничего не меняет; применение —
          один шаг undo. */}
      {sfExtract && (
        <div className="modal-backdrop" onClick={() => setSfExtract(null)}>
          <div ref={sfExtractModalRef} className="modal sf-extract-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('sf.extract.title')}>
            <header className="modal-head">
              <h2>{t('sf.extract.title')}</h2>
              <button className="ghost icon-btn" onClick={() => setSfExtract(null)} title={t('common.close.title')} aria-label={t('common.close.title')}>
                <X />
              </button>
            </header>
            <div className="modal-body">
              <p className="muted">{t('sf.extract.hint', { n: sfExtract.ids.length })}</p>
              <div className="insp-field">
                <label htmlFor="sf-extract-name">{t('sf.extract.name')}</label>
                <input
                  id="sf-extract-name"
                  value={sfExtract.name}
                  placeholder={t('sf.defaultName')}
                  onChange={(e) => setSfExtract({ ...sfExtract, name: e.target.value })}
                  maxLength={64}
                />
              </div>
              <div className="insp-field">
                <label>{t('sf.extract.inputs')}</label>
                {sfExtract.inputs.length ? (
                  <ul className="sf-io-list">
                    {sfExtract.inputs.map((v) => (
                      <li key={v}><code className="mono">{`{{${v}}}`}</code></li>
                    ))}
                  </ul>
                ) : (
                  <span className="muted">{t('sf.extract.ioEmpty')}</span>
                )}
              </div>
              <div className="insp-field">
                <label>{t('sf.extract.outputs')}</label>
                {sfExtract.outputs.length ? (
                  <ul className="sf-io-list">
                    {sfExtract.outputs.map((v) => (
                      <li key={v}><code className="mono">{`{{${v}}}`}</code></li>
                    ))}
                  </ul>
                ) : (
                  <span className="muted">{t('sf.extract.ioEmpty')}</span>
                )}
              </div>
              <div className="row-actions">
                <button className="primary" onClick={() => void confirmExtractSubflow()}>
                  {t('sf.extract.confirm')}
                </button>
                <button className="ghost" onClick={() => setSfExtract(null)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* «Проверить фрагмент»: лог прогона настоящим движком (сервер). */}
      {sfEditing && sfPreview && (
        <div className="modal-backdrop" onClick={() => setSfPreview(null)}>
          <div ref={sfPreviewModalRef} className="modal sf-preview-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('sf.check')}>
            <header className="modal-head">
              <h2>{t('sf.check')}</h2>
              <button className="ghost icon-btn" onClick={() => setSfPreview(null)} title={t('common.close.title')} aria-label={t('common.close.title')}>
                <X />
              </button>
            </header>
            <div className="modal-body">
              {(sfPreview.issues ?? []).length > 0 && (
                <div className="sf-preview-issues">
                  {(sfPreview.issues ?? []).map((i, n) => (
                    <div key={n} className={`issue-row ${i.level}`}>
                      <span className="badge">{i.code}</span> {i.message}
                    </div>
                  ))}
                </div>
              )}
              <div className="sf-preview-log">
                {sfPreview.log.length === 0 && <span className="muted">{t('sf.preview.empty')}</span>}
                {sfPreview.log.map((l, n) => (
                  <div key={n} className={`sim-line ${l.who}`}>{l.text}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className="modal-backdrop" onClick={() => setShowShortcuts(false)}>
          <div ref={shortcutsModalRef} className="modal shortcuts-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{t('pro.shortcuts')}</h2>
              <button
                className="ghost icon-btn"
                onClick={() => setShowShortcuts(false)}
                title={t('common.close.title')}
                aria-label={t('common.close.title')}
              >
                <X />
              </button>
            </header>
            <div className="modal-body">
              <ul className="shortcut-list">
                <li>{t('pro.shortcuts.save')}</li>
                <li>{t('pro.shortcuts.undo')}</li>
                <li>{t('pro.shortcuts.find')}</li>
                <li>{t('pro.shortcuts.copy')}</li>
                <li>{t('pro.shortcuts.dup')}</li>
                <li>{t('pro.shortcuts.del')}</li>
              </ul>
            </div>
            <footer className="modal-foot">
              <button className="primary" onClick={() => setShowShortcuts(false)}>
                {t('common.close')}
              </button>
            </footer>
          </div>
        </div>
      )}
      {showVersions && (
        <VersionsModal
          botId={botId}
          onClose={() => setShowVersions(false)}
          onRollback={(flowJson, version) => {
            const sc: CanvasScenario = JSON.parse(flowJson);
            const g = scenarioToGraph(sc);
            setNodes(g.nodes);
            setEdges(g.edges);
            setGroups(sanitizeGroups(sc.groups));
            setCustomStart(sc.start ?? null);
            savedJson.current = flowJson;
            // Откат записал на сервере НОВУЮ версию: без её учёта следующее
            // сохранение ушло бы с устаревшей (WU-03).
            scenarioVersion.current = typeof version === 'number' ? version : null;
            setStatus(t('status.rollback'));
          }}
        />
      )}

      {showTemplates && (
        <Suspense fallback={null}>
          <TemplatesModal
            hasBlocks={nodes.length > 0}
            platform={platform}
            onClose={() => setShowTemplates(false)}
            onPick={(tpl, mode) => {
              loadTemplate(tpl, mode);
              setShowTemplates(false);
            }}
          />
        </Suspense>
      )}

      {showPublish && (
        <PublishModal
          botId={botId}
          name={name}
          scenario={scenario}
          platform={platform}
          onClose={() => setShowPublish(false)}
          onSelectBlock={(id) => setSelected(id)}
          onVersion={(version) => {
            scenarioVersion.current = version;
          }}
          onSaved={() => setStatus(t('status.published'))}
        />
      )}

      {showGuide && (
        <Suspense fallback={null}>
          <Guide onClose={() => setShowGuide(false)} />
        </Suspense>
      )}
    </div>
  );
}

export function Constructor(props: {
  botId: string;
  name: string;
  platform?: Platform;
  onBack: () => void;
  onOpenCatalog?: (scenarioJson: string) => void;
  onOpenData?: () => void;
  onOpenPayments?: () => void;
}) {
  return (
    <ReactFlowProvider>
      <ConstructorInner {...props} />
    </ReactFlowProvider>
  );
}
