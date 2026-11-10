/* jshint esversion: 11, browser: true, devel: true, asi: true, laxbreak: true, undef: false, unused: false */
/* eslint-env browser, es2022 */
// ---- part 4 of 6 ----
// ---------- login / logout ----------
function unlockAdminUI(role, email) {
    staff = { role, email: email || "" };
    $("adminAuthForm").classList.add("hidden");
    $("adminCoreControls").classList.remove("hidden");
    $("authFeedback").innerHTML = "";
    $("roleBadge").textContent = (ROLE_LABEL[role] || role);
    document.querySelectorAll("#adminTabs [data-role]").forEach((b) => b.classList.toggle("hidden", b.dataset.role !== role));
    $("btnCsv").classList.toggle("hidden", !can.csv());
    api.log("login");
    showTab("dashboard");
}

async function restoreAdminSession() {
    if (!db) return;
    try {
        const { data } = await db.auth.getSession();
        if (data && data.session) {
            const role = await api.role();
            if (role) unlockAdminUI(role, data.session.user.email);
            else await db.auth.signOut();
        }
    } catch (e) { console.error(e); }
}

async function authenticateAdmin() {
    const email = $("adminEmailInput").value.trim();
    const password = $("adminPasswordInput").value;
    const fb = $("authFeedback");
    let role = null, message = "";
    if (db) {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) message = error.message;
        else {
            role = await api.role();   // logged in is not enough: must be listed in "admins"
            if (!role) { await db.auth.signOut(); message = "This account is not an authorized barangay staff member."; }
        }
    } else {
        // Demo mode only (no Supabase keys set)
        if (DEMO_USERS[email] && password === "demo1234") role = DEMO_USERS[email];
        else message = "Demo mode: use demo@brgy.local, secretary@brgy.local or treasurer@brgy.local with password demo1234";
    }
    if (!role) { fb.innerHTML = '<div class="alert-danger">❌ ' + escapeHtml("Error: " + (message)) + "</div>"; return; }
    $("adminPasswordInput").value = "";
    unlockAdminUI(role, email);
}

// Signs out AND wipes every confidential detail from the screen
async function logoutAdmin() {
    try { if (db) await db.auth.signOut(); } catch (e) { console.error(e); }
    $("adminCoreControls").classList.add("hidden");
    $("adminAuthForm").classList.remove("hidden");
    ["searchFeedback", "adminDetails", "adminList", "adminPager", "dashBox", "trashList", "auditList", "authFeedback", "printable-clearance"]
        .forEach((id) => { $(id).innerHTML = ""; });
    $("certPanel").classList.add("hidden");
    $("certNote").classList.add("hidden");
    ["adminPasswordInput", "fQ", "fFrom", "fTo", "auditFilter"].forEach((id) => { $(id).value = ""; });
    ["fType", "fStage", "fPay"].forEach((id) => { $(id).value = ""; });
    currentCert = null; curRow = null; curPage = 0;
    staff = { role: null, email: "" };
    closeConfirm(); closeReject();
}

// ---------- tabs ----------
function showTab(name) {
    document.querySelectorAll("#adminTabs .tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    ["dashboard", "apps", "trash", "audit", "settings"].forEach((n) => $("tab-" + n).classList.toggle("hidden", n !== name));
    if (name === "dashboard") loadDashboard();
    if (name === "apps" && !$("adminList").innerHTML) runSearch(true);
    if (name === "trash") loadTrash();
    if (name === "audit") loadAudit();
    if (name === "settings") checkPictures();
}

// ---------- DASHBOARD ----------
const STAGE_COLOR = { submitted: "#5b9bd5", under_review: "#e0a800", approved: "#5aa469", ready: "#1f8a5b", released: "#1b4d3e", rejected: "#c0392b" };
let dashData = null, dashChart = "collected";

function shortPeso(c) {
    const p = c / 100;
    return p >= 1000 ? "₱" + (Math.round(p / 100) / 10) + "k" : "₱" + Math.round(p);
}
function chartHtml(months, key) {
    const money = key === "collected";
    const max = Math.max(1, ...months.map((m) => m[key]));
    return '<div class="chart">' + months.map((m, i) => {
        const label = new Date(m.month + "-01T00:00:00").toLocaleString("en", { month: "short" });
        const h = Math.max(3, Math.round((m[key] / max) * 100));
        const last = i === months.length - 1;
        return '<div class="col' + (last ? " now" : "") + '"><div class="bar-val">' + (m[key] ? (money ? shortPeso(m[key]) : m[key]) : "") + '</div><div class="bar-track"><div class="bar" style="height:' + h + '%"></div></div><div class="bar-label">' + escapeHtml(label) + "</div></div>";
    }).join("") + "</div>";
}
function kpi(num, label, tone) {
    return '<div class="kpi ' + (tone || "") + '"><div class="kpi-num">' + num + '</div><div class="kpi-lbl">' + escapeHtml(label) + "</div></div>";
}
function renderDashboard() {
    const s = dashData, box = $("dashBox");
    const months = s.months || [];
    const stageKeys = Object.keys(STAGE_LABEL);
    const counts = stageKeys.map((k) => (s.by_stage && s.by_stage[k]) || 0);
    const totalStages = counts.reduce((a, b) => a + b, 0);
    const seg = totalStages
        ? stageKeys.map((k, i) => counts[i] ? '<span style="flex:' + counts[i] + ';background:' + STAGE_COLOR[k] + '" title="' + escapeHtml(STAGE_LABEL[k]) + ": " + counts[i] + '"></span>' : "").join("")
        : '<span style="flex:1;background:var(--border-color)"></span>';
    const legend = stageKeys.map((k, i) =>
        '<li><i style="background:' + STAGE_COLOR[k] + '"></i>' + escapeHtml(STAGE_LABEL[k]) + "<b>" + counts[i] + "</b></li>").join("");
    box.innerHTML =
        '<div class="dash-hero">' +
            '<div class="dash-hero-lbl">Collected this month</div>' +
            '<div class="dash-hero-num">' + peso(s.collected_month) + "</div>" +
            '<div class="dash-hero-sub"><span>Today <b>' + peso(s.collected_today) + "</b></span><span>This year <b>" + peso(s.collected_year) + "</b></span></div>" +
        "</div>" +
        '<div class="kpi-row">' +
            kpi(s.today, "New today") + kpi(s.this_month, "This month") + kpi(s.unpaid, "Waiting for payment", s.unpaid ? "warn" : "") +
        "</div>" +
        '<div class="dash-card"><div class="dash-card-h">Where the applications are</div>' +
            '<div class="stack">' + seg + "</div>" + '<ul class="legend">' + legend + "</ul></div>" +
        '<div class="dash-card"><div class="dash-card-h">Last 6 months' +
            '<span class="seg-toggle"><button type="button" data-chart="collected" class="' + (dashChart === "collected" ? "on" : "") + '">Money</button>' +
            '<button type="button" data-chart="applications" class="' + (dashChart === "applications" ? "on" : "") + '">Applications</button></span></div>' +
            chartHtml(months, dashChart) + "</div>" +
        '<details class="dash-card"><summary>All-time totals</summary><div class="kpi-row two">' +
            kpi(s.total, "All applications") + kpi(peso(s.collected_total), "Collected in total") +
            kpi(s.paid, "Paid") + kpi(s.this_year, "Applications this year") + "</div></details>";
}
async function loadDashboard() {
    const box = $("dashBox");
    try {
        dashData = await api.stats();
        renderDashboard();
    } catch (err) {
        box.innerHTML = errMsg("Could not load the dashboard: " + errText(err) + (db ? " — did you run supabase_setup_ALL.sql?" : ""));
    }
}
document.addEventListener("click", (ev) => {
    const b = ev.target.closest && ev.target.closest("#dashBox [data-chart]");
    if (b && dashData) { dashChart = b.getAttribute("data-chart"); renderDashboard(); }
});

// ---------- APPLICATIONS: search, list, pages ----------
function readFilters() {
    return { q: $("fQ").value.trim(), type: $("fType").value, stage: $("fStage").value, pay: $("fPay").value, from: $("fFrom").value, to: $("fTo").value };
}
async function runSearch(reset) {
    if (reset) curPage = 0;
    feedback("");
    const box = $("adminList");
    try {
        const f = Object.assign(readFilters(), { page: curPage });
        const { rows, count } = await api.list(f);
        if (!rows.length) {
            box.innerHTML = '<p class="muted">' + "No applications found.</p>";
            $("adminPager").innerHTML = "";
            return;
        }
        let html = '<div class="table-scroll"><table class="admin-list"><tr><th>' + "No.</th><th>Name</th><th>Type</th><th>Payment</th><th>Stage</th></tr>";
        rows.forEach((r) => {
            html += '<tr class="pick" data-serial="' + escapeHtml(r.serial) + '"><td>' + escapeHtml(r.serial) + "</td><td>" + escapeHtml(r.name) + "</td><td>" +
                escapeHtml(r.document_type) + "</td><td>" + payBadge(r.status, r.amount_centavos) + "</td><td>" + stageBadge(r.stage || "submitted") + "</td></tr>";
        });
        box.innerHTML = html + "</table></div>";
        const from = curPage * PAGE_SIZE + 1, to = curPage * PAGE_SIZE + rows.length;
        $("adminPager").innerHTML = '<button type="button" id="pgPrev"' + (curPage === 0 ? " disabled" : "") + ">&larr; Previous</button><span>" +
            from + "–" + to + " of " + count + '</span><button type="button" id="pgNext"' + (to >= count ? " disabled" : "") + ">Next &rarr;</button>";
    } catch (err) {
        box.innerHTML = errMsg("Error: " + errText(err));
    }
}

function clearFilters() {
    ["fQ", "fFrom", "fTo"].forEach((id) => { $(id).value = ""; });
    ["fType", "fStage", "fPay"].forEach((id) => { $(id).value = ""; });
    runSearch(true);
}

// ---------- one application: details + actions ----------
async function openRecord(serial) {
    try {
        const row = await api.get(serial);
        if (!row) { feedback(errMsg("No application found for that reference number.")); return; }
        curRow = row;
        renderRecord(row);
        await renderRequirements(row);
        showCertificateIfAllowed(row);
        $("adminDetails").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
        feedback(errMsg("Error: " + errText(err)));
    }
}

function renderRecord(row) {
    const stage = row.stage || "submitted";
    const paid = row.status === "paid";
    const d = row.details || {};
    let btns = "";
    if (can.pay() && !paid && stage !== "rejected") btns += '<button type="button" class="act-btn ok" data-act="paid">💰 ' + "Mark as Paid</button>";
    if (can.review()) {
        (NEXT_STAGES[stage] || []).forEach((n) => {
            const lbl = STAGE_BTN[n], needsPay = (n === "ready" || n === "released") && !paid;
            btns += '<button type="button" class="act-btn ' + lbl[1] + '" data-stage="' + n + '"' + (needsPay ? " disabled" : "") + ">" + escapeHtml(lbl[0]) + "</button>";
        });
    }
    if (can.admin()) btns += '<button type="button" class="act-btn danger" data-act="delete">🗑️ ' + "Delete this permit</button>";
    const waitNote = (!paid && can.review() && (stage === "approved")) ? '<p class="muted">' + "Waiting for payment before it can be marked ready.</p>" : "";

    let html = '<div class="admin-details"><div class="record-head"><div><h3>' + escapeHtml(row.name) + '</h3><div class="muted">' + "No. " + escapeHtml(row.serial) +
        " · " + escapeHtml(row.document_type) + "</div></div><div>" + payBadge(row.status, row.amount_centavos) + " " + stageBadge(stage) + "</div></div>" +
        '<div class="muted">' + "Applied: " + escapeHtml(fmtDate(row.created_at)) +
        (rowAmount(row) != null ? " · Fee: " + peso(rowAmount(row)) : "") + "</div>" +
        (stage === "rejected" && row.reject_reason ? '<div class="reject-box"><b>' + "Rejected:</b> " + escapeHtml(row.reject_reason) + "</div>" : "") +
        '<div class="action-row">' + btns + "</div>" + waitNote +
        "<h4>Full Application Details (Confidential)" + '</h4><table>';
    Object.keys(d).forEach((k) => {
        if (k === "Requirements" || k === "Group Code" || d[k] === "" || d[k] == null) return;
        html += "<tr><td>" + escapeHtml(k) + "</td><td>" + escapeHtml(d[k]) + "</td></tr>";
    });
    html += '</table><div id="reqBox"></div></div>';
    $("adminDetails").innerHTML = html;
}

async function renderRequirements(row) {
    const box = $("reqBox");
    if (!box) return;
    const reqs = (row.details && row.details["Requirements"]) || {};
    const names = Object.keys(reqs);
    const title = "<h4>Uploaded Requirements</h4>";
    if (!names.length) { box.innerHTML = title + '<p class="muted">No files were uploaded with this application.</p>'; return; }
    box.innerHTML = title + '<p class="muted">Loading files…</p>';
    let html = '<div class="req-view">';
    for (const label of names) {
        const path = String(reqs[label]);
        let inner;
        if (db) {
            let url = "", msg = "";
            try {
                const { data, error } = await db.storage.from("requirements").createSignedUrl(path, 600); // link works for 10 minutes
                if (error || !data) msg = (error && error.message) || "no link"; else url = data.signedUrl;
            } catch (e) { msg = errText(e); }
            if (url) {
                const isImg = /\.(png|jpe?g|gif|webp|bmp)$/i.test(path);
                inner = (isImg ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener"><img class="req-thumb" src="' + escapeHtml(url) + '" alt="" loading="lazy"></a>' : "") +
                    '<a class="req-open" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">Open file</a>';
            } else {
                inner = '<span class="pic-bad">Could not open this file (' + escapeHtml(msg) + ")</span>";
            }
        } else {
            inner = '<span class="muted">' + escapeHtml(path) + " (demo mode: only the file name is kept)</span>";
        }
        html += '<div class="req-row"><div class="req-label">' + escapeHtml(label) + "</div>" + inner + "</div>";
    }
    box.innerHTML = title + html + "</div>";
}