// Explicitly select data fields so credentials are never included in backups.
function createStockBackup() {
    return {
        format: "bear-bull-stock-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        currency: "USD",
        initialCapital: INITIAL_CAPITAL,
        stockPicks: picks.map(pick => ({
            symbol: pick.symbol,
            holder: pick.holder,
            pickedDate: pick.pickedDate,
            startingPrice: pick.startingPrice,
            price: pick.price,
            growthPercentage: pick.growthPercentage
        })),
        portfolio: {
            holdings: portfolio.holdings.map(holding => ({
                id: holding.id,
                name: holding.name,
                asset: holding.asset,
                cost: holding.cost,
                value: holding.value,
                style: holding.style,
                cap: holding.cap,
                sector: holding.sector
            })),
            history: portfolio.history.map(point => ({ date: point.date, value: point.value })),
            totals: portfolioTotals()
        }
    };
}

function downloadStockBackup(status = document.getElementById("backup-message")) {
    let url;
    let link;
    try {
        const backup = createStockBackup();
        const file = new Blob([JSON.stringify(backup, null, 2) + "\n"], { type: "text/plain;charset=utf-8" });
        url = URL.createObjectURL(file);
        link = document.createElement("a");
        link.href = url;
        link.download = `bear-bull-stock-data-${backup.exportedAt.replace(/[:.]/g, "-")}.txt`;
        document.body.appendChild(link);
        link.click();
        status.textContent = "Backup download requested. Check your browser's downloads for the text file.";
    } catch {
        status.textContent = "The backup could not be downloaded. Try again; your current data has not changed.";
    } finally {
        if (link) link.remove();
        // Give the browser time to start reading the download before releasing it.
        if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

document.getElementById("download-stock-backup").addEventListener("click", () => {
    if (picksUnlocked) downloadStockBackup();
});
