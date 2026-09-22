// Club holdings are separate from members' stock picks. All values are in USD.
const INITIAL_CAPITAL = 10000;
const PORTFOLIO_KEY = "bear-bull-portfolio-v1";
const portfolioMessage = document.getElementById("portfolio-message");
const holdingForm = document.getElementById("holding-form");
const snapshotForm = document.getElementById("snapshot-form");
const portfolioCategories = {
    asset: ["Stocks", "Bonds", "Cash"],
    style: ["Value", "Growth", "Blend", "Unclassified"],
    cap: ["Mega cap", "Large cap", "Mid cap", "Small cap", "Micro cap", "Unclassified"],
    sector: ["Technology", "Healthcare", "Financials", "Consumer discretionary", "Consumer staples", "Industrials", "Energy", "Utilities", "Real estate", "Materials", "Communication services", "Diversified", "Unclassified"]
};
const chartColors = ["#216e51", "#5d7fe5", "#d3a336", "#a169bc", "#de7754", "#329da5", "#82744a", "#c46691", "#698842", "#7469b1", "#9c593f", "#527587", "#8a8a8a"];
const usd = value => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const signed = value => `${value >= 0 ? "+" : "-"}${usd(Math.abs(value))}`;
let activeBreakdown = "asset";
let editingHolding = null;
let portfolio = { holdings: [], history: [] };
// Quotes are runtime data, separate from saved editor inputs.
const holdingQuotes = new WeakMap();
function holdingValue(holding) {
    return holdingQuotes.get(holding)?.value ?? holding.value;
}
function validHoldingQuoteFields(h) {
    return (h.symbol == null && h.shares == null) ||
        (h.asset === "Stocks" && typeof h.symbol === "string" && /^[A-Z0-9.^:/-]{1,30}$/.test(h.symbol) &&
            Number.isFinite(h.shares) && h.shares > 0 && h.shares <= 1e12);
}
async function refreshHoldingPrice(holding) {
    if (holding.asset !== "Stocks" || !holding.symbol || !holding.shares) return;
    try {
        const price = await latestStockPrice(holding.symbol);
        const value = price * holding.shares;
        if (!Number.isFinite(value) || value > 1e12) throw new Error("Invalid holding valuation.");
        holdingQuotes.set(holding, { value, price, updatedAt: new Date().toLocaleTimeString() });
    } catch (error) {
        holdingQuotes.set(holding, { ...holdingQuotes.get(holding), error: error.message });
    }
    renderPortfolio();
}

function validPortfolioDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T12:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= today();
}

function loadPortfolio() {
    try {
        const stored = localStorage.getItem(PORTFOLIO_KEY);
        if (stored === null) return { holdings: [], history: [] };
        const data = JSON.parse(stored);
        if (!Array.isArray(data.holdings) || !Array.isArray(data.history) ||
            !data.holdings.every(h => h && typeof h.id === "string" && typeof h.name === "string" && h.name.trim() &&
                ["Stocks", "Bonds"].includes(h.asset) && Number.isFinite(h.cost) && h.cost > 0 &&
                Number.isFinite(h.value) && h.value >= 0 && validHoldingQuoteFields(h) && ["style", "cap", "sector"].every(key => portfolioCategories[key].includes(h[key]))) ||
            new Set(data.holdings.map(h => h.id)).size !== data.holdings.length ||
            data.holdings.reduce((sum, h) => sum + h.cost, 0) > INITIAL_CAPITAL + 0.001 ||
            !data.history.every(point => point && validPortfolioDate(point.date) && Number.isFinite(point.value) && point.value >= 0) ||
            new Set(data.history.map(point => point.date)).size !== data.history.length) throw new Error("Invalid portfolio");
        data.history.sort((a, b) => a.date.localeCompare(b.date));
        return data;
    } catch {
        portfolioMessage.textContent = "Saved portfolio data could not be loaded. Showing the initial cash balance.";
        return { holdings: [], history: [] };
    }
}

function savePortfolio(successMessage) {
    portfolioMessage.textContent = successMessage;
    renderPortfolio();
    queueClubSave();
}

function portfolioTotals() {
    const cash = Math.max(0, INITIAL_CAPITAL - portfolio.holdings.reduce((sum, h) => sum + h.cost, 0));
    const total = cash + portfolio.holdings.reduce((sum, h) => sum + holdingValue(h), 0);
    return { cash, total, gain: total - INITIAL_CAPITAL };
}

function portfolioAllocation(dimension) {
    const groups = new Map();
    const add = (name, value) => groups.set(name, (groups.get(name) || 0) + value);
    if (dimension === "asset") portfolioCategories.asset.forEach(label => add(label, 0));
    else portfolioCategories[dimension].forEach(label => add(label, 0));
    for (const holding of portfolio.holdings) {
        add(dimension === "asset" ? holding.asset : holding.asset === "Stocks" ? holding[dimension] : "Bonds", holdingValue(holding));
    }
    add("Cash", portfolioTotals().cash);
    return [...groups].map(([label, value]) => ({ label, value }));
}

function renderAllocation() {
    const { total } = portfolioTotals();
    const groups = portfolioAllocation(activeBreakdown);
    const legend = document.getElementById("allocation-legend");
    const pie = document.getElementById("allocation-pie");
    const descriptions = {
        asset: "Stocks, bonds, and cash as a percentage of total portfolio value.",
        style: "Stock investing styles as a percentage of the entire portfolio. Bonds and cash are shown separately.",
        cap: "Mega, large, mid, small, and micro cap stocks as a percentage of the entire portfolio. Bonds and cash are shown separately.",
        sector: "What the companies do, weighted by holding value. Unclassified stocks have no sector entered yet."
    };
    document.getElementById("allocation-description").textContent = descriptions[activeBreakdown];
    legend.replaceChildren();
    let position = 0;
    const slices = [];
    groups.forEach((group, index) => {
        const percentage = total > 0 ? group.value / total * 100 : 0;
        const color = chartColors[index % chartColors.length];
        if (percentage > 0) slices.push(`${color} ${position}% ${position + percentage}%`);
        position += percentage;
        const item = document.createElement("li");
        const swatch = document.createElement("span");
        swatch.className = "chart-swatch";
        swatch.style.background = color;
        const label = document.createElement("span");
        label.textContent = `${group.label} · ${percentage.toFixed(1)}%`;
        const value = document.createElement("strong");
        value.textContent = usd(group.value);
        item.append(swatch, label, value);
        legend.appendChild(item);
    });
    pie.style.background = slices.length ? `conic-gradient(${slices.join(",")})` : "#dce4df";
    pie.setAttribute("aria-label", total > 0 ? groups.map(group => `${group.label}: ${(group.value / total * 100).toFixed(1)} percent`).join(", ") : "No portfolio value to allocate");
    document.getElementById("allocation-panel").setAttribute("aria-labelledby", `tab-${activeBreakdown}`);
}

function svgElement(tag, attributes, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    if (text !== undefined) element.textContent = text;
    return element;
}

function renderGrowth() {
    const { total } = portfolioTotals();
    const points = [{ date: "Start", value: INITIAL_CAPITAL }, ...portfolio.history, { date: "Current", value: total }];
    const values = points.map(point => point.value);
    const padding = Math.max((Math.max(...values) - Math.min(...values)) * 0.2, 200);
    const min = Math.max(0, Math.min(...values) - padding);
    const max = Math.max(...values) + padding;
    const x = index => 76 + index / (points.length - 1) * 540;
    const y = value => 225 - (value - min) / (max - min) * 190;
    const svg = svgElement("svg", { viewBox: "0 0 650 285", role: "img", "aria-labelledby": "growth-chart-title growth-chart-description" });
    svg.append(svgElement("title", { id: "growth-chart-title" }, "Club portfolio value"),
        svgElement("desc", { id: "growth-chart-description" }, `Starting capital ${usd(INITIAL_CAPITAL)}. Current value ${usd(total)}. ${portfolio.history.length} recorded valuations. Full values are listed below.`));
    for (let index = 0; index <= 4; index++) {
        const value = min + (max - min) * index / 4;
        svg.append(svgElement("line", { x1: 76, x2: 616, y1: y(value), y2: y(value), stroke: "#e1e9e3" }),
            svgElement("text", { x: 66, y: y(value) + 4, "text-anchor": "end", class: "axis-label" }, usd(value).replace(/\.00$/, "")));
    }
    svg.append(svgElement("line", { x1: 76, x2: 616, y1: y(INITIAL_CAPITAL), y2: y(INITIAL_CAPITAL), stroke: "#81998a", "stroke-dasharray": "5 5" }));
    const coords = points.map((point, index) => `${x(index)},${y(point.value)}`);
    svg.append(svgElement("polygon", { points: `76,225 ${coords.join(" ")} 616,225`, fill: "#216e5117" }),
        svgElement("polyline", { points: coords.join(" "), fill: "none", stroke: "#216e51", "stroke-width": 3, "stroke-linejoin": "round" }));
    points.forEach((point, index) => {
        const dot = svgElement("circle", { cx: x(index), cy: y(point.value), r: 4, fill: "#216e51" });
        dot.appendChild(svgElement("title", {}, `${point.date}: ${usd(point.value)}`));
        svg.appendChild(dot);
        if (index === 0 || index === points.length - 1 || (index % Math.max(1, Math.ceil(points.length / 4)) === 0)) {
            svg.appendChild(svgElement("text", { x: x(index), y: 254, "text-anchor": "middle", class: "axis-label" }, point.date));
        }
    });
    document.getElementById("portfolio-growth").replaceChildren(svg);
    const list = document.getElementById("growth-values");
    list.replaceChildren();
    points.forEach(point => {
        const item = document.createElement("li");
        item.textContent = `${point.date}: ${usd(point.value)} (${((point.value - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100).toFixed(2)}% since start)`;
        list.appendChild(item);
    });
}

function renderPortfolio() {
    const { cash, total, gain } = portfolioTotals();
    snapshotForm.elements.value.value = total.toFixed(2);
    document.getElementById("portfolio-total").textContent = usd(total);
    document.getElementById("portfolio-cash").textContent = usd(cash);
    const gainElement = document.getElementById("portfolio-gain");
    gainElement.textContent = `${signed(gain)} (${gain >= 0 ? "+" : ""}${(gain / INITIAL_CAPITAL * 100).toFixed(2)}%)`;
    gainElement.className = gain >= 0 ? "growth-positive" : "growth-negative";
    document.getElementById("portfolio-note").textContent = portfolio.holdings.length
        ? "Stocks with a ticker and share count use the latest available quote. Other holdings use entered values. Quote status is shown beside each holding."
        : "No holdings entered yet. The initial $10,000 is shown as unallocated cash until you add the club's investments.";
    const body = document.getElementById("portfolio-holdings");
    body.replaceChildren();
    const rows = [...portfolio.holdings.map(h => {
        const quote = holdingQuotes.get(h);
        const status = !h.symbol ? "Manual value" : quote?.error ? `Refresh failed; ${quote.value == null ? "entered" : "last known"} value: ${quote.error}` : quote ? `Updated ${quote.updatedAt}` : "Waiting for quote; entered value";
        return [`${h.name} (${status})`, h.asset, usd(holdingValue(h)), `${(total ? holdingValue(h) / total * 100 : 0).toFixed(1)}%`, signed(holdingValue(h) - h.cost)];
    }),
        ["Unallocated cash", "Cash", usd(cash), `${(total ? cash / total * 100 : 0).toFixed(1)}%`, "—"]];
    rows.forEach(values => {
        const row = document.createElement("tr");
        values.forEach(value => { const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell); });
        body.appendChild(row);
    });
    renderAllocation();
    renderGrowth();
    renderPortfolioControls();
}

function resetHoldingForm() {
    editingHolding = null;
    holdingForm.reset();
    updateClassificationFields();
    document.getElementById("save-holding").textContent = "Add holding";
    document.getElementById("cancel-holding").hidden = true;
}

function controlButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => { if (picksUnlocked) action(); });
    return button;
}

function renderPortfolioControls() {
    const list = document.getElementById("holding-controls");
    list.replaceChildren();
    portfolio.holdings.forEach(holding => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = `${holding.name} · ${usd(holdingValue(holding))}`;
        item.append(label, controlButton("Edit", () => {
            editingHolding = holding.id;
            holdingForm.elements.holdingName.value = holding.name;
            ["asset", "cost", "value", "style", "cap", "sector"].forEach(key => holdingForm.elements[key].value = holding[key]);
            holdingForm.elements.symbol.value = holding.symbol ?? "";
            holdingForm.elements.shares.value = holding.shares ?? "";
            updateClassificationFields();
            document.getElementById("save-holding").textContent = "Save holding";
            document.getElementById("cancel-holding").hidden = false;
            holdingForm.elements.holdingName.focus();
        }), controlButton("Remove", () => {
            portfolio.holdings = portfolio.holdings.filter(h => h.id !== holding.id);
            if (editingHolding === holding.id) resetHoldingForm();
            savePortfolio("Holding removed; its original cost returned to unallocated cash. Recorded valuations are unchanged.");
        }));
        list.appendChild(item);
    });
    const snapshots = document.getElementById("snapshot-controls");
    snapshots.replaceChildren();
    portfolio.history.forEach(point => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = `${point.date}: ${usd(point.value)}`;
        item.append(label, controlButton("Remove valuation", () => {
            portfolio.history = portfolio.history.filter(p => p.date !== point.date);
            savePortfolio("Recorded valuation removed.");
        }));
        snapshots.appendChild(item);
    });
}

function updateClassificationFields() {
    ["style", "cap", "sector", "symbol", "shares"].forEach(key => holdingForm.elements[key].disabled = holdingForm.elements.asset.value !== "Stocks");
}
holdingForm.elements.asset.addEventListener("change", updateClassificationFields);
document.getElementById("cancel-holding").addEventListener("click", resetHoldingForm);
holdingForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!picksUnlocked || !holdingForm.reportValidity()) return;
    const fields = holdingForm.elements;
    const name = fields.holdingName.value.trim();
    const cost = Number(fields.cost.value);
    const value = Number(fields.value.value);
    const otherCost = portfolio.holdings.filter(h => h.id !== editingHolding).reduce((sum, h) => sum + h.cost, 0);
    if (!name || !Number.isFinite(cost) || cost <= 0 || !Number.isFinite(value) || value < 0 || otherCost + cost > INITIAL_CAPITAL + 0.001) {
        portfolioMessage.textContent = "Enter a holding name, positive cost, and nonnegative value. Total invested cost cannot exceed $10,000.";
        return;
    }
    const holding = { id: editingHolding || crypto.randomUUID(), name, cost, value, asset: fields.asset.value };
    if (holding.asset === "Stocks" && (fields.symbol.value.trim() || fields.shares.value)) {
        holding.symbol = fields.symbol.value.trim().toUpperCase();
        holding.shares = Number(fields.shares.value);
        if (!validHoldingQuoteFields(holding)) {
            portfolioMessage.textContent = "For automatic prices, enter both a valid ticker and a positive share count.";
            return;
        }
    }
    ["style", "cap", "sector"].forEach(key => holding[key] = holding.asset === "Stocks" ? fields[key].value : "Unclassified");
    if (editingHolding) portfolio.holdings = portfolio.holdings.map(h => h.id === editingHolding ? holding : h);
    else portfolio.holdings.push(holding);
    resetHoldingForm();
    savePortfolio("Holding saved. Record a valuation below to add this total to the growth history.");
    void refreshHoldingPrice(holding);
});

snapshotForm.elements.date.value = today();
snapshotForm.elements.date.max = today();
snapshotForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!picksUnlocked || !snapshotForm.reportValidity()) return;
    const date = snapshotForm.elements.date.value;
    if (!validPortfolioDate(date)) { portfolioMessage.textContent = "Choose a valid valuation date, no later than today."; return; }
    const value = Number(snapshotForm.elements.value.value);
    if (snapshotForm.elements.value.value === "" || !Number.isFinite(value) || value < 0) {
        portfolioMessage.textContent = "Enter a nonnegative portfolio value.";
        return;
    }
    portfolio.history = portfolio.history.filter(point => point.date !== date);
    portfolio.history.push({ date, value });
    portfolio.history.sort((a, b) => a.date.localeCompare(b.date));
    savePortfolio("Portfolio valuation recorded.");
});

const allocationTabs = [...document.querySelectorAll("[data-breakdown]")];
function selectBreakdown(tab) {
    activeBreakdown = tab.dataset.breakdown;
    allocationTabs.forEach(button => {
        button.setAttribute("aria-selected", String(button === tab));
        button.tabIndex = button === tab ? 0 : -1;
    });
    renderAllocation();
}
allocationTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectBreakdown(tab));
    tab.addEventListener("keydown", event => {
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % allocationTabs.length;
        if (event.key === "ArrowLeft") next = (index + allocationTabs.length - 1) % allocationTabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = allocationTabs.length - 1;
        if (next !== undefined) { event.preventDefault(); selectBreakdown(allocationTabs[next]); allocationTabs[next].focus(); }
    });
});
renderPortfolio();
