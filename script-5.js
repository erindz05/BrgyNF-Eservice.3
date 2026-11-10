/* jshint esversion: 11, browser: true, devel: true, asi: true, laxbreak: true, undef: false, unused: false */
/* eslint-env browser, es2022 */
// ---- part 5 of 6 ----
function showCertificateIfAllowed(row) {
    const stage = row.stage || "submitted";
    const note = $("certNote");
    const allowed = can.print() && row.status === "paid" && ["approved", "ready", "released"].includes(stage);
    if (allowed) {
        note.classList.add("hidden");
        renderCertificate(row);
        return;
    }
    $("certPanel").classList.add("hidden");
    $("printable-clearance").innerHTML = "";
    currentCert = null;
    note.textContent = !can.print() ? "Your role cannot print certificates." : "The certificate can be printed once the application is paid and approved.";
    note.classList.remove("hidden");
}

async function afterChange(serial, msg) {
    feedback(okMsg(msg));
    await runSearch(false);
    if (serial) await openRecord(serial);
}

async function onDetailsClick(e) {
    const btn = e.target.closest("button");
    if (!btn || !curRow) return;
    const serial = curRow.serial;
    try {
        if (btn.dataset.act === "paid") { await api.markPaid(serial); await afterChange(serial, "Marked as paid."); }
        else if (btn.dataset.act === "delete") askDelete(curRow);
        else if (btn.dataset.stage === "rejected") openReject(serial);
        else if (btn.dataset.stage) { await api.setStage(serial, btn.dataset.stage); await afterChange(serial, "Updated."); }
    } catch (err) {
        feedback(errMsg("Error: " + (errText(err))));
    }
}

// ---------- confirm modal (delete / delete forever) ----------
function openConfirm(o) {
    $("confirmTitle").textContent = o.title;
    $("confirmMsg").innerHTML = o.msg;
    $("confirmWarn").innerHTML = o.warn || "";
    $("confirmErr").innerHTML = "";
    const b = $("confirmBtn");
    b.textContent = o.btn; b.disabled = false;
    confirmRun = o.run;
    $("confirmModal").classList.remove("hidden");
}
function closeConfirm() { confirmRun = null; $("confirmModal").classList.add("hidden"); }
async function runConfirm() {
    if (!confirmRun) return;
    const b = $("confirmBtn");
    b.disabled = true;
    try { await confirmRun(); closeConfirm(); }
    catch (err) { $("confirmErr").innerHTML = errMsg("Could not complete: " + (errText(err))); b.disabled = false; }
}
function askDelete(row) {
    openConfirm({
        title: "Delete this permit?",
        msg: "Are you sure you want to delete the " + escapeHtml(row.document_type) + " belonging to <b>" + escapeHtml(row.name) + "</b> (No. <b>" + escapeHtml(row.serial) + "</b>)?",
        warn: "<b>It will be moved to Trash. You can restore it later.</b>",
        btn: "Yes, move to Trash",
        run: async () => {
            await api.archive(row.serial);
            curRow = null; currentCert = null;
            $("adminDetails").innerHTML = ""; $("certPanel").classList.add("hidden"); $("certNote").classList.add("hidden"); $("printable-clearance").innerHTML = "";
            feedback(okMsg("Permit " + row.serial + " was moved to Trash."));
            await runSearch(false);
        }
    });
}

// ---------- reject modal ----------
function openReject(serial) {
    rejectSerial = serial;
    $("rejectReason").value = ""; $("rejectErr").innerHTML = "";
    $("rejectModal").classList.remove("hidden");
}
function closeReject() { rejectSerial = null; $("rejectModal").classList.add("hidden"); }
async function runReject() {
    const reason = $("rejectReason").value.trim();
    if (!reason) { $("rejectErr").innerHTML = errMsg("Please give a reason for rejecting"); return; }
    const serial = rejectSerial;
    try { await api.setStage(serial, "rejected", reason); closeReject(); await afterChange(serial, "Application rejected."); }
    catch (err) { $("rejectErr").innerHTML = errMsg((errText(err))); }
}

// ---------- TRASH (administrator only) ----------
async function loadTrash() {
    const box = $("trashList");
    try {
        const { rows } = await api.list({ trash: true, page: 0, size: 200 });
        if (!rows.length) { box.innerHTML = '<p class="muted">' + "Trash is empty.</p>";  return; }
        let html = '<div class="table-scroll"><table class="admin-list"><tr><th>' + "No.</th><th>Name</th><th>Deleted</th><th></th></tr>";
        rows.forEach((r) => {
            html += "<tr><td>" + escapeHtml(r.serial) + "</td><td>" + escapeHtml(r.name) + "</td><td>" + escapeHtml(fmtDate(r.deleted_at)) +
                '<br><span class="muted">' + escapeHtml(r.deleted_by || "") + "</span></td><td>" +
                '<button type="button" class="row-btn" data-restore="' + escapeHtml(r.serial) + '">' + "Restore</button>" +
                '<button type="button" class="row-btn danger" data-purge="' + escapeHtml(r.serial) + '" data-name="' + escapeHtml(r.name) + '">' + "Delete forever</button></td></tr>";
        });
        box.innerHTML = html + "</table></div>";
    } catch (err) { box.innerHTML = errMsg("Error: " + errText(err)); }
}
async function onTrashClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    try {
        if (btn.dataset.restore) { await api.restore(btn.dataset.restore); await loadTrash(); }
        else if (btn.dataset.purge) {
            const serial = btn.dataset.purge;
            openConfirm({
                title: "Delete forever?",
                msg: "Permanently delete <b>" + escapeHtml(btn.dataset.name) + "</b> (No. <b>" + escapeHtml(serial) + "</b>)?",
                warn: "<b>This cannot be undone. The application and its uploaded requirements will be permanently removed.</b>",
                btn: "Yes, delete forever",
                run: async () => { await api.purge(serial); await loadTrash(); }
            });
        }
    } catch (err) { $("trashList").insertAdjacentHTML("afterbegin", errMsg("Error: " + (errText(err)))); }
}

// ---------- AUDIT LOG (administrator only) ----------
let auditCache = [];
function renderAudit() {
    const q = $("auditFilter").value.trim().toLowerCase();
    const rows = auditCache.filter((r) => !q || [r.actor_email, r.actor_role, r.action, (ACTION_LABEL[r.action] || r.action), r.serial].join(" ").toLowerCase().includes(q)).slice(0, 150);
    const box = $("auditList");
    if (!rows.length) { box.innerHTML = '<p class="muted">' + "No entries.</p>";  return; }
    let html = '<div class="table-scroll"><table class="admin-list"><tr><th>' + "When</th><th>Who</th><th>Action</th><th>No.</th></tr>";
    rows.forEach((r) => {
        html += "<tr><td>" + escapeHtml(fmtDateTime(r.at)) + "</td><td>" + escapeHtml(r.actor_email || "system") +
            '<br><span class="muted">' + escapeHtml(ROLE_LABEL[r.actor_role] || r.actor_role || "") + "</span></td><td>" +
            escapeHtml(ACTION_LABEL[r.action] || r.action) +
            (r.detail && r.detail.reason ? '<br><span class="muted">' + escapeHtml(r.detail.reason) + "</span>" : "") +
            "</td><td>" + escapeHtml(r.serial || "") + "</td></tr>";
    });
    box.innerHTML = html + "</table></div>";
}
async function loadAudit() {
    try { auditCache = await api.audit(); renderAudit(); }
    catch (err) { $("auditList").innerHTML = errMsg("Error: " + errText(err)); }
}

// ---------- CSV EXPORT ----------
function csvCell(v) {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;       // stops spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
}
async function exportCsv() {
    if (!can.csv()) return;
    const btn = $("btnCsv");
    btn.disabled = true;
    try {
        const f = readFilters();
        let all = [];
        for (let p = 0; p < 20; p++) {
            const { rows, count } = await api.list(Object.assign({}, f, { page: p, size: 1000 }));
            all = all.concat(rows);
            if (all.length >= count || !rows.length) break;
        }
        const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) : "");
        const lines = [["Reference No.", "Name", "Document Type", "Payment", "Stage", "Amount (PHP)", "Date Applied", "Date Paid"].map(csvCell).join(",")];
        all.forEach((r) => {
            const amt = rowAmount(r);
            lines.push([r.serial, r.name, r.document_type, r.status === "paid" ? "Paid" : "Unpaid", STAGE_LABEL[r.stage || "submitted"],
                amt != null ? (amt / 100).toFixed(2) : "", day(r.created_at), r.status === "paid" ? day(r.issued_at) : ""].map(csvCell).join(","));
        });
        const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "applications-" + day(new Date().toISOString()) + ".csv";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        feedback(okMsg(all.length + " rows exported."));
        api.log("export_csv");
    } catch (err) {
        feedback(errMsg("Error: " + errText(err)));
    }
    btn.disabled = false;
}

// --- ADMIN: CERTIFICATE (print / PDF) -----------------
function imgTag(key, cls) {
    var src = IMAGES[key] || "";
    if (!src) { return ""; }
    var hide = "this.style.display=" + String.fromCharCode(39) + "none" + String.fromCharCode(39);
    return "<img class=" + String.fromCharCode(34) + cls + String.fromCharCode(34) +
        " src=" + String.fromCharCode(34) + escapeHtml(src) + String.fromCharCode(34) +
        " alt=" + String.fromCharCode(34) + String.fromCharCode(34) +
        " onerror=" + String.fromCharCode(34) + hide + String.fromCharCode(34) + ">";
}

function certHeader() {
    return '<div class="cert-head"><div class="cert-logos">' +
        imgTag("logo", "cert-img") + imgTag("seal", "cert-img") + imgTag("bagongPilipinas", "cert-img") +
        '</div><div class="cert-agency"><div class="cert-republic">Republic of the Philippines</div>' +
        '<div class="cert-brgy">BARANGAY NORTH FAIRVIEW</div><div class="cert-district">District 5, Quezon City</div>' +
        '<div class="cert-phones">8-355-9458/ 8-355-9410</div></div></div>';
}

function certFooter(row) {
    return '<div class="cert-foot"><div class="cert-control">Control No. <b>' + escapeHtml(row.serial) + '</b></div>' +
        '<div class="cert-sign">' + imgTag("signature", "cert-signature") +
        '<div class="cert-signer">' + escapeHtml(PUNONG_BARANGAY) + '</div>' +
        '<div class="cert-title">' + escapeHtml(PUNONG_BARANGAY_TITLE) + '</div>' +
        '<div class="cert-seal-note">Not valid without Barangay Seal</div></div></div>';
}