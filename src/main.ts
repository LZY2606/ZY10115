import './style.css';
import { api } from './api.ts';
import type { Candidate, Dataset, SolveParams, SolveResult } from '../shared/types.ts';
import { prepareView, type PreparedView } from './state.ts';
import { renderScene, type ViewOptions } from './canvas.ts';

interface UIState {
  datasets: Array<{ id: string; name: string; imageCount: number; catalogCount: number }>;
  dataset: Dataset | null;
  result: SolveResult | null;
  selectedRank: number;
  opts: ViewOptions;
  lockImageId: string;
  lockCatalogId: string;
  maskStarId: string;
  rightTab: 'candidates' | 'residuals' | 'correlation' | 'evidence';
  busy: boolean;
  toast: string | null;
}

const DEFAULT_PARAMS: SolveParams = {
  fovMinDeg: 0.3,
  fovMaxDeg: 4,
  maxRotationDeg: 180,
  allowMirror: true,
  distortionOrder: 1,
  tolerancePx: 2,
  mismatchCost: 0.5,
  topK: 5,
};

const state: UIState = {
  datasets: [],
  dataset: null,
  result: null,
  selectedRank: 1,
  opts: { showMatches: true, showResiduals: true, showRejected: true, showLabels: false, showCatalog: true, residualScale: 12 },
  lockImageId: '',
  lockCatalogId: '',
  maskStarId: '',
  rightTab: 'candidates',
  busy: false,
  toast: null,
};

const params: SolveParams = { ...DEFAULT_PARAMS };
const app = document.querySelector<HTMLDivElement>('#app')!;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

function toast(message: string, ms = 2600) {
  state.toast = message;
  render();
  window.setTimeout(() => {
    state.toast = null;
    render();
  }, ms);
}

async function refreshDatasets(selectId?: string) {
  state.datasets = await api.listDatasets();
  if (selectId) await selectDataset(selectId);
  render();
}

async function selectDataset(id: string) {
  state.dataset = await api.getDataset(id);
  state.result = null;
  state.selectedRank = 1;
  render();
}

async function doSolve() {
  if (!state.dataset) return;
  state.busy = true;
  render();
  try {
    const { result, cached } = await api.solve(state.dataset.id, params);
    state.result = result;
    state.selectedRank = 1;
    toast(cached ? '命中请求哈希，返回已存结果' : '求解完成（新规则哈希）');
  } catch (err) {
    toast((err as Error).message);
  } finally {
    state.busy = false;
    render();
  }
}

async function doReplay() {
  if (!state.dataset) return;
  const version = (document.querySelector<HTMLSelectElement>('#replayVersion')!.value);
  state.busy = true;
  render();
  try {
    const { result } = await api.replay(state.dataset.id, version, params);
    state.result = result;
    state.selectedRank = 1;
    toast(`已按规则 ${version} 原参数重放（不写入缓存）`);
  } catch (err) {
    toast((err as Error).message);
  } finally {
    state.busy = false;
    render();
  }
}

function render() {
  const view = state.dataset ? prepareView(state.dataset, state.result) : null;
  const candidate = state.result?.candidates.find((c) => c.rank === state.selectedRank) ?? state.result?.candidates[0] ?? null;
  app.innerHTML = `
    <header>
      <h1>Plate Solve 复核工作台</h1>
      <span class="pill">离线 · JSON/CSV · 无 FITS · 无联网星表</span>
      <span class="pill">规则 ${state.result?.rulesVersion ?? '2025.1'}</span>
      <span style="flex:1"></span>
      ${state.dataset ? `<span class="pill">数据集 ${esc(state.dataset.id)}</span>` : ''}
    </header>
    <main>
      <div class="sidebar">${renderSidebar()}</div>
      <div class="stage">
        <div class="canvas-wrap"><canvas id="scene"></canvas></div>
        <div class="legend">
          <span><i class="swatch" style="background:#58a6ff"></i>匹配星</span>
          <span><i class="swatch" style="background:#d29922"></i>超差拒识</span>
          <span><i class="swatch" style="background:#8b98a7"></i>未匹配</span>
          <span><i class="swatch" style="background:#f85149"></i>屏蔽/饱和</span>
          <span><i class="swatch" style="border:1.5px solid #3fb950;background:transparent"></i>锁定</span>
          <span><i class="swatch" style="border:1px solid #c084fc;background:transparent"></i>星表投影</span>
          <span><i class="swatch" style="background:#f0883e"></i>残差向量（放大显示）</span>
        </div>
      </div>
      <div class="rightbar">${renderRight(candidate)}</div>
    </main>
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ''}
  `;
  bindEvents();
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  if (canvas && state.dataset && view) {
    const draw = () => renderScene(canvas, state.dataset!, view, candidate, state.opts);
    requestAnimationFrame(draw);
  }
}

function renderSidebar(): string {
  return `
    <section class="block">
      <h2>输入</h2>
      <label>图像星点 (JSON 数组 或 CSV: id,x,y,flux[,saturated])</label>
      <textarea id="imageText" placeholder='[{"id":"i1","x":10,"y":12,"flux":4000}]'></textarea>
      <label>本地星表 (JSON 数组 或 CSV: id,ra,dec,mag)</label>
      <textarea id="catalogText" placeholder='[{"id":"c1","ra":120.1,"dec":30.2,"mag":8.1}]'></textarea>
      <label>名称（可选）</label>
      <input id="datasetName" type="text" />
      <div class="btns">
        <button id="uploadBtn">载入</button>
        <button class="ghost" id="loadFixtureBtn">载入合成 fixture</button>
      </div>
      <label>合成 fixture</label>
      <select id="fixtureSelect">
        <option value="synthetic-standard">标准（15°, 26 星）</option>
        <option value="synthetic-mirror">镜像候选（42° mirror）</option>
        <option value="synthetic-ra-seam">RA 0° 接缝</option>
        <option value="synthetic-sparse">稀疏（欠定演示）</option>
      </select>
      <div class="hint">重复载入同一数据返回同一数据集 ID；原始列表永不被改写，所有人工判断进入证据表。</div>
    </section>

    <section class="block">
      <h2>求解参数</h2>
      <div class="row2">
        <div><label>FOV 下限 °</label><input id="pFovMin" type="number" step="0.05" value="${params.fovMinDeg}"></div>
        <div><label>FOV 上限 °</label><input id="pFovMax" type="number" step="0.05" value="${params.fovMaxDeg}"></div>
      </div>
      <div class="row2">
        <div><label>最大旋转 °</label><input id="pRot" type="number" step="1" value="${params.maxRotationDeg}"></div>
        <div><label>Top-K</label><input id="pTopK" type="number" min="1" max="20" value="${params.topK}"></div>
      </div>
      <div class="row2">
        <div><label>容差 px（边界含）</label><input id="pTol" type="number" step="0.1" value="${params.tolerancePx}"></div>
        <div><label>失配成本</label><input id="pMismatch" type="number" step="0.1" value="${params.mismatchCost}"></div>
      </div>
      <label>畸变阶数（0=刚体相似 · 1=仿射 · 2/3=SIP 型多项式）</label>
      <select id="pOrder">
        <option value="0" ${params.distortionOrder === 0 ? 'selected' : ''}>0</option>
        <option value="1" ${params.distortionOrder === 1 ? 'selected' : ''}>1</option>
        <option value="2" ${params.distortionOrder === 2 ? 'selected' : ''}>2</option>
        <option value="3" ${params.distortionOrder === 3 ? 'selected' : ''}>3</option>
      </select>
      <label class="checkbox"><input id="pMirror" type="checkbox" ${params.allowMirror ? 'checked' : ''}>允许镜像候选（与旋转分别报告）</label>
      <div class="btns">
        <button id="solveBtn" ${state.dataset ? '' : 'disabled'}>${state.busy ? '求解中…' : '求解'}</button>
        <button class="ghost" id="replayBtn" ${state.dataset ? '' : 'disabled'}>按旧规则重放</button>
      </div>
      <select id="replayVersion" style="margin-top:6px">
        <option value="2025.1">rules 2025.1（当前）</option>
      </select>
    </section>

    <section class="block">
      <h2>已存数据集</h2>
      ${state.datasets.length === 0 ? '<div class="muted">暂无</div>' : ''}
      ${state.datasets
        .map(
          (d) => `
        <div class="ds-item ${state.dataset?.id === d.id ? 'active' : ''}" data-ds="${esc(d.id)}">
          <div class="name">${esc(d.name)}</div>
          <div class="meta">${d.id} · ${d.imageCount} 图像星 / ${d.catalogCount} 星表星</div>
        </div>`,
        )
        .join('')}
    </section>
  `;
}

function renderRight(candidate: Candidate | null): string {
  if (!state.dataset) {
    return '<section class="block"><h2>候选</h2><div class="muted">先载入图像星点与本地星表。</div></section>';
  }
  const result = state.result;
  let banner = '';
  if (result) {
    if (result.status === 'underdetermined') {
      banner = `<div class="banner warn">欠定：${esc(result.underdeterminedReason ?? '')}——不会自动挑选第一个候选。</div>`;
    } else if (result.status === 'error') {
      banner = `<div class="banner error">${esc(result.underdeterminedReason ?? '参数错误')}</div>`;
    } else {
      banner = `<div class="banner good">唯一/有序解：Top-${result.candidates.length} 候选代价可区分。请求哈希 ${esc(result.requestHash.slice(0, 12))}</div>`;
    }
  }
  return `
    ${banner}
    <section class="block">
      <h2>证据（新版本，不改原始列表）</h2>
      <div class="row2">
        <div><label>锁定图像星</label><select id="lockImage">${starOptions(state.dataset.imageStars.map((s) => [s.id, `${s.id} (${s.x.toFixed(0)},${s.y.toFixed(0)})`]), state.lockImageId)}</select></div>
        <div><label>锁定星表星</label><select id="lockCatalog">${starOptions(state.dataset.catalogStars.map((s) => [s.id, `${s.id} RA${s.ra.toFixed(2)}`]), state.lockCatalogId)}</select></div>
      </div>
      <div class="btns"><button class="ghost" id="addLockBtn" ${state.dataset ? '' : 'disabled'}>加入锁定对应（需 3 对非共线）</button></div>
      <label>屏蔽单星（卫星轨迹/伪星点）</label>
      <select id="maskStar">${starOptions(state.dataset.imageStars.map((s) => [s.id, `${s.id}${s.saturated ? ' [饱和]' : ''}`]), state.maskStarId)}</select>
      <div class="btns">
        <button class="danger" id="maskStarBtn">屏蔽该星</button>
        <button class="danger" id="maskSatBtn">屏蔽全部饱和星</button>
      </div>
      ${renderEvidenceList()}
    </section>

    <section class="block">
      <div class="tabs">
        <button data-tab="candidates" class="${state.rightTab === 'candidates' ? 'active' : 'ghost'}">Top-K 候选</button>
        <button data-tab="residuals" class="${state.rightTab === 'residuals' ? 'active' : 'ghost'}">逐点残差</button>
        <button data-tab="correlation" class="${state.rightTab === 'correlation' ? 'active' : 'ghost'}">参数相关性</button>
        <button data-tab="evidence" class="${state.rightTab === 'evidence' ? 'active' : 'ghost'}">拒识统计</button>
      </div>
      ${renderTab(candidate)}
    </section>

    <section class="block">
      <h2>显示与导出</h2>
      <label class="checkbox"><input id="vMatches" type="checkbox" ${state.opts.showMatches ? 'checked' : ''}>匹配线</label>
      <label class="checkbox"><input id="vRes" type="checkbox" ${state.opts.showResiduals ? 'checked' : ''}>残差向量</label>
      <label class="checkbox"><input id="vRej" type="checkbox" ${state.opts.showRejected ? 'checked' : ''}>被拒/未匹配星</label>
      <label class="checkbox"><input id="vCat" type="checkbox" ${state.opts.showCatalog ? 'checked' : ''}>星表投影框</label>
      <label class="checkbox"><input id="vLabel" type="checkbox" ${state.opts.showLabels ? 'checked' : ''}>星点编号</label>
      <label>残差向量放大</label>
      <input id="vScale" type="range" min="1" max="60" value="${state.opts.residualScale}">
      <div class="btns">
        <a class="btn-link" href="${result ? api.exportUrl(result.requestHash) : '#'}" ${result ? '' : 'aria-disabled="true"'} style="${result ? '' : 'pointer-events:none;opacity:.45'}">导出 CSV</a>
      </div>
      <div class="hint">CSV 每候选一行一对匹配，含旋转/镜像/尺度/FOV/逐点像素与角秒残差；不使用单一总 RMS 汇总。</div>
    </section>
  `;
}

function starOptions(options: Array<[string, string]>, selected: string): string {
  return options
    .map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');
}

function renderEvidenceList(): string {
  const evidence = state.dataset?.evidence ?? [];
  if (evidence.length === 0) return '<div class="hint" style="margin-top:8px">尚无证据。锁定三点、屏蔽饱和星或轨迹点后重新求解。</div>';
  return evidence
    .map((e) => {
      const text =
        e.kind === 'lock'
          ? `锁定 ${e.pair!.imageId} ↔ ${e.pair!.catalogId}`
          : e.kind === 'mask-star'
            ? `屏蔽 ${e.starId}`
            : e.kind === 'mask-saturated'
              ? '屏蔽全部饱和星'
              : `屏蔽多边形区域（${e.polygon?.length ?? 0} 顶点）`;
      return `<div class="ev-item"><span>${esc(text)}</span><button class="danger" data-remove-evidence="${esc(e.id)}">撤销</button></div>`;
    })
    .join('');
}

function renderTab(candidate: Candidate | null): string {
  const result = state.result;
  if (!result) return '<div class="muted">尚未求解。</div>';
  if (state.rightTab === 'candidates') {
    if (result.candidates.length === 0) return '<div class="muted">无候选（欠定）。</div>';
    return result.candidates
      .map((c) => {
        const active = c.rank === (candidate?.rank ?? 1);
        return `
        <div class="candidate ${active ? 'active' : ''}" data-rank="${c.rank}">
          <div class="head">
            <span>#${c.rank} ${c.status === 'underdetermined' ? '<span class="status-underdetermined">欠定</span>' : '<span class="status-ok">可区分</span>'}</span>
            <span>cost ${c.cost.toFixed(4)}</span>
          </div>
          <dl class="kv">
            <dt>旋转（0–360）</dt><dd class="tag-rot">${c.model.rotationDeg.toFixed(3)}°</dd>
            <dt>镜像</dt><dd class="${c.model.mirror ? 'tag-mirror' : 'muted'}">${c.model.mirror ? '镜像（反射）' : '普通旋转'}</dd>
            <dt>尺度</dt><dd>${c.model.scaleArcsecPerPx.toFixed(4)} ″/px</dd>
            <dt>对角视场</dt><dd>${c.model.fovDiagDeg.toFixed(3)}°</dd>
            <dt>切平面中心</dt><dd>RA ${c.model.ra0.toFixed(4)} / Dec ${c.model.dec0.toFixed(4)}</dd>
            <dt>内点 / 拒识</dt><dd>${c.inlierCount} / ${c.rejected.length}</dd>
            <dt>RMS / 最大残差</dt><dd>${c.rmsPx.toFixed(3)} / ${c.maxResidualPx.toFixed(3)} px</dd>
            <dt>失配罚分</dt><dd>${c.mismatchPenalty.toFixed(3)}</dd>
            <dt>签名</dt><dd>${esc(c.signature)}</dd>
          </dl>
          ${c.underdeterminedReason ? `<div class="hint status-underdetermined">${esc(c.underdeterminedReason)}</div>` : ''}
        </div>`;
      })
      .join('');
  }
  if (!candidate) return '<div class="muted">无候选。</div>';
  if (state.rightTab === 'residuals') {
    return `
      <table>
        <thead><tr><th>图像星</th><th>星表星</th><th>残差 px</th><th>角距 ″</th><th>ΔRA ″</th><th>ΔDec ″</th></tr></thead>
        <tbody>
          ${candidate.matches
            .slice()
            .sort((a, b) => b.residualPx - a.residualPx)
            .map(
              (m) => `<tr>
                <td>${esc(m.imageId)}</td><td>${esc(m.catalogId)}</td>
                <td>${m.residualPx.toFixed(3)}</td><td>${m.angularArcsec.toFixed(3)}</td>
                <td>${m.dx.toFixed(2)}</td><td>${m.dy.toFixed(2)}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <div class="hint" style="margin-top:8px">残差按像素大小排序；画布上的橙色向量按左侧放大系数显示，用于发现局部系统性趋势（场边/中心差异），不做单一 RMS 汇总。</div>`;
  }
  if (state.rightTab === 'correlation') {
    return renderCorrelation(candidate);
  }
  const reasons = new Map<string, number>();
  for (const r of candidate.rejected) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  return `
    <table><thead><tr><th>拒识原因</th><th>数量</th></tr></thead><tbody>
    ${Array.from(reasons.entries())
      .map(([reason, count]) => `<tr><td>${reason}</td><td>${count}</td></tr>`)
      .join('')}
    </tbody></table>
    <table style="margin-top:8px"><thead><tr><th>星</th><th>类型</th><th>说明</th></tr></thead><tbody>
    ${candidate.rejected
      .map(
        (r) => `<tr><td>${esc(r.imageId ?? r.catalogId ?? '')}</td><td>${r.reason}</td><td>${esc(r.detail)}</td></tr>`,
      )
      .join('')}
    </tbody></table>`;
}

function renderCorrelation(candidate: Candidate): string {
  const names = candidate.parameterNames;
  const corr = candidate.parameterCorrelation;
  const cell = (v: number) => {
    const a = Math.min(1, Math.abs(v));
    const hue = v >= 0 ? 210 : 0;
    return `background:rgba(${v >= 0 ? '88,166,255' : '248,81,73'},${(a * 0.85).toFixed(3)});color:${a > 0.55 ? '#08131f' : '#c9d1d9'}`;
  };
  return `
    <div class="hint">线性部分正规方程相关矩阵（a,b,c 与 d,e,f 两块；畸变多项式在高阶时扩展）。接近 ±1 表示参数共线（如旋转与 y 轴尺度不可区分）。</div>
    <div style="overflow-x:auto;margin-top:8px">
      <div class="correlation" style="grid-template-columns:repeat(${names.length},minmax(26px,1fr))">
        ${corr
          .map((row, i) =>
            row
              .map(
                (v, j) =>
                  `<div style="${cell(v)}" title="${esc(names[i])} × ${esc(names[j])} = ${v.toFixed(3)}">${i === j ? '1' : v.toFixed(1).replace('0.', '.').replace('-0.', '-.')}</div>`,
              )
              .join(''),
          )
          .join('')}
      </div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        ${names.map((n) => `<span class="muted" style="font-size:9px">${esc(n)}</span>`).join('')}
      </div>
    </div>`;
}

function bindEvents() {
  const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>('#' + id);
  $('uploadBtn')?.addEventListener('click', async () => {
    const imageText = $<HTMLTextAreaElement>('imageText')?.value ?? '';
    const catalogText = $<HTMLTextAreaElement>('catalogText')?.value ?? '';
    if (!imageText || !catalogText) return toast('需要同时提供图像星点与星表');
    try {
      const { dataset } = await api.createDataset({
        name: $<HTMLInputElement>('datasetName')?.value || undefined,
        imageText,
        imageFilename: 'image.csv',
        catalogText,
        catalogFilename: 'catalog.csv',
      });
      await refreshDatasets(dataset.id);
      toast('数据集已载入');
    } catch (err) {
      toast((err as Error).message);
    }
  });

  $('loadFixtureBtn')?.addEventListener('click', async () => {
    const name = $<HTMLSelectElement>('fixtureSelect')!.value;
    try {
      const res = await fetch(`/fixtures/${name}.json`);
      if (!res.ok) throw new Error('fixture 读取失败');
      const raw = await res.json();
      const { dataset } = await api.createDataset({
        name: raw.name,
        imageStars: raw.imageStars,
        catalogStars: raw.catalogStars,
      });
      await refreshDatasets(dataset.id);
      toast(`已载入 ${raw.name}`);
    } catch (err) {
      toast((err as Error).message);
    }
  });

  document.querySelectorAll<HTMLElement>('[data-ds]').forEach((el) =>
    el.addEventListener('click', () => selectDataset(el.dataset.ds!)),
  );

  const readParams = () => {
    params.fovMinDeg = num('pFovMin');
    params.fovMaxDeg = num('pFovMax');
    params.maxRotationDeg = num('pRot');
    params.topK = Number($<HTMLInputElement>('pTopK')!.value);
    params.tolerancePx = num('pTol');
    params.mismatchCost = num('pMismatch');
    params.distortionOrder = Number($<HTMLSelectElement>('pOrder')!.value) as SolveParams['distortionOrder'];
    params.allowMirror = $<HTMLInputElement>('pMirror')!.checked;
  };
  const num = (id: string) => Number($<HTMLInputElement>(id)!.value);

  $('solveBtn')?.addEventListener('click', () => {
    readParams();
    void doSolve();
  });
  $('replayBtn')?.addEventListener('click', () => {
    readParams();
    void doReplay();
  });

  $('lockImage')?.addEventListener('change', (e) => (state.lockImageId = (e.target as HTMLSelectElement).value));
  $('lockCatalog')?.addEventListener('change', (e) => (state.lockCatalogId = (e.target as HTMLSelectElement).value));
  $('maskStar')?.addEventListener('change', (e) => (state.maskStarId = (e.target as HTMLSelectElement).value));

  $('addLockBtn')?.addEventListener('click', async () => {
    if (!state.dataset) return;
    const imageId = $<HTMLSelectElement>('lockImage')!.value;
    const catalogId = $<HTMLSelectElement>('lockCatalog')!.value;
    await addEvidenceAndReload({ kind: 'lock', pair: { imageId, catalogId }, reason: 'manual lock' });
  });
  $('maskStarBtn')?.addEventListener('click', async () => {
    const starId = $<HTMLSelectElement>('maskStar')!.value;
    await addEvidenceAndReload({ kind: 'mask-star', starId, reason: 'manual mask (possible satellite trail / artifact)' });
  });
  $('maskSatBtn')?.addEventListener('click', async () => {
    await addEvidenceAndReload({ kind: 'mask-saturated', reason: 'saturated detector pixels' });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-remove-evidence]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      toast('证据为仅追加记录：请通过“按旧状态重放”对比，或新建数据集');
    }),
  );

  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.rightTab = btn.dataset.tab as UIState['rightTab'];
      render();
    }),
  );
  document.querySelectorAll<HTMLElement>('[data-rank]').forEach((el) =>
    el.addEventListener('click', () => {
      state.selectedRank = Number(el.dataset.rank);
      render();
    }),
  );

  const bindCheck = (id: string, key: keyof ViewOptions) =>
    $(id)?.addEventListener('change', (e) => {
      (state.opts[key] as boolean) = (e.target as HTMLInputElement).checked;
      render();
    });
  bindCheck('vMatches', 'showMatches');
  bindCheck('vRes', 'showResiduals');
  bindCheck('vRej', 'showRejected');
  bindCheck('vCat', 'showCatalog');
  bindCheck('vLabel', 'showLabels');
  $('vScale')?.addEventListener('input', (e) => {
    state.opts.residualScale = Number((e.target as HTMLInputElement).value);
    render();
  });
}

async function addEvidenceAndReload(payload: unknown) {
  if (!state.dataset) return;
  try {
    await api.addEvidence(state.dataset.id, payload);
    state.dataset = await api.getDataset(state.dataset.id);
    state.result = null;
    toast('证据已追加，原始星点列表保持不变，请重新求解');
    render();
  } catch (err) {
    toast((err as Error).message);
  }
}

async function init() {
  try {
    await api.health();
  } catch {
    app.innerHTML = '<div style="padding:30px;color:#f85149">后端 API 不可用，请通过 Vite 开发服务器打开本页（pnpm dev）。</div>';
    return;
  }
  state.datasets = await api.listDatasets();
  render();
}

void init();
