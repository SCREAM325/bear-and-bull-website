const API_KEY = "3002bb9410d646b788d00798f5e61324";
// Set pickedDate to "YYYY-MM-DD" and startingPrice to the price when picked.
// null means the value is not known yet.
const defaultPicks = [
    {
        symbol: "AAPL",
        holder: "John",
        price: null,
        startingPrice: null,
        growthPercentage: null,
        pickedDate: null
    },
    {
        symbol: "NVDA",
        holder: "Jane",
        price: null,
        startingPrice: null,
        growthPercentage: null,
        pickedDate: null
    },
    {
        symbol: "MSFT",
        holder: "Bob",
        price: null,
        startingPrice: null,
        growthPercentage: null,
        pickedDate: null
    }
];
const STORAGE_KEY = "bear-bull-stock-picks";
const message = document.getElementById("pick-message");
const form = document.getElementById("pick-form");
const unlockForm = document.getElementById("unlock-form");
const unlockMessage = document.getElementById("unlock-message");
const lockButton = document.getElementById("lock-picks");
// The controls reflect authentication; Supabase enforces write permissions.
let picksUnlocked = false;
const picks = [];

function loadPicks() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === null) return defaultPicks;
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed) || !parsed.every(pick =>
            pick && typeof pick.symbol === "string" && /^[A-Z0-9.^:/-]{1,30}$/.test(pick.symbol) &&
            typeof pick.holder === "string" && pick.holder.trim().length > 0 &&
            (pick.pickedDate === null || /^\d{4}-\d{2}-\d{2}$/.test(pick.pickedDate)) &&
            (pick.startingPrice === null || (Number.isFinite(pick.startingPrice) && pick.startingPrice > 0))
        )) throw new Error("Invalid saved picks");
        return parsed.map(pick => ({
            symbol: pick.symbol,
            holder: pick.holder,
            pickedDate: pick.pickedDate,
            startingPrice: pick.startingPrice,
            price: null,
            growthPercentage: null
        }));
    } catch {
        message.textContent = "Saved picks could not be loaded. Showing the default picks.";
        return defaultPicks;
    }
}

function savePicks() {
    queueClubSave();
    return true;
}

function renderPicks() {
    const stocks = document.getElementById("stocks");
    stocks.replaceChildren();
    if (picks.length === 0) {
        stocks.textContent = "No stocks tracked yet. Unlock the stock adder at the bottom to add a pick.";
    }
    for (const pick of picks) {
        const row = document.createElement("article");
        row.className = "stock-pick";
        const title = document.createElement("h3");
        title.textContent = `${pick.symbol} \u2014 ${pick.holder}`;
        const details = document.createElement("p");
        details.className = "stock-details";
        const baseline = pick.startingPrice ?? pick.resolvedStartingPrice;
        details.textContent = `Picked: ${pick.pickedDate ?? "Not set"} \u00b7 Starting price: ${baseline == null ? "Not set" : "$" + baseline.toFixed(2)}${pick.baselineDate ? ` (close ${pick.baselineDate})` : ""}`;
        const quote = document.createElement("p");
        quote.textContent = pick.loading ? "Loading price..." :
            pick.price === null ? "Price unavailable. Try refreshing in a moment." :
            `Current price: $${pick.price.toFixed(2)}${pick.priceError ? " (last known; refresh failed)" : ""}`;
        const growth = document.createElement("p");
        growth.textContent = pick.growthPercentage === null
            ? (pick.loading ? "Calculating growth..." : pick.baselineError || pick.priceError || "Waiting for market data.")
            : `Growth: ${pick.growthPercentage >= 0 ? "+" : ""}${pick.growthPercentage.toFixed(2)}%`;
        if (pick.growthPercentage !== null) {
            growth.className = pick.growthPercentage >= 0 ? "growth-positive" : "growth-negative";
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.hidden = !picksUnlocked;
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${pick.symbol} held by ${pick.holder}`);
        remove.addEventListener("click", () => {
            if (!picksUnlocked) return;
            picks.splice(picks.indexOf(pick), 1);
            if (savePicks()) message.textContent = `${pick.symbol} removed.`;
            renderPicks();
        });
        row.append(title, details, quote, growth, remove);
        stocks.appendChild(row);
    }
}

function sortPicks() {
    picks.sort((pickA, pickB) => {
        const priceA = pickA.growthPercentage ?? -Infinity;
        const priceB = pickB.growthPercentage ?? -Infinity;

        return priceA === priceB ? 0 : priceB - priceA;
    });

    renderPicks();
    return picks;
}

async function getStockPrice(pick) {
    if (pick.loading) return;
    pick.loading = true;
    pick.priceError = null;
    pick.baselineError = null;
    try {
        pick.price = await latestStockPrice(pick.symbol);
    } catch (error) { pick.priceError = error.message; }
    try { pick.resolvedStartingPrice = await pickStartingPrice(pick); }
    catch (error) { pick.baselineError = error.message; }
    const baseline = pick.startingPrice ?? pick.resolvedStartingPrice;
    pick.growthPercentage = Number.isFinite(pick.price) && baseline > 0
        ? (pick.price - baseline) / baseline * 100 : null;
    pick.loading = false;
    sortPicks();
}

// Deduplicate symbols and pace requests to the provider's basic quota.
const marketCache = new Map();
const marketPending = new Map();
let marketQueue = Promise.resolve();
const marketRequestTimes = [];
const QUOTE_TTL = 5 * 60 * 1000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function marketRequest(path, historical = false) {
    const cached = marketCache.get(path);
    if (cached && (historical || Date.now() - cached.time < QUOTE_TTL)) return Promise.resolve(cached.data);
    if (marketPending.has(path)) return marketPending.get(path);
    const request = marketQueue.then(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
            while (marketRequestTimes.length && Date.now() - marketRequestTimes[0] >= 61000) marketRequestTimes.shift();
            if (marketRequestTimes.length >= 8) await delay(61000 - (Date.now() - marketRequestTimes[0]));
            marketRequestTimes.push(Date.now());
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            let data, response;
            try {
                response = await fetch(`https://api.twelvedata.com/${path}&apikey=${API_KEY}`, { signal: controller.signal });
                data = await response.json();
            } finally { clearTimeout(timeout); }
            if (response.status === 429 || Number(data.code) === 429) {
                if (attempt === 0) { await delay(61000); continue; }
                throw new Error("Quote limit reached; try again later.");
            }
            if (!response.ok || data.status === "error") throw new Error(data.message || "Market data unavailable.");
            if (historical ? !data.values?.some(bar => Number(bar.close) > 0) : !(Number(data.price) > 0 && Number.isFinite(Number(data.price)))) {
                throw new Error("No market price returned for this symbol/date.");
            }
            marketCache.set(path, { data, time: Date.now() });
            return data;
        }
    });
    marketQueue = request.catch(() => {});
    marketPending.set(path, request);
    request.finally(() => marketPending.delete(path)).catch(() => {});
    return request;
}

async function latestStockPrice(symbol) {
    const data = await marketRequest(`price?symbol=${encodeURIComponent(symbol)}`);
    return Number(data.price);
}

async function pickStartingPrice(pick) {
    if (Number.isFinite(pick.startingPrice) && pick.startingPrice > 0) return pick.startingPrice;
    if (!pick.pickedDate) throw new Error("Set a picked date or starting price to calculate growth.");
    const start = new Date(pick.pickedDate + "T12:00:00Z");
    start.setUTCDate(start.getUTCDate() - 10);
    const data = await marketRequest(`time_series?symbol=${encodeURIComponent(pick.symbol)}&interval=1day&start_date=${start.toISOString().slice(0, 10)}&end_date=${pick.pickedDate}T23:59:59&outputsize=11&order=desc`, pick.pickedDate < today());
    const bar = data.values.filter(bar => bar.datetime.slice(0, 10) <= pick.pickedDate && Number.isFinite(Number(bar.close)) && Number(bar.close) > 0)
        .sort((a, b) => b.datetime.localeCompare(a.datetime))[0];
    if (!bar) throw new Error("No close found near the picked date. Enter the starting price manually.");
    pick.baselineDate = bar.datetime.slice(0, 10);
    return Number(bar.close);
}

let marketRefresh = null;
async function refreshMarketData() {
    if (marketRefresh) return marketRefresh;
    const button = document.getElementById("refresh-prices");
    button.disabled = true;
    document.getElementById("market-status").textContent = "Updating prices; large lists may take a few minutes.";
    marketRefresh = Promise.all([...picks.map(getStockPrice), ...portfolio.holdings.map(refreshHoldingPrice)]);
    renderPicks();
    try {
        await marketRefresh;
        const errors = picks.some(p => p.priceError || p.baselineError) || portfolio.holdings.some(h => holdingQuotes.get(h)?.error);
        document.getElementById("market-status").textContent = errors
            ? "Some market data could not be refreshed. Last known values are retained; see each stock for details."
            : "Prices checked at " + new Date().toLocaleTimeString() + ". Refreshes every 5 minutes while this page is open.";
    } finally { marketRefresh = null; button.disabled = false; }
}
document.getElementById("refresh-prices").addEventListener("click", () => { void refreshMarketData(); });
setInterval(() => { if (!document.hidden) void refreshMarketData(); }, QUOTE_TTL);

function today() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

form.elements.pickedDate.max = today();
form.elements.pickedDate.value = today();
form.addEventListener("submit", event => {
    event.preventDefault();
    if (!picksUnlocked) return;
    if (!form.reportValidity()) return;
    const symbol = form.elements.symbol.value.trim().toUpperCase();
    const holder = form.elements.holder.value.trim();
    const pickedDate = form.elements.pickedDate.value;
    const startingPrice = form.elements.startingPrice.value === "" ? null : Number(form.elements.startingPrice.value);
    if (!holder || !/^[A-Z0-9.^:/-]{1,30}$/.test(symbol) || !pickedDate || pickedDate > today() ||
        (startingPrice !== null && (!Number.isFinite(startingPrice) || startingPrice <= 0))) {
        message.textContent = "Enter a symbol, holder, valid picked date, and a positive starting price if provided.";
        return;
    }
    if (picks.some(pick => pick.symbol === symbol && pick.holder.toLowerCase() === holder.toLowerCase())) {
        message.textContent = `${holder} already tracks ${symbol}. Remove the existing pick to replace it.`;
        return;
    }
    const pick = { symbol, holder, price: null, startingPrice, growthPercentage: null, pickedDate };
    picks.push(pick);
    if (savePicks()) message.textContent = `${symbol} added for ${holder}.`;
    const request = getStockPrice(pick);
    sortPicks();
    request.then(sortPicks);
    form.reset();
    form.elements.pickedDate.value = today();
    form.elements.symbol.focus();
});

renderPicks();
