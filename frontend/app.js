const socket = io();
const canvas = document.getElementById("cityCanvas");
const ctx = canvas.getContext("2d");
const turnInfo = document.getElementById("turnInfo");

// ===== Dynamic square-cell canvas sizing with gaps =====
let CELL = 20;    // 单个方格边长（CSS像素，运行时计算）
let GAP = 2;     // 方格间距（CSS像素）
let CSS_W = 0, CSS_H = 0;
let DPR = window.devicePixelRatio || 1;
let lastSocialUSeen = null;
let lastTurnSeen = -1;

function resizeCanvasForGrid(rows, cols, {
    maxWidth = (canvas.parentElement ? canvas.parentElement.clientWidth : 760),
    maxHeight = 760,
    minCell = 16,
    gap = 2
} = {}) {
    GAP = gap;

    // 计算满足行列与间距后，能容纳的最大正方格边长
    const maxCellW = Math.floor((maxWidth - (cols - 1) * GAP) / Math.max(1, cols));
    const maxCellH = Math.floor((maxHeight - (rows - 1) * GAP) / Math.max(1, rows));
    CELL = Math.max(minCell, Math.min(maxCellW, maxCellH));

    CSS_W = cols * CELL + Math.max(0, (cols - 1)) * GAP;
    CSS_H = rows * CELL + Math.max(0, (rows - 1)) * GAP;

    // 应用 CSS 大小
    canvas.style.width = CSS_W + "px";
    canvas.style.height = CSS_H + "px";

    // 内部分辨率乘以 DPR，保证清晰
    canvas.width = Math.max(1, Math.round(CSS_W * DPR));
    canvas.height = Math.max(1, Math.round(CSS_H * DPR));

    // 之后绘制使用“CSS像素”坐标
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// 读取 state 的行列，并据此调整画布大小
function resizeForCurrentState() {
    const rows = (state && state.rows != null) ? state.rows : (state && state.N != null ? state.N : 0);
    const cols = (state && state.cols != null) ? state.cols : (state && state.M != null ? state.M : (state && state.N != null ? state.N : 0));
    if (!rows || !cols) return;

    const maxW = (canvas.parentElement ? canvas.parentElement.clientWidth : 760);
    const maxH = 760;
    resizeCanvasForGrid(rows, cols, { maxWidth: maxW, maxHeight: maxH, minCell: 18, gap: 2 });

    // 可选：在页面上显示网格信息
    const gridInfo = document.getElementById("gridInfo");
    if (gridInfo) gridInfo.textContent = ` | Grid: ${rows} × ${cols}`;
}

let state = null;
let socialUtilityChart = null;
let socialUtilityHistory = [];
let studentId = localStorage.getItem("student_id");
if (!studentId) {
    studentId = prompt("Please enter your name or student ID:");
    if (studentId) {
        localStorage.setItem("student_id", studentId);
    } else {
        alert("Invalid input. Reloading.");
        location.reload();
    }
}

let myTurn = false;
let fromIdx = null;

let utilityParams = null;
let utilityChart = null;
socket.on("utility_config", (data) => {
    utilityParams = data;
    const uFunc = makeUtilityFunction(utilityParams);
    utilityChart = drawUtilityFunctionChart(uFunc);  // ← 保存实例
});

socket.on("total_agents", (data) => {
    document.getElementById("totalInfo").innerText = `Total agents: ${data.total_agents}`;
});

socket.on("connect", () => {
    console.log("Connected to server");
});

socket.on("request_identity", () => {
    socket.emit("register", { student_id: studentId });
});

// socket.on("state_update", (data) => {
//     state = data;
//     drawCity();
// });
socket.on("state_update", (data) => {
    state = data;
    resizeForCurrentState();
    drawCity();
    updateSocialUtilityChart(data.social_utility, data.turn);
});

socket.on("your_turn", (data) => {
    if (!data.student_id || data.student_id === studentId) {
        myTurn = true;
        fromIdx = data.from_idx;
        state = data.city;
        resizeForCurrentState();
        // console.log("Your turn from block:", fromIdx);
        // updateSocialUtilityChart(data.city.social_utility);
        highlightPointOnUtilityChart(state.densities[fromIdx]);
        turnInfo.innerText = "Your Turn!";
        drawCity();
    } else {
        myTurn = false;
        fromIdx = null;
        turnInfo.innerText = `Waiting for ${data.student_id}...`;
    }
});

canvas.addEventListener("click", (e) => {
    if (!myTurn || !state || fromIdx === null) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left; // CSS 像素
    const y = e.clientY - rect.top;

    const rows = (state && state.rows != null) ? state.rows : (state && state.N != null ? state.N : 0);
    const cols = (state && state.cols != null) ? state.cols : (state && state.M != null ? state.M : (state && state.N != null ? state.N : 0));
    if (!rows || !cols) return;

    const stepX = CELL + GAP;
    const stepY = CELL + GAP;

    let col = Math.floor(x / stepX);
    let row = Math.floor(y / stepY);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return;

    // 如果落在“缝隙”上（offset 超过 CELL），就忽略这次点击
    const offX = x - col * stepX;
    const offY = y - row * stepY;
    if (offX > CELL || offY > CELL) return;

    const toIdx = row * cols + col;

    socket.emit("move", {
        student_id: studentId,
        from_idx: fromIdx,
        to_idx: toIdx
    });
    myTurn = false;
    turnInfo.innerText = "Waiting...";
});

function drawCity() {
    // 优先使用 rows/cols；若没有则回退到 N×N
    const rows = (state && state.rows != null) ? state.rows : (state && state.N != null ? state.N : 0);
    const cols = (state && state.cols != null) ? state.cols : (state && state.M != null ? state.M : (state && state.N != null ? state.N : 0));
    if (!rows || !cols) return;

    const densities = state.densities;   // ρ_i
    const deltaUs = state.delta_Us;    // ΔU_i（可正可负）
    const deltaus = state.delta_us;    // Δu_i（可正可负）

    // 三组数据分别做“单色相 + 均衡化”
    const colorRho = createMonoHueEqualizedScale(densities, {
        hue: 210, saturation: 90, lightnessLight: 80, lightnessDark: 35, gamma: 0.7, pad: 0.02
    });
    const colorDu = createMonoHueEqualizedScale(deltaus, {
        hue: 0, saturation: 90, lightnessLight: 80, lightnessDark: 35, gamma: 0.7, pad: 0.02
    });
    const colorDU = createMonoHueEqualizedScale(deltaUs, {
        hue: 140, saturation: 85, lightnessLight: 80, lightnessDark: 35, gamma: 0.7, pad: 0.02
    });

    // 清屏（按 CSS 尺寸；CSS_W/CSS_H 由 resizeCanvasForGrid 计算）
    ctx.clearRect(0, 0, CSS_W, CSS_H);

    // 文本大小随 CELL 自适应，最低 10px
    const fontPx = Math.max(10, Math.floor(CELL / 6));
    ctx.font = `${fontPx}px Arial`;

    // 预计算步长与带高：正方格 + 间距
    const stepX = CELL + GAP;
    const stepY = CELL + GAP;
    const bandH = CELL / 3;

    for (let i = 0; i < rows * cols; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;

        // 每个方格左上角（含间距）
        const x = col * stepX;
        const y = row * stepY;

        const rho = densities?.[i] ?? 0;
        const du = deltaus?.[i] ?? 0;
        const dU = deltaUs?.[i] ?? 0;

        const colors = [
            colorRho(rho),  // 顶：ρ（蓝，值大更深）
            colorDu(du),    // 中：Δu（红，值大更深；负值自然落在浅段）
            colorDU(dU)     // 底：ΔU（绿，值大更深）
        ];

        const labels = [
            `ρ=${rho.toFixed(2)}`,
            `Δu=${du.toFixed(2)}`,
            `ΔU=${dU.toFixed(2)}`
        ];

        // 画三条水平带
        for (let k = 0; k < 3; k++) {
            const yk = y + k * bandH;

            ctx.fillStyle = colors[k];
            ctx.fillRect(x, yk, CELL, bandH);

            ctx.strokeStyle = "#999";
            ctx.strokeRect(x, yk, CELL, bandH);

            ctx.fillStyle = textColorFor(colors[k]);
            // 基线略微下移，避免贴边
            ctx.fillText(labels[k], x + 2, yk + Math.min(bandH - 2, fontPx + 1));
        }

        // 你的回合：高亮 fromIdx
        if (typeof myTurn !== "undefined" && myTurn &&
            typeof fromIdx !== "undefined" && fromIdx === i) {
            ctx.strokeStyle = "red";
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
            ctx.lineWidth = 1;
        }
    }
}

// function equalizeColor(values, baseColor) {
//     const sorted = [...values].sort((a, b) => a - b);
//     const ranks = values.map(v => sorted.findIndex(sv => sv >= v));
//     const scales = ranks.map(r => 1 - r / (values.length - 1));

//     return scales.map(scale => baseColor.map(c => Math.floor(c * (0.5 + 0.3 * scale))));
// }

// function equalizeColor(density, densities) {
//     const sorted = [...densities].sort((a, b) => a - b);
//     const rank = sorted.indexOf(density);
//     let t = rank / (densities.length - 1);

//     // 直方图均衡化 + HSV 调整亮度饱和度
//     // 让低密度更冷，高密度更亮
//     const hue = (1 - t) * 240; // 蓝→红
//     const saturation = 90;
//     const lightness = 30 + 40 * t; // 30%→70%

//     return `hsl(${hue},${saturation}%,${lightness}%)`;
// }

// 创建一个等分布-增强的颜色映射（γ 非线性 + HSL 亮度拉开）
// densities: 一维数组（各 block 的 density）
// opts:
//   - gamma: 0.6 默认（<1 拉开差距，>1 收缩差距）
//   - hueStart: 240（蓝）
//   - hueEnd: 0（红）
//   - saturation: 90（HSL 的 % 值，数值型，最终会拼接成 "90%"）
//   - lightnessMin: 35（低密度的亮度）
//   - lightnessMax: 70（高密度的亮度）
//   - pad: 0.02（避免 t=0/1 过黑/过白，做一点点内缩）
//   - reverse: false（true 则红↔蓝反转）
//
// 用法：
// const colorOf = createEqualizedColorScale(densities, { gamma: 0.6 });
// ctx.fillStyle = colorOf(density);
// function createEqualizedColorScale(densities, opts = {}) {
//     const {
//         gamma = 0.6,
//         hueStart = 240,
//         hueEnd = 0,
//         saturation = 90,
//         lightnessMin = 35,
//         lightnessMax = 70,
//         pad = 0.02,
//         reverse = false,
//     } = opts;

//     // 预排序，后续用二分得到 rank 区间，减少 ties 偏差
//     const sorted = [...densities].sort((a, b) => a - b);
//     const n = Math.max(sorted.length, 2);

//     // 二分查找 [firstIdx, lastIdx]
//     function boundsOf(x) {
//         let lo = 0, hi = n - 1, first = -1, last = -1;

//         // 找 first
//         let l = 0, r = n - 1;
//         while (l <= r) {
//             const m = (l + r) >> 1;
//             if (sorted[m] >= x) { first = m; r = m - 1; } else { l = m + 1; }
//         }
//         if (first === -1) first = 0;

//         // 找 last
//         l = 0; r = n - 1;
//         while (l <= r) {
//             const m = (l + r) >> 1;
//             if (sorted[m] <= x) { last = m; l = m + 1; } else { r = m - 1; }
//         }
//         if (last === -1) last = n - 1;

//         // mid-rank（把相同值的 rank 取中点，避免同值颜色抖动）
//         const mid = 0.5 * (first + last);
//         return mid;
//     }

//     // 安全 clamp
//     const clamp01 = (v) => Math.max(0, Math.min(1, v));

//     return function colorOf(density) {
//         // 直方图均衡：用秩（中秩）作为 CDF 近似
//         const midRank = boundsOf(density);
//         let t = midRank / (n - 1);         // 线性 CDF in [0,1]
//         t = clamp01(t);

//         // γ 非线性增强（<1 拉开中段差异）
//         t = Math.pow(t, gamma);

//         // padding，避免出现过黑/过白的极端
//         if (pad > 0) {
//             const scale = 1 - 2 * pad;
//             t = pad + t * scale;
//             t = clamp01(t);
//         }

//         // 颜色空间映射：HSL（色相+亮度同时变化）
//         const tt = reverse ? 1 - t : t;
//         const hue = hueStart + (hueEnd - hueStart) * tt;
//         const lightness = lightnessMin + (lightnessMax - lightnessMin) * tt;

//         return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
//     };
// }

// 单色相的直方图均衡色尺：值越大 → 越深
function createMonoHueEqualizedScale(values, opts = {}) {
    const {
        hue = 210,            // 蓝: density；红: 0；绿: 140
        saturation = 90,      // 0~100
        lightnessLight = 78,  // 最亮（用于小值）
        lightnessDark = 35,   // 最暗（用于大值）
        gamma = 0.7,          // <1 拉开中段差异
        pad = 0.02            // 内缩避免极端
    } = opts;

    const arr = [...values];
    arr.sort((a, b) => a - b);
    const n = Math.max(arr.length, 2);

    // 返回某值的“中秩”以平滑 ties
    function midRank(x) {
        // lower bound
        let l = 0, r = n - 1, first = n;
        while (l <= r) {
            const m = (l + r) >> 1;
            if (arr[m] >= x) { first = m; r = m - 1; } else { l = m + 1; }
        }
        // upper bound
        l = 0; r = n - 1; let last = -1;
        while (l <= r) {
            const m = (l + r) >> 1;
            if (arr[m] <= x) { last = m; l = m + 1; } else { r = m - 1; }
        }
        if (first === n) first = n - 1;
        if (last === -1) last = 0;
        return 0.5 * (first + last);
    }

    const clamp01 = v => Math.max(0, Math.min(1, v));

    return function colorOf(v) {
        // CDF ≈ rank/n
        let t = midRank(v) / (n - 1);
        t = clamp01(t);

        // γ 非线性（放大中段差异）
        t = Math.pow(t, gamma);

        // padding 防极端
        if (pad > 0) {
            const s = 1 - 2 * pad;
            t = pad + t * s;
            t = clamp01(t);
        }

        // 大值更深：lightness 从亮(lightnessLight) 过渡到 暗(lightnessDark)
        const L = lightnessLight + (lightnessDark - lightnessLight) * t;
        return `hsl(${hue}, ${saturation}%, ${L}%)`;
    };
}

// 根据浅/深自动选择黑/白字
function textColorFor(hslString) {
    const m = /hsl\(\s*[\d.]+,\s*[\d.]+%?,\s*([\d.]+)%\s*\)/i.exec(hslString);
    const L = m ? parseFloat(m[1]) : 50;
    return L > 55 ? "black" : "white";
}

function drawUtilityFunctionChart(utilityFn) {
    const ctx = document.getElementById("utilityChart").getContext("2d");
    const xs = [];
    const ys = [];
    for (let i = 0; i <= 100; i++) {
        const rho = i / 100;
        xs.push(rho.toFixed(2));   // x -> labels
        ys.push(utilityFn(rho));   // y -> data
    }

    // 如已存在旧图，先销毁，避免叠加
    if (utilityChart) {
        utilityChart.destroy();
        utilityChart = null;
    }

    utilityChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: xs,
            datasets: [{
                label: "Utility Function u(ρ)",
                data: ys,
                borderColor: "blue",
                fill: false,
                pointRadius: 3,                // 让点可见
                pointHoverRadius: 4,
                pointBackgroundColor: ys.map(() => "rgba(54,162,235,1)"), // 初始点色
                pointBorderColor: ys.map(() => "rgba(54,162,235,1)")
            }]
        },
        options: {
            responsive: false,
            animation: false,
            maintainAspectRatio: false,
            // parsing: false,
            scales: {
                x: { title: { display: true, text: "ρ" } },
                y: { title: { display: true, text: "u(ρ)" } }
            }
        }
    });

    return utilityChart; // ← 关键：返回实例
}

function highlightPointOnUtilityChart(rhoStar) {
    if (!utilityChart) return;
    const ds = utilityChart.data.datasets[0];
    const labels = utilityChart.data.labels;

    // 先重置所有点颜色
    ds.pointBackgroundColor = ds.data.map(() => "rgba(54,162,235,1)");
    ds.pointBorderColor = ds.data.map(() => "rgba(54,162,235,1)");

    // 在 labels (string) 中找与 rhoStar 最近的索引
    let closestIndex = 0;
    let minDiff = Infinity;
    for (let i = 0; i < labels.length; i++) {
        const x = parseFloat(labels[i]);           // 将 "0.37" 转成 0.37
        const diff = Math.abs(x - rhoStar);
        if (diff < minDiff) {
            minDiff = diff;
            closestIndex = i;
        }
    }

    // 把该点染成红色（可顺带放大半径更醒目）
    ds.pointBackgroundColor[closestIndex] = "red";
    ds.pointBorderColor[closestIndex] = "darkred";
    if (!Array.isArray(ds.pointRadius)) {
        ds.pointRadius = ds.data.map(() => 3);     // 默认半径
    }
    ds.pointRadius = ds.pointRadius.map(() => 3);
    ds.pointRadius[closestIndex] = 6;              // 高亮点更大

    utilityChart.update("none");
}

function updateSocialUtilityChart(currentU, turn = null) {
    if (turn !== null) {
        if (turn === lastTurnSeen) return;    // 同一回合别重复记
        lastTurnSeen = turn;
    } else {
        if (socialUtilityHistory.length > 0 &&
            socialUtilityHistory[socialUtilityHistory.length - 1] === currentU) {
            return;
        }
    }

    socialUtilityHistory.push(currentU);

    if (!socialUtilityChart) {
        const ctx = document.getElementById("socialUtilityChart").getContext("2d");
        socialUtilityChart = new Chart(ctx, {
            type: "line",
            data: {
                labels: socialUtilityHistory.map((_, i) => i),
                datasets: [{
                    label: "Social Welfare Over Time",
                    data: [...socialUtilityHistory],
                    borderColor: "green",
                    fill: false
                }]
            },
            options: {
                responsive: false,
                animation: false,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: "Turn" } },
                    y: { title: { display: true, text: "U = Σρ⋅u(ρ)" } }
                }
            }
        });
    } else {
        socialUtilityChart.data.labels = socialUtilityHistory.map((_, i) => i);
        socialUtilityChart.data.datasets[0].data = [...socialUtilityHistory];
        socialUtilityChart.update("none");
    }

    lastSocialUSeen = currentU;
}

function makeUtilityFunction(utilityParams) {
    if (!utilityParams) return (rho) => 0;
    const { type, params } = utilityParams;

    if (type === "piecewise_linear") {
        const m = params.m;
        return function (rho) {
            rho = Math.min(0.999999, Math.max(0.000001, rho));
            return rho <= 0.5
                ? 2 * rho
                : m + 2 * (1 - m) * (1 - rho);
        };
    }

    return (rho) => 0;
}

function drawGradientLegend(canvasId, hue, saturation, lightnessLight, lightnessDark) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, `hsl(${hue}, ${saturation}%, ${lightnessLight}%)`);
    grad.addColorStop(1, `hsl(${hue}, ${saturation}%, ${lightnessDark}%)`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
}

// 在页面加载完成时调用
window.addEventListener("DOMContentLoaded", () => {
    drawGradientLegend("legendRho", 210, 90, 80, 35);  // 蓝: ρ
    drawGradientLegend("legendDu", 0, 90, 80, 35);   // 红: Δu
    drawGradientLegend("legendDU", 140, 85, 80, 35);   // 绿: ΔU
});