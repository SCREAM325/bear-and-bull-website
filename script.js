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
// This is a local UI lock. A public site needs server-side authentication.
let picksUnlocked = false;
let checkingPassword = false;
const picks = loadPicks();

async function checkClubPassword(enteredPassword) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch("password.txt", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Password file unavailable");
        // Ignore a text-file BOM and final line breaks, preserving password spaces.
        const password = (await response.text()).replace(/^\uFEFF/, "").replace(/[\r\n]+$/, "");
        if (!password.trim()) throw new Error("Password file is empty");
        return enteredPassword === password;
    } finally {
        clearTimeout(timeout);
    }
}

unlockForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (checkingPassword || picksUnlocked) return;
    checkingPassword = true;
    const unlockButton = document.getElementById("unlock-button");
    unlockButton.disabled = true;
    unlockMessage.textContent = "Checking password...";
    let matches;
    try {
        matches = await checkClubPassword(unlockForm.elements.password.value);
    } catch {
        unlockMessage.textContent = location.protocol === "file:"
            ? "Open the website through a local web server to read the club password file."
            : "Unable to read the club password. Check that password.txt is available and try again.";
        return;
    } finally {
        checkingPassword = false;
        unlockButton.disabled = false;
    }
    if (!matches) {
        unlockMessage.textContent = "Incorrect password. Try again.";
        unlockForm.elements.password.focus();
        return;
    }
    picksUnlocked = true;
    document.getElementById("portfolio-editor").hidden = false;
    form.hidden = false;
    unlockForm.hidden = true;
    lockButton.hidden = false;
    unlockForm.reset();
    unlockMessage.textContent = "Stock adder unlocked.";
    renderPicks();
    form.elements.symbol.focus();
});

lockButton.addEventListener("click", () => {
    picksUnlocked = false;
    document.getElementById("portfolio-editor").hidden = true;
    form.hidden = true;
    unlockForm.hidden = false;
    lockButton.hidden = true;
    unlockMessage.textContent = "Stock adder locked.";
    message.textContent = "";
    renderPicks();
    unlockForm.elements.password.focus();
});

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
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(picks.map(pick => ({
            symbol: pick.symbol,
            holder: pick.holder,
            pickedDate: pick.pickedDate,
            startingPrice: pick.startingPrice
        }))));
        return true;
    } catch {
        message.textContent = "Your change is shown, but this browser could not save it for next time.";
        return false;
    }
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
        details.textContent = `Picked: ${pick.pickedDate ?? "Not set"} \u00b7 Starting price: ${pick.startingPrice === null ? "Not set" : "$" + pick.startingPrice.toFixed(2)}`;
        const quote = document.createElement("p");
        quote.textContent = pick.loading ? "Loading price..." :
            pick.price === null ? "Price unavailable. Try refreshing in a moment." :
            `Current price: $${pick.price.toFixed(2)}`;
        const growth = document.createElement("p");
        growth.textContent = pick.growthPercentage === null
            ? "Growth unavailable" + (pick.startingPrice === null ? " \u2014 no starting price set." : ".")
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
        const priceA = pickA.price ?? -Infinity;
        const priceB = pickB.price ?? -Infinity;

        return priceA === priceB ? 0 : priceB - priceA;
    });

    renderPicks();
    return picks;
}

async function getStockPrice(pick) {
    pick.price = null;
    pick.growthPercentage = null;
    pick.loading = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(pick.symbol)}&apikey=${API_KEY}`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Price request failed");
        const data = await response.json();
        const price = Number(data.price);
        if (!Number.isFinite(price) || price <= 0) throw new Error("Price unavailable");
        pick.price = price;
        if (Number.isFinite(pick.startingPrice) && pick.startingPrice > 0) {
            pick.growthPercentage = ((price - pick.startingPrice) / pick.startingPrice) * 100;
        }
    } catch {
        pick.price = null;
    } finally {
        clearTimeout(timeout);
        pick.loading = false;
    }
}

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

const requests = picks.map(pick => getStockPrice(pick));
renderPicks();
Promise.all(requests).then(sortPicks);
