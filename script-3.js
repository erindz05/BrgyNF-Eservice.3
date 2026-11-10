/* jshint esversion: 11, browser: true, devel: true, asi: true, laxbreak: true, undef: false, unused: false */
/* eslint-env browser, es2022 */
// ---- part 3 of 6 ----
function showConfirmation(rec, payment, payNote) {
    const amount = rec.amount;
    let html = "<h3>✅ Application Submitted</h3>" +
        "<p>Your reference number:</p><p class=\"ref-number\">" + escapeHtml(rec.serial) + "</p>" +
        "<p>Name: <b>" + escapeHtml(rec.name) + "</b><br>Type: <b>" + escapeHtml(DOCUMENT_LABELS[rec.document_type]) +
        "</b><br>Fee: <b>" + (amount === 0 ? "FREE" : peso(amount)) + "</b><br>Status: <b>" + (amount === 0 ? "NO PAYMENT NEEDED" : "PENDING") + "</b></p>";
    if (amount === 0) {
        html += "<p>This document is free of charge. Please wait for the barangay to review your application, then show this reference number at the Barangay Hall.</p>";
    } else if (payment) {
        html += "<a class=\"success-btn pay-btn\" href=\"" + escapeHtml(payment.url) + "\" target=\"_blank\" rel=\"noopener\">Pay " +
            peso(amount) + " via GCash / Maya</a>" +
            "<p class=\"muted\">After paying, keep your reference number. The barangay will confirm your payment and application status.</p>";
    } else {
        html += "<p>Please pay the fee of <b>" + peso(amount) + "</b> at the Barangay Hall and show this reference number.</p>";
    }
    if (payNote) html += "<p class=\"muted\">" + escapeHtml(payNote) + "</p>";
    html += "<p class=\"muted\">Please save this number and present it at the Barangay Hall. Your personal details are confidential and can only be viewed by authorized barangay personnel.</p>";

    const card = $("confirmCard");
    card.innerHTML = html;
    card.classList.remove("hidden");
    setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}

// =====================================================
//  ADMINISTRATOR AREA  (roles: admin / secretary / treasurer)
// =====================================================
const STAGE_LABEL = {
    submitted: "Submitted", under_review: "Under review", approved: "Approved",
    ready: "Ready for pickup", released: "Released", rejected: "Rejected"
};
const NEXT_STAGES = {
    submitted: ["under_review", "rejected"],
    under_review: ["approved", "rejected"],
    approved: ["ready", "rejected"],
    ready: ["released"],
    released: [],
    rejected: ["submitted"]
};
const STAGE_BTN = {
    under_review: ["Start review", "plain"], approved: ["Approve", "ok"], rejected: ["Reject…", "danger"],
    ready: ["Mark ready for pickup", "ok"], released: ["Mark as released", "ok"], submitted: ["Reopen", "plain"]
};
const ACTION_LABEL = {
    mark_paid: "Marked as paid", stage_under_review: "Started review", stage_approved: "Approved",
    stage_ready: "Marked ready for pickup", stage_released: "Marked as released", stage_rejected: "Rejected",
    stage_submitted: "Reopened", "delete": "Moved to Trash", restore: "Restored from Trash", purge: "Deleted forever",
    fees_changed: "Changed fees", print: "Printed certificate", export_pdf: "Exported PDF", export_csv: "Exported CSV", login: "Signed in"
};
const ROLE_LABEL = { admin: "Administrator", secretary: "Secretary", treasurer: "Treasurer" };
const DEMO_USERS = { "demo@brgy.local": "admin", "secretary@brgy.local": "secretary", "treasurer@brgy.local": "treasurer" };
const PAGE_SIZE = 15;

let staff = { role: null, email: "" };
let curRow = null;       // record open in the details panel
let curPage = 0;
let confirmRun = null;
let rejectSerial = null;

const can = {
    review: () => staff.role === "admin" || staff.role === "secretary",
    pay: () => staff.role === "admin" || staff.role === "treasurer",
    admin: () => staff.role === "admin",
    print: () => staff.role === "admin" || staff.role === "secretary",
    csv: () => staff.role === "admin" || staff.role === "treasurer"
};

// ---------- small helpers ----------
function fmtDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function stageBadge(stage) { return '<span class="badge ' + escapeHtml(stage) + '">' + escapeHtml(STAGE_LABEL[stage] || stage) + "</span>"; }
function payBadge(status, amount) {
    if (status === "paid") return amount === 0 ? '<span class="badge paid">Free</span>' : '<span class="badge paid">Paid</span>';
    return '<span class="badge unpaid">Unpaid</span>';
}
function rowAmount(r) {
    if (r.amount_centavos != null) return r.amount_centavos;
    return r.status === "paid" ? (fees[r.document_type] || 0) : null;
}
function errText(e) { return (e && (e.message || e.details)) || String(e); }
function feedback(html) { $("searchFeedback").innerHTML = html || ""; }
function okMsg(msg) { return '<div class="alert-success">' + escapeHtml(msg) + "</div>"; }
function errMsg(msg) { return '<div class="alert-danger">' + escapeHtml(msg) + "</div>"; }

// ---------- demo-mode storage (only used when no Supabase keys are set) ----------
function demoAuditList() { try { return JSON.parse(localStorage.getItem("demoAudit") || "[]"); } catch (e) { return []; } }
function demoAudit(action, serial, detail) {
    const l = demoAuditList();
    l.push({ at: new Date().toISOString(), actor_email: staff.email, actor_role: staff.role, action, serial: serial || null, detail: detail || {} });
    try { localStorage.setItem("demoAudit", JSON.stringify(l.slice(-500))); } catch (e) {}
}
function demoFind(list, serial) { return list.find((r) => r.serial === serial); }
function demoMatches(r, f) {
    if (f.trash ? !r.deleted_at : r.deleted_at) return false;
    if (f.q) {
        const q = f.q.toLowerCase();
        if (!(String(r.serial).toLowerCase().includes(q) || String(r.name || "").toLowerCase().includes(q))) return false;
    }
    if (f.type && r.document_type !== f.type) return false;
    if (f.stage && (r.stage || "submitted") !== f.stage) return false;
    if (f.pay === "paid" && r.status !== "paid") return false;
    if (f.pay === "unpaid" && r.status === "paid") return false;
    const day = (r.created_at || "").slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
}
function demoStats() {
    const list = demoList().filter((r) => !r.deleted_at);
    const now = new Date();
    const key = (d) => d.toLocaleDateString("en-CA");
    const today = key(now), month = today.slice(0, 7), year = today.slice(0, 4);
    const day = (r) => (r.created_at || "").slice(0, 10);
    const paidDay = (r) => (r.issued_at || r.created_at || "").slice(0, 10);
    const amt = (r) => (r.amount_centavos != null ? r.amount_centavos : (fees[r.document_type] || 0));
    const paid = list.filter((r) => r.status === "paid");
    const sum = (a) => a.reduce((s, r) => s + amt(r), 0);
    const by_stage = {}, by_type = {};
    list.forEach((r) => { const s = r.stage || "submitted"; by_stage[s] = (by_stage[s] || 0) + 1; by_type[r.document_type] = (by_type[r.document_type] || 0) + 1; });
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const m = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        months.push({ month: m, applications: list.filter((r) => day(r).slice(0, 7) === m).length, collected: sum(paid.filter((r) => paidDay(r).slice(0, 7) === m)) });
    }
    return {
        total: list.length,
        today: list.filter((r) => day(r) === today).length,
        this_month: list.filter((r) => day(r).slice(0, 7) === month).length,
        this_year: list.filter((r) => day(r).slice(0, 4) === year).length,
        unpaid: list.filter((r) => r.status !== "paid" && (r.stage || "submitted") !== "rejected").length,
        paid: paid.length,
        collected_today: sum(paid.filter((r) => paidDay(r) === today)),
        collected_month: sum(paid.filter((r) => paidDay(r).slice(0, 7) === month)),
        collected_year: sum(paid.filter((r) => paidDay(r).slice(0, 4) === year)),
        collected_total: sum(paid),
        by_stage, by_type, months
    };
}

// ---------- DATA LAYER for staff (Supabase functions, or demo storage) ----------
const api = {
    async role() {
        if (!db) return null;
        const { data } = await db.rpc("staff_role");
        return data || null;
    },
    async stats() {
        if (db) { const { data, error } = await db.rpc("admin_dashboard"); if (error) throw error; return data; }
        return demoStats();
    },
    async list(f) {
        const size = f.size || PAGE_SIZE, from = (f.page || 0) * size;
        if (db) {
            let q = db.from("clearances")
                .select("serial,name,document_type,status,stage,created_at,issued_at,amount_centavos,deleted_at,deleted_by", { count: "exact" });
            q = f.trash ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
            if (f.q) {
                const s = f.q.replace(/[,()%*\\]/g, " ").trim();
                if (s) q = q.or("serial.ilike.*" + s + "*,name.ilike.*" + s + "*");
            }
            if (f.type) q = q.eq("document_type", f.type);
            if (f.stage) q = q.eq("stage", f.stage);
            if (f.pay === "paid") q = q.eq("status", "paid");
            if (f.pay === "unpaid") q = q.neq("status", "paid");
            if (f.from) q = q.gte("created_at", f.from + "T00:00:00+08:00");
            if (f.to) q = q.lte("created_at", f.to + "T23:59:59.999+08:00");
            q = q.order(f.trash ? "deleted_at" : "created_at", { ascending: false }).range(from, from + size - 1);
            const { data, error, count } = await q;
            if (error) throw error;
            return { rows: data || [], count: count || 0 };
        }
        const all = demoList().filter((r) => demoMatches(r, f)).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
        return { rows: all.slice(from, from + size), count: all.length };
    },
    async get(serial) {
        if (db) {
            const { data, error } = await db.from("clearances").select("*").eq("serial", serial).maybeSingle();
            if (error) throw error;
            return data;
        }
        return demoFind(demoList(), serial) || null;
    },
    async markPaid(serial) {
        if (db) { const { error } = await db.rpc("mark_paid", { p_serial: serial }); if (error) throw error; return; }
        const list = demoList(), r = demoFind(list, serial);
        if (!r) throw new Error("Application not found");
        if (r.status !== "paid") {
            r.status = "paid"; r.issued_at = r.issued_at || new Date().toISOString();
            r.amount_centavos = r.amount_centavos != null ? r.amount_centavos : feeFor(r.document_type, r.details) || fees[r.document_type]; demoSave(list); demoAudit("mark_paid", serial);
        }
    },
    async setStage(serial, stage, reason) {
        if (db) { const { error } = await db.rpc("set_stage", { p_serial: serial, p_stage: stage, p_reason: reason || null }); if (error) throw error; return; }
        const list = demoList(), r = demoFind(list, serial);
        if (!r) throw new Error("Application not found");
        if ((stage === "ready" || stage === "released") && r.status !== "paid") throw new Error("Payment has not been received yet");
        if (stage === "rejected" && !(reason || "").trim()) throw new Error("Please give a reason for rejecting");
        const from = r.stage || "submitted";
        r.stage = stage; r.reject_reason = stage === "rejected" ? reason.trim() : null;
        demoSave(list); demoAudit("stage_" + stage, serial, { from, to: stage, reason: reason || null });
    },
    async archive(serial) {
        if (db) { const { error } = await db.rpc("archive_application", { p_serial: serial }); if (error) throw error; return; }
        const list = demoList(), r = demoFind(list, serial);
        if (!r) throw new Error("Application not found");
        r.deleted_at = new Date().toISOString(); r.deleted_by = staff.email; demoSave(list); demoAudit("delete", serial);
    },
    async restore(serial) {
        if (db) { const { error } = await db.rpc("restore_application", { p_serial: serial }); if (error) throw error; return; }
        const list = demoList(), r = demoFind(list, serial);
        if (!r) throw new Error("Application not found in Trash");
        r.deleted_at = null; r.deleted_by = null; demoSave(list); demoAudit("restore", serial);
    },
    async purge(serial) {
        const row = await api.get(serial);
        if (db) {
            const { error } = await db.rpc("purge_application", { p_serial: serial });
            if (error) throw error;
            const reqs = (row && row.details && row.details["Requirements"]) || {};
            const paths = Object.keys(reqs).map((k) => reqs[k]).filter(Boolean);
            if (paths.length) { try { await db.storage.from("requirements").remove(paths); } catch (e) { console.error(e); } }
            return;
        }
        if (!row || !row.deleted_at) throw new Error("Only items in Trash can be deleted forever");
        demoSave(demoList().filter((r) => r.serial !== serial)); demoAudit("purge", serial);
    },
    async audit() {
        if (db) {
            const { data, error } = await db.from("audit_log").select("*").order("at", { ascending: false }).limit(300);
            if (error) throw error;
            return data || [];
        }
        return demoAuditList().slice().reverse();
    },
    async log(action, serial) {
        try {
            if (db) await db.rpc("log_event", { p_action: action, p_serial: serial || null });
            else demoAudit(action, serial);
        } catch (e) { console.error(e); }
    }
};