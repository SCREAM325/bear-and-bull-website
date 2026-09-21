// This publishable key is public. Database permissions protect editor actions.
const CLUB_URL = "https://eqqneucvsyfdmxekvbzt.supabase.co";
const CLUB_PUBLISHABLE_KEY = "sb_publishable_SpAwDMIGe3KOEyYFB6E46w_X9NYzus1";
const cloudStatus = document.getElementById("cloud-status");
let clubClient = null;
let cloudReady = false;
let clubEditor = false;
let clubSignedIn = false;
let cloudRevision = null;
let cloudSaving = false;
let cloudDirty = false;
let cloudFailed = false;
let cloudConflict = false;
let pendingClubData = null;
let sessionCheck = 0;

// Keep the old browser data available for an explicit, one-time migration.
let previousBrowserData = null;
try {
    if (localStorage.getItem(STORAGE_KEY) !== null || localStorage.getItem(PORTFOLIO_KEY) !== null) {
        previousBrowserData = {
            picks: localStorage.getItem(STORAGE_KEY) === null ? [] : loadPicks(),
            portfolio: localStorage.getItem(PORTFOLIO_KEY) === null ? { holdings: [], history: [] } : loadPortfolio()
        };
    }
} catch { /* Browser storage may be unavailable; shared data still works. */ }

function clubDataSnapshot() {
    return JSON.parse(JSON.stringify({
        picks: picks.map(({ symbol, holder, pickedDate, startingPrice }) => ({ symbol, holder, pickedDate, startingPrice })),
        portfolio: { holdings: portfolio.holdings, history: portfolio.history }
    }));
}

function validateClubData(data) {
    const finite = value => typeof value === "number" && Number.isFinite(value);
    if (!data || !Array.isArray(data.picks) || data.picks.length > 500 ||
        !data.picks.every(pick => pick && typeof pick.symbol === "string" && /^[A-Z0-9.^:/-]{1,30}$/.test(pick.symbol) &&
            typeof pick.holder === "string" && pick.holder.trim().length > 0 && pick.holder.length <= 80 &&
            (pick.pickedDate === null || validPortfolioDate(pick.pickedDate)) &&
            (pick.startingPrice === null || (finite(pick.startingPrice) && pick.startingPrice > 0))) ||
        !data.portfolio || !Array.isArray(data.portfolio.holdings) || data.portfolio.holdings.length > 500 ||
        !data.portfolio.holdings.every(h => h && typeof h.id === "string" && h.id.length > 0 &&
            typeof h.name === "string" && h.name.trim().length > 0 && h.name.length <= 80 &&
            ["Stocks", "Bonds"].includes(h.asset) && finite(h.cost) && h.cost > 0 && finite(h.value) && h.value >= 0 && h.value <= 1e12 &&
            ["style", "cap", "sector"].every(key => portfolioCategories[key].includes(h[key]))) ||
        new Set(data.portfolio.holdings.map(h => h.id)).size !== data.portfolio.holdings.length ||
        data.portfolio.holdings.reduce((sum, h) => sum + h.cost, 0) > INITIAL_CAPITAL + 0.001 ||
        !Array.isArray(data.portfolio.history) || data.portfolio.history.length > 10000 ||
        !data.portfolio.history.every(point => point && validPortfolioDate(point.date) && finite(point.value) && point.value >= 0 && point.value <= 1e12) ||
        new Set(data.portfolio.history.map(point => point.date)).size !== data.portfolio.history.length) {
        throw new Error("Invalid club data");
    }
    return data;
}

function updateClubControls() {
    picksUnlocked = Boolean(clubEditor && cloudReady && !cloudFailed);
    form.hidden = !picksUnlocked;
    document.getElementById("portfolio-editor").hidden = !picksUnlocked;
    unlockForm.hidden = clubEditor;
    lockButton.hidden = !clubSignedIn;
    document.getElementById("cloud-recovery").hidden = !cloudFailed || !cloudDirty;
    document.getElementById("retry-cloud-save").disabled = !clubEditor || cloudConflict || cloudSaving;
    document.getElementById("migrate-browser-data").hidden = !previousBrowserData || cloudRevision !== 0;
    renderPicks();
}

async function loadSharedClubData() {
    if (!clubClient || cloudSaving || cloudDirty) return;
    cloudStatus.textContent = "Loading the club's shared portfolio...";
    try {
        const { data, error } = await clubClient.from("club_state").select("data,revision").eq("id", 1).single();
        if (error) throw error;
        validateClubData(data.data);
        if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error("Invalid revision");
        cloudRevision = data.revision;
        picks.splice(0, picks.length, ...data.data.picks.map(pick => ({ ...pick, price: null, growthPercentage: null })));
        portfolio = data.data.portfolio;
        portfolio.history.sort((a, b) => a.date.localeCompare(b.date));
        resetHoldingForm();
        cloudReady = true;
        cloudFailed = false;
        cloudConflict = false;
        renderPortfolio();
        const requests = picks.map(pick => getStockPrice(pick));
        updateClubControls();
        Promise.all(requests).then(sortPicks);
        cloudStatus.textContent = "Shared portfolio loaded. All visitors see the same saved club data.";
    } catch {
        cloudReady = false;
        cloudStatus.textContent = "Shared portfolio unavailable. Please try refreshing. If this is the first setup, the database setup still needs to be completed.";
        updateClubControls();
    }
}

function queueClubSave() {
    if (!picksUnlocked) return;
    cloudDirty = true;
    pendingClubData = clubDataSnapshot();
    void flushClubSaves();
}

async function flushClubSaves() {
    if (cloudSaving || cloudFailed || !clubEditor || !cloudReady) return;
    cloudSaving = true;
    cloudStatus.textContent = "Saving changes to the shared portfolio...";
    try {
        while (pendingClubData) {
            const next = pendingClubData;
            pendingClubData = null;
            validateClubData(next);
            const { data, error } = await clubClient.rpc("save_club_state", { next_data: next, expected_revision: cloudRevision });
            if (error) {
                cloudConflict = error.code === "40001";
                throw error;
            }
            if (!Number.isSafeInteger(data)) throw new Error("Invalid save response");
            cloudRevision = data;
        }
        cloudDirty = false;
        cloudStatus.textContent = "All changes saved to the shared club portfolio.";
    } catch {
        pendingClubData = clubDataSnapshot();
        cloudFailed = true;
        cloudStatus.textContent = cloudConflict
            ? "Another editor saved newer data. Your changes have not been published. Download your work, then load the latest shared data before editing again."
            : "Changes have not been saved online. Your work is still on this page; use the recovery controls below.";
    } finally {
        cloudSaving = false;
        updateClubControls();
    }
}

async function updateClubSession(session) {
    const check = ++sessionCheck;
    clubSignedIn = Boolean(session?.user);
    clubEditor = false;
    updateClubControls();
    if (!session?.user) {
        unlockMessage.textContent = "Sign in with an approved club editor account.";
        return;
    }
    try {
        const { data, error } = await clubClient.from("club_editors").select("user_id").eq("user_id", session.user.id).maybeSingle();
        if (check !== sessionCheck) return;
        if (error) throw error;
        clubEditor = Boolean(data);
        unlockMessage.textContent = clubEditor ? "Signed in as a club editor." : "This account does not have club editing access.";
    } catch {
        if (check !== sessionCheck) return;
        unlockMessage.textContent = "Could not verify editing access. Check the database setup and try signing in again.";
    }
    updateClubControls();
    // Signed-in non-editors must still be able to sign out.
    lockButton.hidden = false;
}

unlockForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!clubClient) {
        unlockMessage.textContent = "Sign-in could not load. Refresh the page; if this continues, check that supabase.js was uploaded beside index.html.";
        return;
    }
    if (!unlockForm.reportValidity()) return;
    const button = document.getElementById("unlock-button");
    if (button.disabled) return;
    button.disabled = true;
    unlockMessage.textContent = "Signing in...";
    try {
        const { data, error } = await clubClient.auth.signInWithPassword({
            email: unlockForm.elements.email.value.trim(), password: unlockForm.elements.password.value
        });
        if (error) throw error;
        unlockForm.elements.password.value = "";
        await updateClubSession(data.session);
        if (!cloudReady && !cloudDirty) await loadSharedClubData();
    } catch {
        unlockMessage.textContent = "Sign-in failed. Check your email and password, or try again shortly.";
    } finally { button.disabled = false; }
});

lockButton.addEventListener("click", async () => {
    if (!clubClient) return;
    if (cloudDirty || cloudSaving) {
        unlockMessage.textContent = "Save your changes or use the recovery controls before signing out.";
        return;
    }
    const { error } = await clubClient.auth.signOut();
    if (error) { unlockMessage.textContent = "Sign-out failed. Please try again."; return; }
    await updateClubSession(null);
});

document.getElementById("retry-cloud-save").addEventListener("click", () => {
    if (!clubEditor || cloudConflict) return;
    cloudFailed = false;
    void flushClubSaves();
});
document.getElementById("download-unsaved").addEventListener("click", () => {
    if (cloudDirty) downloadStockBackup(cloudStatus);
});
document.getElementById("reload-cloud").addEventListener("click", async () => {
    if (cloudSaving) return;
    // The button explicitly says it discards unsaved changes.
    pendingClubData = null;
    cloudDirty = false;
    cloudFailed = false;
    await loadSharedClubData();
});
document.getElementById("migrate-browser-data").addEventListener("click", () => {
    if (!picksUnlocked || cloudRevision !== 0 || !previousBrowserData) return;
    try {
        validateClubData(previousBrowserData);
        picks.splice(0, picks.length, ...previousBrowserData.picks.map(pick => ({ ...pick, price: null, growthPercentage: null })));
        portfolio = JSON.parse(JSON.stringify(previousBrowserData.portfolio));
        renderPortfolio();
        queueClubSave();
        const requests = picks.map(pick => getStockPrice(pick));
        renderPicks();
        Promise.all(requests).then(sortPicks);
    } catch { portfolioMessage.textContent = "Previous browser data could not be imported. Your shared data has not been changed."; }
});
window.addEventListener("beforeunload", event => {
    if (cloudDirty || cloudSaving) { event.preventDefault(); event.returnValue = ""; }
});

async function initializeClubCloud() {
    try {
        if (!window.supabase) throw new Error("Supabase library unavailable");
        clubClient = window.supabase.createClient(CLUB_URL, CLUB_PUBLISHABLE_KEY);
        clubClient.auth.onAuthStateChange((_event, session) => {
            // Do database work after Supabase releases its auth callback lock.
            setTimeout(() => { void updateClubSession(session); }, 0);
        });
        const { data, error } = await clubClient.auth.getSession();
        if (error) throw error;
        await Promise.all([loadSharedClubData(), updateClubSession(data.session)]);
    } catch {
        cloudStatus.textContent = "Unable to connect to the club's shared data. Please refresh and try again.";
        updateClubControls();
    }
}
void initializeClubCloud();
